export type RoleSlot = { day: string; start: string; end: string };
export type ExtraScheduleBlock = { scheduled_on: string; starts_at: string; ends_at: string };
export type WeeklyBlock = { weekday: number; starts_at: string; ends_at: string };
export type RoleSchedule = readonly WeeklyBlock[];

export function roleSlots(schedule: RoleSchedule, day: string): RoleSlot[] {
  const weekday = new Date(day + "T00:00:00Z").getUTCDay();
  return schedule.filter(block => block.weekday === weekday)
    .map(block => ({ day, start: block.starts_at, end: block.ends_at }));
}

export function datedRoleSlots(schedule: RoleSchedule, extras: readonly ExtraScheduleBlock[], day: string) {
  const slots = roleSlots(schedule, day).map(slot => ({ ...slot, extra: false }));
  for (const block of extras) {
    if (block.scheduled_on !== day) continue;
    if (!slots.some(slot => slot.start === block.starts_at && slot.end === block.ends_at)) {
      slots.push({ day, start: block.starts_at, end: block.ends_at, extra: true });
    }
  }
  return slots.sort((first, second) => first.start.localeCompare(second.start));
}

export function showsKickoffOnly(tournament: string) {
  return /^(?:nocturno|premier(?: l\.?| liga(?: \d{4})?)?)$/i.test(tournament.trim());
}

export function roleTimeLabel(tournament: string, start?: string | null, end?: string | null) {
  if (!start) return "";
  const time = start.slice(0, 5);
  if (showsKickoffOnly(tournament)) {
    const [hour, minute] = time.split(":");
    return `${Number(hour) % 12 || 12}:${minute}`;
  }
  return end ? `${time}–${end.slice(0, 5)}` : time;
}
