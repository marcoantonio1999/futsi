export function today() {
  return new Date().toISOString().slice(0, 10);
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

export function durationFromRange(startsAt: string, endsAt: string) {
  const starts = minutesFromTime(startsAt);
  const ends = minutesFromTime(endsAt);
  if (starts === null || ends === null) return 120;
  const normalizedEnd = ends <= starts ? ends + 24 * 60 : ends;
  return Math.max(1, normalizedEnd - starts);
}

export function billingLabel(value: string) {
  return value === "full_tournament" ? "Torneo completo" : "Pago semanal";
}
