import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { calendarDateValue, parseCalendarDate, displayCalendarDate } from '../src/features/enrollments/enrollmentDates.ts';

test('calendar values preserve local date-only birthdays, leap years and sanction dates', () => {
  for (const value of ['2003-07-13','2000-02-29','2026-10-15','2026-12-31']) assert.equal(calendarDateValue(parseCalendarDate(value)), value);
  for (const value of ['', '2026-02-29', '2026-04-31', '2026-13-01', '2026-1-02', '2026-10-15T00:00:00Z']) assert.equal(parseCalendarDate(value), undefined);
  assert.equal(calendarDateValue(), '');
  assert.ok(displayCalendarDate('2003-07-13').includes('2003'));
});
test('birth picker and sanction range use the shadcn Base composition with Spanish calendar and accessible dismissal', () => {
  const picker = readFileSync('src/features/enrollments/EnrollmentDatePicker.tsx','utf8');
  const sanction = readFileSync('src/features/enrollments/NewSanction.tsx','utf8');
  const page = readFileSync('src/features/enrollments/PlayerEnrollment.tsx','utf8');
  assert.match(picker, /@base-ui\/react\/popover/);
  assert.match(picker, /react-day-picker\/locale/);
  assert.match(picker, /captionLayout="dropdown"/);
  assert.match(picker, /mode="range" locale=\{es\}/);
  assert.match(picker, /modal="trap-focus"/);
  assert.match(picker, /Popover.Close/);
  assert.match(picker, /className="enrollment-date-reset" onClick=\{\(\) => setDraft\(undefined\)\}/);
  assert.match(picker, /name="starts_on" value=\{from\}/);
  assert.match(picker, /name="ends_on" value=\{to\}/);
  assert.match(picker, /El último día también cuenta como sancionado/);
  assert.match(sanction, /useState\('dates'\)/);
  assert.match(sanction, /starts<incident/);
  assert.match(sanction, /ends<starts/);
  assert.match(sanction, /changedDate\(\)/);
  assert.match(page, /EnrollmentDatePicker label="Fecha de nacimiento" name="birth_date" required birthday/);
});
