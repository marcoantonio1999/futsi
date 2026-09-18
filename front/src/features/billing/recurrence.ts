export function recurrenceDates(month: string, day: number, count: number, interval = 1): string[] {
  if (!/^\d{4}-\d{2}$/.test(month) || ![day, count, interval].every(Number.isInteger) || day < 1 || day > 31 || count < 1 || count > 120 || interval < 1 || interval > 12) return [];
  const [year, start] = month.split("-").map(Number);
  if (start < 1 || start > 12 || year < 1900 || year > 9800) return [];
  return Array.from({ length: count }, (_, index) => {
    const offset = year * 12 + start - 1 + index * interval;
    const y = Math.floor(offset / 12), m = offset % 12 + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
  });
}
