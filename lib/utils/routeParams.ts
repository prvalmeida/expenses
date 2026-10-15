// URL search-param helpers for the month-scoped screens (Início, Lançamentos). Pure, so the
// server page that reads `searchParams` and the client links that build hrefs agree on one
// grammar: `?month=YYYY-MM&mode=purchase|cashflow`.

export type ViewMode = 'purchase' | 'payment';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

type ParamValue = string | string[] | undefined;

function first(value: ParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The browser-local current month as `YYYY-MM`. */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** A valid `YYYY-MM`, or null for anything else (absent, malformed, month 13). */
export function parseMonthParam(value: ParamValue): string | null {
  const v = first(value);
  return v && MONTH_RE.test(v) ? v : null;
}

/**
 * The URL says `cashflow` (readable, and what the UI calls "Fluxo de caixa"); the screens'
 * state says `payment` because it filters on `effectiveDate`. Anything unknown is the
 * default purchase view.
 */
export function parseViewModeParam(value: ParamValue): ViewMode {
  return first(value) === 'cashflow' ? 'payment' : 'purchase';
}

/** A non-empty category name, or null. Validity against the live list is the screen's job. */
export function parseCategoryParam(value: ParamValue): string | null {
  const v = first(value)?.trim();
  return v ? v : null;
}

export function transactionsHref(month: string, mode: ViewMode, category?: string | null): string {
  const params = new URLSearchParams({ month });
  if (mode === 'payment') params.set('mode', 'cashflow');
  if (category) params.set('category', category);
  return `/transactions?${params.toString()}`;
}

export function homeHref(month: string): string {
  return `/?${new URLSearchParams({ month }).toString()}`;
}
