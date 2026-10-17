import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/features/voice-agent/communications.css", import.meta.url), "utf8");

test("response history chains vertical scrolling to the audit page at both edges", () => {
  const rule = css.match(/\.comm-response-history\{([^}]+)\}/)?.[1];
  assert.ok(rule, "history scroll container must have a scoped rule");
  assert.match(rule, /overflow:auto/);
  assert.match(rule, /max-height:min\(60vh,620px\)/);
  assert.match(rule, /overscroll-behavior-y:auto/);
  assert.match(rule, /overscroll-behavior-x:contain/);
  assert.doesNotMatch(rule, /overscroll-behavior:(?:contain|none)/);
});

test("history keeps its sticky header and mobile page scrolling", () => {
  assert.match(css, /\.comm-response-history thead\{position:sticky;top:0/);
  assert.match(css, /@media\(max-width:767px\)\{\.comm-audit-page\{height:auto;min-height:0;overflow:visible\}\.comm-audit-content\{overflow:visible;padding-right:0\}\}/);
});
