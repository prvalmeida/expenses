'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardDetails from '@/components/screens/DashboardDetails';
import { currentMonth, transactionsHref, type ViewMode } from '@/lib/utils/routeParams';

// The screen is controlled by the URL: a change replaces the search params (no history
// entry per month) and the same mounted screen re-renders, so its loaded data is kept.
export default function TransactionsView({ month, mode, category, subcategory }: {
  month: string | null;
  mode: ViewMode;
  category: string | null;
  subcategory: string | null;
}) {
  const router = useRouter();
  const [fallback] = useState(currentMonth);
  return (
    <DashboardDetails
      month={month ?? fallback}
      mode={mode}
      category={category}
      subcategory={subcategory}
      onChange={next => router.replace(transactionsHref(next.month, next.mode, next.category, next.subcategory), { scroll: false })}
    />
  );
}
