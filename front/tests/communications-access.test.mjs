import test from "node:test";
import assert from "node:assert/strict";
import { isCourtCommunicationsSection } from "../src/features/voice-agent/CommunicationsAccess.ts";

test("court communications accounts only receive inbox, templates and bulk sends", () => {
  for (const section of ["whatsapp", "templates", "bulk-academy", "bulk-academy-history"]) {
    assert.equal(isCourtCommunicationsSection(section), true, section);
  }
  for (const section of ["summary", "weekly-stats", "template-builder", "veronica", "settings", "agenda"]) {
    assert.equal(isCourtCommunicationsSection(section), false, section);
  }
});
