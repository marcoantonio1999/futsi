import type { AutomaticSessionResult, FaceComparison } from "./types";

function clockFromSeconds(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function signedClockFromSeconds(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  return `${seconds < 0 ? "-" : "+"}${clockFromSeconds(Math.abs(seconds))}`;
}

function parseWindowMinutes(windowLabel?: string) {
  const match = (windowLabel ?? "").match(/\(([-\d.]+)-([-\d.]+)\s*min\s+del\s+video\)/i);
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]) };
}

function inferLegacySessionSecond(videoSecond: number | null, sessionResult?: AutomaticSessionResult) {
  if (videoSecond == null || !Number.isFinite(videoSecond) || !sessionResult) return null;
  const durationSeconds = Math.max(1, Number(sessionResult.session.duration_minutes || 50) * 60);
  const windowMinutes = parseWindowMinutes(sessionResult.window);
  const windowLabel = sessionResult.window ?? "";
  if (!windowMinutes) return videoSecond;

  if (/extension local/i.test(windowLabel)) {
    if (windowMinutes.start <= 0.5) return durationSeconds + videoSecond;
    return videoSecond - windowMinutes.end * 60;
  }

  if (/sesion extendida/i.test(windowLabel)) {
    const spanMinutes = windowMinutes.end - windowMinutes.start;
    const paddingSeconds = spanMinutes > sessionResult.session.duration_minutes + 12 ? 10 * 60 : 0;
    return videoSecond - (windowMinutes.start * 60 + paddingSeconds);
  }

  return videoSecond - windowMinutes.start * 60;
}

function inferredWindowPhase(sessionSecond: number | null, explicitPhase?: string, sessionResult?: AutomaticSessionResult) {
  if (explicitPhase) return explicitPhase;
  if (sessionSecond == null || !sessionResult) return "";
  const durationSeconds = Math.max(1, Number(sessionResult.session.duration_minutes || 50) * 60);
  if (sessionSecond < 0) return "pre_padding";
  if (sessionSecond > durationSeconds) return "post_padding";
  return "core";
}

function observedClockFromSession(item: Pick<FaceComparison, "session_second" | "observed_time">, sessionSecond?: number | null, sessionResult?: AutomaticSessionResult) {
  if (item.observed_time) return item.observed_time;
  if (!sessionResult?.session.starts_at || sessionSecond == null || !Number.isFinite(sessionSecond)) return "";
  const [hours = 0, minutes = 0, seconds = 0] = sessionResult.session.starts_at.split(":").map((part) => Number(part));
  const baseSeconds = hours * 3600 + minutes * 60 + seconds;
  const daySeconds = ((Math.round(baseSeconds + sessionSecond) % 86400) + 86400) % 86400;
  return `${String(Math.floor(daySeconds / 3600)).padStart(2, "0")}:${String(Math.floor((daySeconds % 3600) / 60)).padStart(2, "0")}:${String(daySeconds % 60).padStart(2, "0")}`;
}

function cameraDisplayLabel(cameraId?: string | null, cameraLabel?: string | null) {
  const configured = String(cameraLabel || "").trim();
  if (configured) return configured;
  const value = String(cameraId || "").trim();
  if (!value) return "";
  const suffix = value.match(/(\d+)$/)?.[1];
  return suffix ? `Camara ${suffix}` : value.replace(/_/g, " ");
}

function splitMergedValues(value?: string | null) {
  return String(value || "")
    .split(/\s*\|\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function addCameraLabel(labels: Set<string>, cameraId?: string | null, cameraLabel?: string | null) {
  const mergedIds = splitMergedValues(cameraId);
  const mergedLabels = splitMergedValues(cameraLabel);
  if (mergedLabels.length) {
    mergedLabels.forEach((label) => labels.add(cameraDisplayLabel("", label) || label));
    return;
  }
  if (mergedIds.length) {
    mergedIds.forEach((id) => {
      const label = cameraDisplayLabel(id);
      if (label) labels.add(label);
    });
  }
}

export function cameraLabelsForSessionResult(sessionResult: AutomaticSessionResult) {
  const labels = new Set<string>();
  addCameraLabel(labels, sessionResult.camera_id, sessionResult.camera_label);
  sessionResult.marked?.forEach((item) => addCameraLabel(labels, item.source_camera_id, item.source_camera_label));
  sessionResult.review?.forEach((item) => addCameraLabel(labels, item.source_camera_id, item.source_camera_label));
  sessionResult.off_roster?.forEach((item) => addCameraLabel(labels, item.source_camera_id, item.source_camera_label));
  sessionResult.unknown_faces?.forEach((item) => addCameraLabel(labels, item.source_camera_id, item.source_camera_label));
  return Array.from(labels).sort((a, b) => a.localeCompare(b));
}

export function cameraLabelsForResults(results: AutomaticSessionResult[]) {
  return Array.from(new Set(results.flatMap((result) => cameraLabelsForSessionResult(result)))).sort((a, b) => a.localeCompare(b));
}

export function comparisonCameraText(item: Pick<FaceComparison, "source_camera_id" | "source_camera_label">, sessionResult?: AutomaticSessionResult) {
  const label = cameraDisplayLabel(item.source_camera_id ?? sessionResult?.camera_id, item.source_camera_label ?? sessionResult?.camera_label);
  return label ? `camara ${label.replace(/^camara\s+/i, "")}` : "";
}

export function comparisonTimeText(
  item: Pick<FaceComparison, "video_second" | "video_time" | "session_second" | "session_time" | "observed_time" | "window_phase" | "frame" | "source_window" | "source_total_frames" | "source_duration_seconds">,
  sessionResult?: AutomaticSessionResult,
) {
  const sourceWindow = item.source_window ?? sessionResult?.window;
  const sourceTotalFrames = item.source_total_frames ?? sessionResult?.total_frames;
  const sourceDurationSeconds = item.source_duration_seconds ?? sessionResult?.duration_seconds;
  const timingResult = sessionResult
    ? {
        ...sessionResult,
        window: sourceWindow,
        total_frames: sourceTotalFrames,
        duration_seconds: sourceDurationSeconds,
      }
    : undefined;
  const inferredVideoSecond =
    item.video_second ??
    (sourceDurationSeconds && sourceTotalFrames && item.frame != null
      ? (Number(item.frame) / Math.max(1, sourceTotalFrames)) * sourceDurationSeconds
      : null);
  const inferredSessionSecond = item.session_second ?? inferLegacySessionSecond(inferredVideoSecond, timingResult);
  const videoTime = item.video_time || clockFromSeconds(inferredVideoSecond);
  const observedTime = observedClockFromSession(item, inferredSessionSecond, timingResult);
  const sessionTime = item.session_time || signedClockFromSeconds(inferredSessionSecond);
  const parts = [];
  if (observedTime) parts.push(`hora ${observedTime}`);
  if (videoTime) parts.push(`video ${videoTime}`);
  if (sessionTime) parts.push(`partido ${sessionTime}`);
  const phase = inferredWindowPhase(inferredSessionSecond, item.window_phase, timingResult);
  const phaseLabel =
    phase === "pre_padding"
      ? "padding antes"
      : phase === "post_padding"
        ? "padding despues"
        : phase === "core"
          ? "tiempo real"
          : "";
  if (phaseLabel) parts.push(phaseLabel);
  return parts.join(" - ");
}
