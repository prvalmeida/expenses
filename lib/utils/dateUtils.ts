/**
 * Adds `months` to a YYYY-MM-DD date string, clamping the day to the last
 * valid day of the target month instead of overflowing to the next month.
 * e.g. addMonthsClamped('2025-03-31', 1) → 2025-04-30  (not 2025-05-01)
 */
export function addMonthsClamped(dateStr: string, months: number): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const totalMonths = (month - 1) + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12; // 0-based
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
}
