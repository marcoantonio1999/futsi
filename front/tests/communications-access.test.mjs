import test from "node:test";
import assert from "node:assert/strict";
import { isCourtCommunicationsSection } from "../src/features/voice-agent/CommunicationsAccess.ts";

test("court communications accounts receive their scoped audit subsections", () => {
  for (const section of ["whatsapp", "templates", "bulk-academy", "bulk-academy-history", "summary", "chat-quality", "weekly-stats"]) {
    assert.equal(isCourtCommunicationsSection(section), true, section);
  }
  for (const section of ["template-builder", "veronica", "settings", "agenda"]) {
    assert.equal(isCourtCommunicationsSection(section), false, section);
  }
});
