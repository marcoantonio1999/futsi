import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const source = readFileSync(new URL("../src/features/enrollments/PlayerEnrollment.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/features/enrollments/enrollmentAdmin.css", import.meta.url), "utf8");

test("public wizard reserves viewport space for branding and keeps actions inside the screen", () => {
  assert.match(css, /\.public-enrollment-wizard\{display:flex;flex-direction:column;height:100vh;height:100dvh/);
  assert.match(css, /\.public-enrollment-wizard>\.enrollment-public-brand\{flex-shrink:0\}/);
  assert.match(css, /\.public-enrollment-wizard \.enrollment-wizard-sheet\{[^}]*flex:1;min-height:0/);
  assert.doesNotMatch(css, /\.public-enrollment-wizard \.enrollment-wizard-sheet\{[^}]*height:100%/);
  assert.match(css, /\.enrollment-wizard-content\{flex:1;min-height:0;overflow:auto/);
  assert.match(css, /safe-area-inset-bottom/);
});
test("mobile menu uses the same navigation, with accessible open/close controls", () => {
  assert.match(source, /aria-label="Abrir secciones" aria-expanded=\{mobileMenuOpen\}/);
  assert.match(source, /aria-controls="enrollment-sections-menu"/);
  assert.equal((source.match(/aria-label="Administración de inscripciones"/g) || []).length, 1);
  assert.match(source, /setPrintRoster\(false\); setMobileMenuOpen\(false\)/);
});
test("drawer closes on Escape, traps keyboard focus, restores scroll and handles desktop resize", () => {
  assert.match(source, /event.key === "Escape"/);
  assert.match(source, /document.body.style.overflow = previousOverflow/);
  assert.match(source, /menuButtonRef.current\?\.focus\(\)/);
  assert.match(source, /if \(!media.matches\) setMobileMenuOpen\(false\)/);
});
test("mobile layouts remove permanent side column, retain local scrolling and preserve print", () => {
  assert.doesNotMatch(css, /grid-template-columns:170px/);
  assert.match(css, /@media screen and \(max-width:1023px\)/);
  assert.match(css, /width:min\(86vw,300px\)/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /overflow-x:auto/);
  assert.match(css, /@media print/);
  assert.match(css, /prefers-reduced-motion/);
});
