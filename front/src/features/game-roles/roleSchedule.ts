export type RoleSlot = { day: string; start: string; end: string; color?: string };
type Block = readonly [start: string, color?: string];
type Schedule = Partial<Record<number, readonly Block[]>>;

const purple = "#cc99ff";
const pink = "#ff99ff";
const cyan = "#00ffff";
const gold = "#ffd966";

// Liga Franco, confirmation blocks in ROLES AP TERMINADOS.xlsx (Z:AA).
// Weekdays follow Date.getUTCDay(): Sunday = 0.
const francoSchedules: Record<string, Schedule> = {
  premier: {
    2: [["20:00", purple], ["20:50", purple]],
    3: [["20:00", "#ff0066"], ["20:50", "#ff0066"]],
    4: [["20:00", cyan], ["20:50", cyan]],
  },
  nocturno: {
    1: [["22:30", purple]],
    2: [["22:30", pink]],
    3: [["21:40", cyan], ["22:40", cyan]],
    4: [["21:40", gold], ["22:40", gold]],
  },
  espanola: {
    6: [["09:00", purple], ["09:50", cyan], ["10:40", "#a9d18e"], ["11:30", pink],
        ["12:20", "#66ff99"], ["13:10", cyan], ["14:00", gold]],
  },
  eurocopa: {
    6: [["14:50"], ["15:40"], ["16:30"], ["17:20"], ["18:10"], ["19:00"], ["19:50"]],
  },
  uefa: {
    0: [["14:00"], ["14:50"], ["15:40"], ["16:30"], ["17:20"], ["18:10"], ["19:00"], ["19:50"]],
  },
};

export function roleSchedule(siteId: number, tournamentName: string): Schedule | undefined {
  const name = tournamentName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const type = /^premier (?:l\.?|liga(?: \d{4})?)$/.test(name) ? "premier" : name;
  return siteId === 27 && Object.hasOwn(francoSchedules, type) ? francoSchedules[type] : undefined;
}

export function roleSlots(schedule: Schedule | undefined, day: string): RoleSlot[] {
  const weekday = new Date(day + "T00:00:00Z").getUTCDay();
  return (schedule?.[weekday] ?? []).map(([start, color]) => {
    const [hour, minute] = start.split(":").map(Number);
    const end = hour * 60 + minute + 50;
    return { day, start, end: [Math.floor(end / 60), end % 60].map(value => String(value).padStart(2, "0")).join(":"), color };
  });
}

export type RoleSchedule = ReturnType<typeof roleSchedule>;

export function roleTimeLabel(tournament: string, start?: string | null, end?: string | null) {
  if (!start) return "";
  const time = start.slice(0, 5);
  if (tournament.trim().toLowerCase() === "nocturno") {
    const [hour, minute] = time.split(":");
    return `${Number(hour) % 12 || 12}:${minute}`;
  }
  return end ? `${time}–${end.slice(0, 5)}` : time;
}
