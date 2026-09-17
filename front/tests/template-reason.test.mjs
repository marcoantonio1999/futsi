import assert from "node:assert/strict";
import test from "node:test";
import { reportedTemplateReason } from "../src/features/voice-agent/templateReason.ts";

test("provider placeholders are not shown as rejection reasons", () => {
  for (const value of ["", "   ", "NONE", "none", "NULL", "N/A", "NOT_APPLICABLE", null, undefined]) {
    assert.equal(reportedTemplateReason(value), "");
  }
});

test("a real rejection reason remains visible", () => {
  assert.equal(reportedTemplateReason("  Revisa las variables  "), "Revisa las variables");
});
