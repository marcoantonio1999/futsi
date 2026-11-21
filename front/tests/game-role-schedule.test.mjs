import assert from "node:assert/strict";
import test from "node:test";
import { roleSchedule, roleSlots } from "../src/features/game-roles/roleSchedule.ts";

const week = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"];
const schedule = name => roleSchedule(27, name);
const times = (name, day) => roleSlots(schedule(name), week[day]).map(slot => slot.start);

test("Liga Franco uses the tournament and weekday from the spreadsheet", () => {
  assert.deepEqual(times("premier liga 2026", 0), []);
  assert.deepEqual(times("PREMIER L.", 1), ["20:00", "20:50"]);
  assert.deepEqual(times("Premier", 2), ["20:00", "20:50"]);
  assert.deepEqual(times("Premier", 3), ["20:00", "20:50"]);
  assert.deepEqual(times("Nocturno", 0), ["22:30"]);
  assert.deepEqual(times("Nocturno", 1), ["22:30"]);
  assert.deepEqual(times("Nocturno", 2), ["21:40", "22:40"]);
  assert.deepEqual(times("Nocturno", 3), ["21:40", "22:40"]);
  assert.deepEqual(times("Nocturno", 4), []);
  assert.deepEqual(times("Española", 5), ["09:00", "09:50", "10:40", "11:30", "12:20", "13:10", "14:00"]);
  assert.deepEqual(times("Eurocopa", 5), ["14:50", "15:40", "16:30", "17:20", "18:10", "19:00", "19:50"]);
  assert.deepEqual(times("UEFA", 6), ["14:00", "14:50", "15:40", "16:30", "17:20", "18:10", "19:00", "19:50"]);
  assert.equal(roleSlots(schedule("Nocturno"), week[2])[0].color, "#00ffff");
  assert.equal(schedule("Femenil"), undefined);
  assert.equal(schedule("Brasileña"), undefined);
  assert.equal(roleSchedule(1, "UEFA"), undefined);
});

test("the reference blocks do not overlap on any day", () => {
  for (const day of week) {
    const slots = ["Premier", "Nocturno", "Española", "Eurocopa", "UEFA"]
      .flatMap(name => roleSlots(schedule(name), day)).sort((a, b) => a.start.localeCompare(b.start));
    assert(slots.every((slot, index) => index === 0 || slots[index - 1].end <= slot.start), day);
  }
});
