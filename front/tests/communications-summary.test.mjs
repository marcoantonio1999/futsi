import test from "node:test";
import assert from "node:assert/strict";
import { buildWeeklyMessageTrend, buildRangeMessageTrend } from "../src/features/voice-agent/communicationsSummaryModel.ts";
import { auditPeriods } from "../src/features/voice-agent/auditPeriods.ts";

test('four rolling presets filter exact boundaries and retain hourly/day buckets', () => {
  const end=new Date('2026-10-13T00:00:00Z');
  assert.deepEqual(auditPeriods.map(row=>row.days),[7,3,1,30]);
  for (const {key,days} of auditPeriods) {
    const start=end.getTime()-days*86400000;
    const rows=buildRangeMessageTrend([{messages:[
      message(1,'inbound',new Date(start-1).toISOString()),
      message(2,'inbound',new Date(start).toISOString()),
      message(3,'outbound',new Date(end.getTime()-1).toISOString()),
      message(4,'inbound',end.toISOString()),
      message(5,'inbound',new Date(start+1).toISOString(),'revoked'),
    ]}],key,end);
    assert.equal(rows.length,key==='day'?24:days);
    assert.equal(rows.reduce((sum,row)=>sum+row.received,0),1);
    assert.equal(rows.reduce((sum,row)=>sum+row.replied,0),1);
    assert.equal(rows.reduce((sum,row)=>sum+row.attended,0),1);
  }
});

const message = (id, direction, created_at, event_type = "message") => ({ id, direction, created_at, event_type });
const conversations = [{
  messages: [
    message(1, "inbound", "2026-05-12T10:00:00Z"),
    message(2, "inbound", "2026-05-12T10:02:00Z"),
    message(3, "outbound", "2026-05-12T10:04:00Z"),
    message(4, "outbound", "2026-05-12T10:05:00Z"),
    message(5, "inbound", "2026-06-02T10:00:00Z"),
    message(6, "outbound", "2026-06-03T10:00:00Z"),
    message(7, "inbound", "2026-06-16T10:00:00Z"),
    message(8, "inbound", "2026-06-16T10:01:00Z", "revoked"),
  ],
}];

test("builds six chronological weeks and keeps the four measures in one dataset", () => {
  const rows = buildWeeklyMessageTrend(conversations, new Date("2026-06-18T12:00:00Z"));
  assert.deepEqual(rows.map(row => row.week), ["2026-05-11", "2026-05-18", "2026-05-25", "2026-06-01", "2026-06-08", "2026-06-15"]);
  assert.deepEqual(rows.map(({ received, replied, waiting, attended }) => ({ received, replied, waiting, attended })), [
    { received: 2, replied: 2, waiting: 0, attended: 2 },
    { received: 0, replied: 0, waiting: 0, attended: 0 },
    { received: 0, replied: 0, waiting: 0, attended: 0 },
    { received: 1, replied: 1, waiting: 0, attended: 1 },
    { received: 0, replied: 0, waiting: 0, attended: 0 },
    { received: 1, replied: 0, waiting: 1, attended: 0 },
  ]);
});

test("a later reply attends earlier inbound messages even when it arrives in another week", () => {
  const rows = buildWeeklyMessageTrend([{ messages: [
    message(1, "inbound", "2026-05-31T23:58:00Z"),
    message(2, "outbound", "2026-06-01T00:03:00Z"),
  ] }], new Date("2026-06-18T12:00:00Z"));
  assert.deepEqual(rows.at(-4), { week: "2026-05-25", label: "25 may–31 may", received: 1, replied: 0, waiting: 0, attended: 1 });
  assert.deepEqual(rows.at(-3), { week: "2026-06-01", label: "1 jun–7 jun", received: 0, replied: 1, waiting: 0, attended: 0 });
});

test("ignores revoked messages and data outside the displayed period", () => {
  const rows = buildWeeklyMessageTrend([{ messages: [
    message(1, "inbound", "2026-04-01T10:00:00Z"),
    message(2, "inbound", "2026-06-01T10:00:00Z", "revoked"),
  ] }], new Date("2026-06-18T12:00:00Z"));
  assert.equal(rows.reduce((total, row) => total + row.received + row.replied, 0), 0);
});
