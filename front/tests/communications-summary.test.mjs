import test from "node:test";
import assert from "node:assert/strict";
import { buildMonthlyMessageTrend } from "../src/features/voice-agent/communicationsSummaryModel.ts";

const message = (id, direction, created_at, event_type = "message") => ({ id, direction, created_at, event_type });
const conversations = [{
  messages: [
    message(1, "inbound", "2026-04-02T10:00:00Z"),
    message(2, "inbound", "2026-04-02T10:02:00Z"),
    message(3, "outbound", "2026-04-02T10:04:00Z"),
    message(4, "outbound", "2026-04-02T10:05:00Z"),
    message(5, "inbound", "2026-05-02T10:00:00Z"),
    message(6, "outbound", "2026-05-03T10:00:00Z"),
    message(7, "inbound", "2026-06-04T10:00:00Z"),
    message(8, "inbound", "2026-06-04T10:01:00Z", "revoked"),
  ],
}];

test("builds six chronological months and keeps the four measures in one dataset", () => {
  const rows = buildMonthlyMessageTrend(conversations, new Date("2026-06-18T12:00:00Z"));
  assert.deepEqual(rows.map(row => row.month), ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
  assert.deepEqual(rows.slice(3).map(({ received, replied, waiting, attended }) => ({ received, replied, waiting, attended })), [
    { received: 2, replied: 2, waiting: 0, attended: 2 },
    { received: 1, replied: 1, waiting: 0, attended: 1 },
    { received: 1, replied: 0, waiting: 1, attended: 0 },
  ]);
});

test("a later reply attends earlier inbound messages even when it arrives in another month", () => {
  const rows = buildMonthlyMessageTrend([{ messages: [
    message(1, "inbound", "2026-05-31T23:58:00Z"),
    message(2, "outbound", "2026-06-01T00:03:00Z"),
  ] }], new Date("2026-06-18T12:00:00Z"));
  assert.deepEqual(rows.at(-2), { month: "2026-05", label: "may 26", received: 1, replied: 0, waiting: 0, attended: 1 });
  assert.deepEqual(rows.at(-1), { month: "2026-06", label: "jun 26", received: 0, replied: 1, waiting: 0, attended: 0 });
});

test("ignores revoked messages and data outside the displayed period", () => {
  const rows = buildMonthlyMessageTrend([{ messages: [
    message(1, "inbound", "2025-12-01T10:00:00Z"),
    message(2, "inbound", "2026-06-01T10:00:00Z", "revoked"),
  ] }], new Date("2026-06-18T12:00:00Z"));
  assert.equal(rows.reduce((total, row) => total + row.received + row.replied, 0), 0);
});
