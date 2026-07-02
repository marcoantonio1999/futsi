export function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  return `${(size / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatSpeed(bytesPerSecond?: number | null) {
  if (!bytesPerSecond) return "-";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDuration(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "-";
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (minutes <= 0) return `${remainder}s`;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

export function elapsedSecondsSince(startedAt?: string | null, completedAt?: string | null, nowMs = Date.now()) {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  const completed = completedAt ? Date.parse(completedAt) : NaN;
  const end = Number.isFinite(completed) ? completed : nowMs;
  if (!Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 1000);
}

export function similarityPercent(value?: number) {
  return `${(((value ?? 0) * 1000) / 10).toFixed(1)}%`;
}
