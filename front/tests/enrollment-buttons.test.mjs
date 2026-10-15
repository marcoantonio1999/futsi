import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const css=readFileSync('src/features/enrollments/enrollmentButtons.css','utf8');
test('enrollment button variants cover primary, outline, danger, ghost, links and portal dialogs',()=>{
  assert.match(css,/@media screen \{/);
  assert.match(css,/button\.primary/);
  assert.match(css,/\.danger,\.destructive,\.disciplinary-danger,\.tournament-team-delete-button/);
  assert.match(css,/button:is\(\.quiet,\.tournament-text-button\)/);
  assert.match(css,/\.share-link a/);
  assert.match(css,/body:has\(\.enrollment-page\) \.tournament-dialog/);
  assert.match(css,/body:has\(\.enrollment-page\) \.student-delete-dialog/);
});
test('buttons retain touch targets, focus and disabled states without changing print cards or menu visibility',()=>{
  assert.match(css,/min-height:44px!important/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/button:disabled/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(css,/\.enrollment-menu-backdrop, \.enrollment-menu-open, \.enrollment-menu-close, \.roster-player, \.enrollment-roster-card/);
  assert.doesNotMatch(css,/@media print/);
  const source=readFileSync('src/features/enrollments/PlayerEnrollment.tsx','utf8');
  assert.match(source,/import "\.\/enrollmentButtons.css"/);
});
