import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { enrollmentScreenFromHash, enrollmentScreenUrl } from '../src/features/enrollments/enrollmentHistory.ts';

test('players is an addressable enrollment section that survives reload', () => {
  const screen = enrollmentScreenFromHash('#/admin/inscripciones/players');
  assert.equal(screen.section, 'players');
  assert.equal(enrollmentScreenUrl(screen), '#/admin/inscripciones/players');
});

test('directory preserves multiple memberships and avoids background polling/private media', () => {
  const source = readFileSync(new URL('../src/features/enrollments/PlayersDirectory.tsx', import.meta.url), 'utf8');
  assert.match(source, /player\.participations\.map/);
  assert.match(source, /useEnrollmentViewState\('players\.page'/);
  assert.match(source, /signal: controller\.signal/);
  assert.doesNotMatch(source, /setInterval|\/documents\/|\/photos\//);
});

test('mobile cards and controls do not change A4 printing', () => {
  const css = readFileSync(new URL('../src/features/enrollments/playersDirectory.css', import.meta.url), 'utf8');
  assert.match(css, /max-width:700px/);
  assert.match(css, /max-width:380px/);
  assert.match(css, /min-height:44px/);
  assert.doesNotMatch(css, /@media print|\.match-paper|\.roster-sheet/);
});
