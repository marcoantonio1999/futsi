export type RoleSlot = { day: string; start: string; end: string };
export type WeeklyBlock = { weekday: number; starts_at: string; ends_at: string };
export type RoleSchedule = readonly WeeklyBlock[];

export function roleSlots(schedule: RoleSchedule, day: string): RoleSlot[] {
  const weekday = new Date(day + "T00:00:00Z").getUTCDay();
  return schedule.filter(block => block.weekday === weekday)
    .map(block => ({ day, start: block.starts_at, end: block.ends_at }));
}

export function roleTimeLabel(tournament: string, start?: string | null, end?: string | null) {
  if (!start) return "";
  const time = start.slice(0, 5);
  if (tournament.trim().toLowerCase() === "nocturno") {
    const [hour, minute] = time.split(":");
    return `${Number(hour) % 12 || 12}:${minute}`;
  }
  return end ? `${time}–${end.slice(0, 5)}` : time;
}
