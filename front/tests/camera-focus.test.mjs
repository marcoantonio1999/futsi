import test from "node:test";
import assert from "node:assert/strict";
import { enableContinuousFocus } from "../src/features/enrollments/cameraFocus.ts";

test("requests continuous autofocus while retaining camera constraints", async () => {
  let applied;
  const track = {
    getCapabilities: () => ({ focusMode: ["manual", "continuous"] }),
    getConstraints: () => ({ width: { ideal: 1920 } }),
    applyConstraints: async value => { applied = value; },
  };
  await enableContinuousFocus(track);
  assert.deepEqual(applied, { width: { ideal: 1920 }, advanced: [{ focusMode: "continuous" }] });
});

test("unsupported and rejected focus settings leave the camera usable", async () => {
  let attempts = 0;
  await enableContinuousFocus({ getCapabilities: () => ({}), applyConstraints: async () => { attempts++; } });
  await enableContinuousFocus({ getCapabilities: () => ({ focusMode: ["continuous"] }), getConstraints: () => ({}), applyConstraints: async () => { attempts++; throw new Error("unsupported"); } });
  await enableContinuousFocus({});
  assert.equal(attempts, 1);
});
