import TransactionsView from './TransactionsView';
import { parseCategoryParam, parseMonthParam, parseViewModeParam } from '@/lib/utils/routeParams';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Month, mode and category come from the URL so a refresh or a shared link reopens the
// same view. An absent or malformed month is left null and resolved to the browser's
// current month on the client — the server's clock and time zone are not the user's.
export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <TransactionsView
      month={parseMonthParam(params.month)}
      mode={parseViewModeParam(params.mode)}
      category={parseCategoryParam(params.category)}
    />
  );
}
