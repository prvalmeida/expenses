// Month arithmetic and labels for the month-scoped screens. Dates are the stored
// `YYYY-MM-DD` strings; comparing their prefix avoids the time-zone shifts a `new Date()`
// round-trip invites.

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** True when a `YYYY-MM-DD` (or longer ISO) date falls in the `YYYY-MM` month. */
export function isInMonth(date: string | undefined, month: string): boolean {
  return !!date && date.slice(0, 7) === month;
}

/** `YYYY-MM` shifted by `delta` months, across year boundaries. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12 + 12) % 12 + 1).padStart(2, '0')}`;
}

/** `Outubro 2026` */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const name = MONTHS[m - 1] ?? '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

/** `outubro` — for sentences such as "Gastos em outubro". */
export function monthName(month: string): string {
  return MONTHS[Number(month.split('-')[1]) - 1] ?? '';
}

/** `12/10` — the short date list rows show. */
export function shortDate(date: string): string {
  const [, m, d] = date.slice(0, 10).split('-');
  return `${d}/${m}`;
}

/** `12 de outubro` — the day-group heading. */
export function dayHeading(date: string): string {
  const [, m, d] = date.slice(0, 10).split('-').map(Number);
  return `${d} de ${MONTHS[m - 1] ?? ''}`;
}
