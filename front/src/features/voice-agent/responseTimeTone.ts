export type ResponseTimeTone = "green" | "yellow" | "orange" | "red" | "neutral";

export function responseTimeTone(seconds: number | null | undefined, unanswered = false, historical = false): ResponseTimeTone {
  if (unanswered) return "red";
  if (seconds == null || !Number.isFinite(seconds)) return "neutral";
  if (seconds <= 20 * 60) return "green";
  if (seconds > 60 * 60) return "red";
  if (!historical && seconds >= 40 * 60) return "orange";
  return "yellow";
}
