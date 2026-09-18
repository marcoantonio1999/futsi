import test from 'node:test';
import assert from 'node:assert/strict';
import { recurrenceDates } from '../src/features/billing/recurrence.ts';

test('six and fifteen monthly installments stay on day 7', () => {
  const six = recurrenceDates('2026-09', 7, 6);
  assert.equal(six.length, 6); assert.equal(six.at(-1), '2027-02-07');
  assert.equal(recurrenceDates('2026-09', 7, 15).at(-1), '2027-11-07');
});
test('month ends recover the selected day and support leap years and intervals', () => {
  assert.deepEqual(recurrenceDates('2028-01', 31, 3), ['2028-01-31','2028-02-29','2028-03-31']);
  assert.deepEqual(recurrenceDates('2026-12', 7, 3, 2), ['2026-12-07','2027-02-07','2027-04-07']);
});
test('invalid and unbounded schedules are rejected', () => {
  for (const args of [['',7,6],['2026-13',7,6],['2026-09',32,6],['2026-09',7,121],['2026-09',7,6,0]]) assert.deepEqual(recurrenceDates(...args), []);
});
