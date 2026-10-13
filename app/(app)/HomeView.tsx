'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Dashboard from '@/components/screens/Dashboard';
import { currentMonth, homeHref } from '@/lib/utils/routeParams';

// The month comes from the URL; an absent one resolves to the browser's current month
// (not the server's). Changing it replaces the URL rather than pushing, so the back
// button leaves Início instead of stepping through every month visited.
export default function HomeView({ month }: { month: string | null }) {
  const router = useRouter();
  const [fallback] = useState(currentMonth);
  return <Dashboard month={month ?? fallback} onMonthChange={m => router.replace(homeHref(m), { scroll: false })} />;
}
