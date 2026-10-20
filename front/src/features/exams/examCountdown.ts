export function remainingExamSeconds(durationMinutes: number, elapsedSeconds: number) {
  return Math.max(0, Math.ceil(durationMinutes * 60 - elapsedSeconds));
}
export function formatExamCountdown(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`;
}
