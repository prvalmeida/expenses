import HomeView from './HomeView';
import { parseMonthParam } from '@/lib/utils/routeParams';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return <HomeView month={parseMonthParam(params.month)} />;
}
