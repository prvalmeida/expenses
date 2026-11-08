import { daysInMonth } from './forecast';

// Pure date helpers shared by reportService (server) and the telegram:* CLIs.
// No mongoose here on purpose: the scripts are HTTP clients and must not pull a
// database driver in just to know what day it is.

// The app is used from Brasília, the server runs in UTC. `todayLocal()`
// (monthUtils) reads the process clock, so at 21:00 BRT it would already be
// tomorrow — enough to move a report into the next month.
export const REPORT_TIME_ZONE = 'America/Sao_Paulo';

export function todayInReportTimeZone(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Last calendar day of `YYYY-MM`. */
export function lastDayOfMonth(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}

/**
 * Which month a forecast reports on, and from which day.
 *
 * A `today` sent without `month` decides the month: pairing it with the real
 * current month would read the day number of one month against the rows of
 * another (`?today=2026-01-05` in November = "November, day 5").
 * Reporting a month other than this one with no `today` only makes sense from
 * its last day: that is what the weekly job does on the first days of a month.
 */
export function resolveForecastPeriod(
  query: { month?: string; today?: string },
  localToday: string = todayInReportTimeZone()
): { month: string; today: string } {
  const currentMonth = localToday.slice(0, 7);
  const month = query.month ?? query.today?.slice(0, 7) ?? currentMonth;
  const today = query.today ?? (month === currentMonth ? localToday : lastDayOfMonth(month));
  return { month, today };
}
