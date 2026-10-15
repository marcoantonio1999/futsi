import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const css=readFileSync('src/features/enrollments/enrollmentSelects.css','utf8');
test('native select styling is scoped to enrollments and their portal dialogs, excluding calendar dropdowns',()=>{
  assert.match(css,/@media screen \{/);
  assert.match(css,/body:has\(\.enrollment-page\) \.tournament-dialog/);
  assert.match(css,/body:has\(\.enrollment-page\) \.student-delete-dialog/);
  assert.match(css,/select:not\(\[multiple\]\):not\(\[size\]\):not\(\.rdp-dropdown\)/);
  assert.match(css,/border-radius:8px!important/);
  assert.match(css,/background-position:right 12px center/);
  assert.doesNotMatch(css,/@media print/);
});
test('selects keep touch targets, disabled and keyboard focus states, mobile font sizing and forced colors',()=>{
  assert.match(css,/min-height:44px!important/);
  assert.match(css,/font-size:16px!important/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/:disabled/);
  assert.match(css,/forced-colors:active/);
  assert.match(css,/prefers-reduced-motion/);
  const page=readFileSync('src/features/enrollments/PlayerEnrollment.tsx','utf8');
  assert.match(page,/import "\.\/enrollmentSelects.css"/);
  assert.match(page,/Equipo del torneo<select required value=\{inviteTeam\} disabled=/);
});
