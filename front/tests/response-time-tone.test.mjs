import test from "node:test";
import assert from "node:assert/strict";
import { responseTimeTone } from "../src/features/voice-agent/responseTimeTone.ts";

test("summary response thresholds include exact boundaries", () => {
  for (const [seconds, tone] of [[0,"green"],[1200,"green"],[1201,"yellow"],[2399,"yellow"],[2400,"orange"],[3600,"orange"],[3601,"red"]]) {
    assert.equal(responseTimeTone(seconds), tone);
  }
  assert.equal(responseTimeTone(null), "neutral");
  assert.equal(responseTimeTone(NaN), "neutral");
});
test("history uses yellow through one hour and unanswered always red", () => {
  assert.equal(responseTimeTone(1200, false, true), "green");
  assert.equal(responseTimeTone(2400, false, true), "yellow");
  assert.equal(responseTimeTone(3600, false, true), "yellow");
  assert.equal(responseTimeTone(3601, false, true), "red");
  assert.equal(responseTimeTone(60, true, true), "red");
  assert.equal(responseTimeTone(null, true), "red");
});
