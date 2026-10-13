import TransactionsView from './TransactionsView';
import { parseMonthParam, parseViewModeParam } from '@/lib/utils/routeParams';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The month and mode come from the URL so a refresh or a shared link reopens the same view.
// An absent or malformed month is left null and resolved to the browser's current month on
// the client — the server's clock and time zone are not the user's.
export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const month = parseMonthParam(params.month);
  const mode = parseViewModeParam(params.mode);
  // DashboardDetails copies its initial props into state, so a client-side navigation to
  // another month (same route, new search params) must remount it rather than re-render.
  return <TransactionsView key={`${month ?? 'current'}:${mode}`} month={month} mode={mode} />;
}
