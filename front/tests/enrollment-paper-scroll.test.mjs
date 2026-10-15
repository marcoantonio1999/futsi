import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/features/enrollments/enrollmentAdmin.css', import.meta.url), 'utf8');
test('both printable sheets allow vertical wheel/touch scroll chaining while containing horizontal overflow', () => {
  assert.match(css, /@media screen\{[\s\S]*?\.enrollment-team-roster-scroll\{overscroll-behavior-x:contain;overscroll-behavior-y:auto;touch-action:auto\}/);
  assert.doesNotMatch(css, /\.enrollment-team-roster-scroll\{[^}]*overscroll-behavior:contain/);
  assert.match(css, /\.enrollment-team-roster-scroll\{[^}]*overflow:auto/);
});
test('print still expands the paper wrapper and keeps its fixed sheet formatting', () => {
  assert.match(css, /@media print\{[^}]*\.enrollment-team-roster-scroll\{[^}]*overflow:visible!important/);
  assert.match(css, /@media print\{\.enrollment-team-roster-scroll \.match-paper\{width:190mm;min-height:0;height:267mm/);
});
