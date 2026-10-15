// Date-only values must not pass through UTC: birthdays and sanction days are local dates.
export function parseCalendarDate(value?: string): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined;
}
export function calendarDateValue(date?: Date): string {
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
}
export function displayCalendarDate(value: string): string {
  return parseCalendarDate(value)?.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) || '';
}
