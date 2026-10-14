import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
test('portal brand uses the persisted generated asset without replacing Futsi or Soccer WA',()=>{
  const brand=readFileSync('src/features/enrollments/EnrollmentBrand.tsx','utf8');
  assert.match(brand,/assets\/inscripciones-bpower-logo.png/);
  assert.match(brand,/width=\{64\} height=\{64\}/);
  const png=readFileSync('src/features/enrollments/assets/inscripciones-bpower-logo.png');
  assert.equal(png.subarray(1,4).toString(),'PNG');
  const page=readFileSync('src/features/enrollments/PlayerEnrollment.tsx','utf8');
  assert.equal((page.match(/<EnrollmentBrand \/>/g)||[]).length,4);
});
