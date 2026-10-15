'use client';

import { useRouter } from 'next/navigation';
import AddIncome from '@/components/screens/AddIncome';

export default function Page() {
  const router = useRouter();
  return <AddIncome onIncomeAdded={() => router.push('/transactions')} />;
}
