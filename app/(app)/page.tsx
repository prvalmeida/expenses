'use client';

import { useRouter } from 'next/navigation';
import Dashboard from '@/components/screens/Dashboard';
import { transactionsHref } from '@/lib/utils/routeParams';

export default function HomePage() {
  const router = useRouter();
  return <Dashboard onOpenDetails={(month, mode) => router.push(transactionsHref(month, mode))} />;
}
