'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardDetails from '@/components/screens/DashboardDetails';
import { currentMonth, type ViewMode } from '@/lib/utils/routeParams';

export default function TransactionsView({ month, mode }: { month: string | null; mode: ViewMode }) {
  const router = useRouter();
  const [initialMonth] = useState(() => month ?? currentMonth());
  return <DashboardDetails initialMonth={initialMonth} initialViewMode={mode} onBack={() => router.push('/')} />;
}
