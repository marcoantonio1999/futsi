import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { birthDateError, documentErrors, playerFieldErrors } from '../src/features/enrollments/enrollmentValidation.ts';

test('birth date requires a real, non-future date within the supported range', () => {
  for (const date of ['', '2026-02-30', '2027-01-01', '1900-01-01']) assert.ok(birthDateError(date, '2026-10-15'));
  assert.equal(birthDateError('2003-07-13', '2026-10-15'), '');
});
test('all missing documents are returned together and oversized files remain invalid', () => {
  assert.deepEqual(Object.keys(documentErrors(['ine_front', 'ine_back'], {}, {})), ['ine_front', 'ine_back']);
  assert.deepEqual(documentErrors(['ine_front'], { ine_front: new Blob(['test']) }, {}), {});
  assert.ok(documentErrors(['ine_front'], { ine_front: { size: 20_000_001 } }, {}).ine_front);
});
test('all missing names and contact fields have individual errors, including whitespace', () => {
  assert.deepEqual(Object.keys(playerFieldErrors({ given_names: '   ' }, true)), ['given_names', 'paternal_surname', 'maternal_surname', 'phone', 'guardian_name']);
  assert.deepEqual(playerFieldErrors({ given_names: 'José Luis', paternal_surname: 'Pérez', maternal_surname: 'Orduña', phone: '5512345678' }, false), {});
});
test('name errors identify the relevant field and total length marks all name parts', () => {
  const values = { given_names: 'José', paternal_surname: '123', maternal_surname: 'López', phone: '5512345678' };
  assert.deepEqual(Object.keys(playerFieldErrors(values, false)), ['paternal_surname']);
  assert.equal(Object.keys(playerFieldErrors({ ...values, given_names: 'a'.repeat(80), paternal_surname: 'b'.repeat(80) }, false)).length, 3);
});
test('wizard binds inline errors to fields, focuses the first issue and retains signed-file checks', () => {
  const source = readFileSync(new URL('../src/features/enrollments/PlayerEnrollment.tsx', import.meta.url), 'utf8');
  for (const name of ['accepted_terms', 'birth_date', 'player_photo', 'given_names', 'paternal_surname', 'maternal_surname', 'phone', 'guardian_name']) assert.ok(source.includes(`name="${name}"`));
  assert.ok(source.includes("const signatureKind = minor ? 'guardian_signature' : 'player_signature'"));
  assert.ok(source.includes('name={signatureKind} error={fieldErrors[signatureKind]}'));
  assert.ok(source.includes('for (const signature of [signatureKind])'));
  assert.ok(source.includes("'aria-invalid': !!fieldErrors[name]"));
  assert.ok(source.includes('scrollIntoView({ block: \'center\''));
  assert.ok(source.includes('if (hasInk.current)'));
  assert.ok(source.includes('showIssues(identityIssues, 1)'));
});
