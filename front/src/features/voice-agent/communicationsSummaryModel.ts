import type { WhatsAppConversation } from "../../types";
import { auditPeriods, type AuditRange } from "./auditPeriods.ts";

export function buildRangeMessageTrend(conversations: WhatsAppConversation[], range: AuditRange, end = new Date()): WeeklyMessageTrendRow[] {
  const days = auditPeriods.find(item => item.key === range)!.days;
  const endTime = end.getTime(), startTime = endTime - days * 86400000;
  const bucketSize = range === 'day' ? 3600000 : 86400000;
  const formatter = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', ...(range === 'day' ? { hour: 'numeric' as const } : { day: 'numeric' as const, month: 'short' as const }) });
  const rows = Array.from({ length: (endTime-startTime)/bucketSize }, (_, index) => ({ week: new Date(startTime+index*bucketSize).toISOString(), label: formatter.format(startTime+index*bucketSize), received: 0, replied: 0, waiting: 0, attended: 0 }));
  for (const conversation of conversations) {
    const messages = conversation.messages.filter(message => message.event_type !== 'revoked' && Date.parse(message.created_at) < endTime).sort((a,b) => Date.parse(b.created_at)-Date.parse(a.created_at) || b.id-a.id);
    let laterOutbound = false;
    for (const message of messages) {
      const time = Date.parse(message.created_at);
      const row = time >= startTime ? rows[Math.floor((time-startTime)/bucketSize)] : undefined;
      if (message.direction === 'outbound') { laterOutbound = true; if (row) row.replied++; }
      else if (row) { row.received++; if (laterOutbound) row.attended++; else row.waiting++; }
    }
  }
  return rows;
}

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
