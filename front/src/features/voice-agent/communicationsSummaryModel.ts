import type { WhatsAppConversation } from "../../types";

export type MonthlyMessageTrendRow = {
  month: string;
  label: string;
  received: number;
  replied: number;
  waiting: number;
  attended: number;
};

function monthKey(value: string) {
  const match = /^\d{4}-\d{2}/.exec(value);
  return match?.[0] ?? "";
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("es-MX", { month: "short", year: "2-digit", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)))
    .replace(" de ", " ");
}

function recentMonthKeys(end: Date, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (count - index - 1), 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export function buildMonthlyMessageTrend(
  conversations: WhatsAppConversation[],
  end = new Date(),
  monthCount = 6,
): MonthlyMessageTrendRow[] {
  const keys = recentMonthKeys(end, monthCount);
  const rows = new Map(keys.map(month => [month, {
    month,
    label: monthLabel(month),
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
      const row = rows.get(monthKey(message.created_at));
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
