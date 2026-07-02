import type { AutomaticSessionResult, FaceComparison } from "./report/AutomaticAttendanceReport";
import type { AutomaticAttendanceJob } from "./model";

type UnknownFace = NonNullable<AutomaticSessionResult["unknown_faces"]>[number];

type VideoResultContext = {
  video?: string;
  camera_id?: string | null;
  camera_label?: string | null;
};

function cameraDisplayLabel(cameraId?: string | null, cameraLabel?: string | null) {
  const configured = String(cameraLabel || "").trim();
  if (configured) return configured;
  const value = String(cameraId || "").trim();
  if (!value) return "";
  const suffix = value.match(/(\d+)$/)?.[1];
  return suffix ? `Camara ${suffix}` : value.replace(/_/g, " ");
}

function videoResultLabel(videoResult: VideoResultContext) {
  const cameraLabel = cameraDisplayLabel(videoResult.camera_id, videoResult.camera_label);
  return cameraLabel && videoResult.video ? `${cameraLabel}: ${videoResult.video}` : videoResult.video ?? "";
}

function comparisonWithTimingContext<T extends FaceComparison | UnknownFace>(item: T, sessionResult: AutomaticSessionResult, context?: VideoResultContext): T {
  const cameraId = item.source_camera_id ?? sessionResult.camera_id ?? context?.camera_id ?? "";
  const cameraLabel = item.source_camera_label ?? sessionResult.camera_label ?? context?.camera_label ?? cameraDisplayLabel(cameraId);
  return {
    ...item,
    source_window: item.source_window ?? sessionResult.window,
    source_total_frames: item.source_total_frames ?? sessionResult.total_frames,
    source_duration_seconds: item.source_duration_seconds ?? sessionResult.duration_seconds,
    source_camera_id: cameraId,
    source_camera_label: cameraLabel,
  };
}

function sessionResultWithTimingContext(sessionResult: AutomaticSessionResult, context?: VideoResultContext): AutomaticSessionResult {
  const cameraId = sessionResult.camera_id ?? context?.camera_id ?? "";
  const cameraLabel = sessionResult.camera_label ?? context?.camera_label ?? cameraDisplayLabel(cameraId);
  return {
    ...sessionResult,
    camera_id: cameraId,
    camera_label: cameraLabel,
    marked: sessionResult.marked.map((item) => comparisonWithTimingContext(item, sessionResult, context)),
    review: sessionResult.review?.map((item) => comparisonWithTimingContext(item, sessionResult, context)),
    off_roster: sessionResult.off_roster?.map((item) => comparisonWithTimingContext(item, sessionResult, context)),
    unknown_faces: sessionResult.unknown_faces?.map((item) => comparisonWithTimingContext(item, sessionResult, context)),
  };
}

function comparisonKey(item: FaceComparison) {
  return item.person_key ?? `${item.person_type ?? "student"}:${item.student_id}`;
}

function mergeComparisonList(left: FaceComparison[] = [], right: FaceComparison[] = []) {
  const merged = new Map<string, FaceComparison>();
  [...left, ...right].forEach((item) => {
    const key = comparisonKey(item);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...item });
      return;
    }
    const hits = (current.hits ?? 0) + (item.hits ?? 0);
    const better = item.similarity > current.similarity ? item : current;
    merged.set(key, { ...better, hits: hits || better.hits });
  });
  return Array.from(merged.values()).sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
}

function mergeUnknownFaces(left: UnknownFace[] = [], right: UnknownFace[] = []) {
  const merged = new Map<string, UnknownFace>();
  [...left, ...right].forEach((item) => {
    const key = item.evidence_path ?? `${item.frame ?? "frame"}:${item.unknown_id}`;
    const current = merged.get(key);
    if (!current || item.similarity > current.similarity) {
      merged.set(key, { ...item, hits: (current?.hits ?? 0) + (item.hits ?? 0) || item.hits });
    }
  });
  return Array.from(merged.values()).sort((a, b) => (b.hits ?? 0) - (a.hits ?? 0));
}

function splitMergedText(value?: string) {
  return (value ?? "")
    .split(/\s*(?:\||,)\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeText(left?: string, right?: string) {
  const parts = [...splitMergedText(left), ...splitMergedText(right)];
  return Array.from(new Set(parts)).join(" | ") || undefined;
}

function mergeSessionResults(left: AutomaticSessionResult, right: AutomaticSessionResult): AutomaticSessionResult {
  left = sessionResultWithTimingContext(left);
  right = sessionResultWithTimingContext(right);
  const marked = mergeComparisonList(left.marked, right.marked);
  const offRoster = mergeComparisonList(left.off_roster, right.off_roster);
  const markedKeys = new Set([...marked, ...offRoster].map(comparisonKey));
  const review = mergeComparisonList(left.review, right.review).filter((item) => !markedKeys.has(comparisonKey(item)));
  return {
    ...left,
    marked,
    review,
    off_roster: offRoster,
    unknown_faces: mergeUnknownFaces(left.unknown_faces, right.unknown_faces),
    sampled_frames: (left.sampled_frames ?? 0) + (right.sampled_frames ?? 0) || undefined,
    probed_seconds: (left.probed_seconds ?? 0) + (right.probed_seconds ?? 0) || undefined,
    active_seconds: (left.active_seconds ?? 0) + (right.active_seconds ?? 0) || undefined,
    skipped_seconds: (left.skipped_seconds ?? 0) + (right.skipped_seconds ?? 0) || undefined,
    face_groups: (left.face_groups ?? 0) + (right.face_groups ?? 0) || undefined,
    rejected_quality_faces: (left.rejected_quality_faces ?? 0) + (right.rejected_quality_faces ?? 0) || undefined,
    window: mergeText(left.window, right.window),
    detail: mergeText(left.detail, right.detail),
    camera_id: mergeText(left.camera_id ?? undefined, right.camera_id ?? undefined),
    camera_label: mergeText(left.camera_label ?? undefined, right.camera_label ?? undefined),
    failed: Boolean(left.failed && right.failed),
    thresholds: right.thresholds ?? left.thresholds,
  };
}

export function buildAutomaticResultsBySession(recentJobs: AutomaticAttendanceJob[], mode: "process" | "report") {
  const resultMap = new Map<number, { result: AutomaticSessionResult; video: string; jobId: string }>();
  const seenJobs = new Set<string>();
  const seenVideoSessions = new Set<string>();
  recentJobs.forEach((candidate) => {
    if (seenJobs.has(candidate.id)) return;
    if (mode === "report" && candidate.status !== "done") return;
    seenJobs.add(candidate.id);
    candidate.results?.forEach((videoResult) => {
      videoResult.sessions?.forEach((sessionResult) => {
        const videoSessionKey = `${videoResult.camera_id ?? ""}::${videoResult.video}::${sessionResult.session.id}`;
        if (mode === "report" && seenVideoSessions.has(videoSessionKey)) return;
        seenVideoSessions.add(videoSessionKey);
        const contextualResult = sessionResultWithTimingContext(sessionResult, videoResult);
        const labeledVideo = videoResultLabel(videoResult) || videoResult.video;
        const existing = resultMap.get(sessionResult.session.id);
        if (!existing) {
          resultMap.set(sessionResult.session.id, { result: contextualResult, video: labeledVideo, jobId: candidate.id });
        } else {
          resultMap.set(sessionResult.session.id, {
            result: mergeSessionResults(existing.result, contextualResult),
            video: mergeText(existing.video, labeledVideo) ?? existing.video,
            jobId: existing.jobId,
          });
        }
      });
    });
  });
  return resultMap;
}
