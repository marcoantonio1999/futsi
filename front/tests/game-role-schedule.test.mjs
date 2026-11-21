import assert from "node:assert/strict";
import test from "node:test";
import { roleSlots, roleTimeLabel } from "../src/features/game-roles/roleSchedule.ts";

test("the match picker uses only blocks for the selected weekday and preserves their duration", () => {
  const schedule = [
    { weekday: 2, starts_at: "20:00", ends_at: "20:50" },
    { weekday: 3, starts_at: "21:40", ends_at: "22:30" },
    { weekday: 3, starts_at: "22:40", ends_at: "23:20" },
  ];
  assert.deepEqual(roleSlots(schedule, "2026-11-25"), [
    { day: "2026-11-25", start: "21:40", end: "22:30" },
    { day: "2026-11-25", start: "22:40", end: "23:20" },
  ]);
  assert.deepEqual(roleSlots(schedule, "2026-11-26"), []);
  assert.equal(roleTimeLabel("Nocturno", "21:40", "22:30"), "9:40");
  assert.equal(roleTimeLabel("premier liga 2026", "20:00", "20:50"), "8:00");
  assert.equal(roleTimeLabel("UEFA", "14:00", "14:50"), "14:00–14:50");
});
