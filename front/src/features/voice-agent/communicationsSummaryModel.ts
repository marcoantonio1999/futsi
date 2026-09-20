import type { WhatsAppConversation } from "../../types";

export type WeeklyMessageTrendRow = {
  week: string;
  label: string;
  received: number;
  replied: number;
  waiting: number;
  attended: number;
};

function weekKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

function weekLabel(key: string) {
  const start = new Date(`${key}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const formatter = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${formatter.format(start).replace(" de ", " ")}–${formatter.format(end).replace(" de ", " ")}`;
}

function recentWeekKeys(end: Date, count: number) {
  const currentMonday = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  currentMonday.setUTCDate(currentMonday.getUTCDate() - ((currentMonday.getUTCDay() + 6) % 7));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(currentMonday);
    date.setUTCDate(date.getUTCDate() - (count - index - 1) * 7);
    return date.toISOString().slice(0, 10);
  });
}

export function buildWeeklyMessageTrend(
  conversations: WhatsAppConversation[],
  end = new Date(),
  weekCount = 6,
): WeeklyMessageTrendRow[] {
  const keys = recentWeekKeys(end, weekCount);
  const rows = new Map(keys.map(week => [week, {
    week,
    label: weekLabel(week),
    received: 0,
    replied: 0,
    waiting: 0,
    attended: 0,
  }]));

  conversations.forEach(conversation => {
    const messages = conversation.messages
      .filter(message => message.event_type !== "revoked")
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
    let laterOutbound = false;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const row = rows.get(weekKey(message.created_at));
      if (message.direction === "outbound") {
        laterOutbound = true;
        if (row) row.replied += 1;
        continue;
      }
      if (!row) continue;
      row.received += 1;
      if (laterOutbound) row.attended += 1;
      else row.waiting += 1;
    }
  });

  return keys.map(key => rows.get(key)!);
}
