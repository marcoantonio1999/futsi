import assert from 'node:assert/strict';
import test from 'node:test';
import {enrollmentSignatureKind} from '../src/features/enrollments/enrollmentSignature.ts';
test('only the tutor signs a minor enrollment, including historical sheets',()=>{
  assert.equal(enrollmentSignatureKind({identity_type:'minor'}),'guardian_signature');
  for(const identity_type of ['ine','passport','military_card'])assert.equal(enrollmentSignatureKind({identity_type}),'player_signature');
  assert.equal(enrollmentSignatureKind({}),'player_signature');
});
