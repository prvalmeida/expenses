'use client';

import { useRouter } from 'next/navigation';
import AddExpense from '@/components/screens/AddExpense';

export default function Page() {
  const router = useRouter();
  return <AddExpense onExpenseAdded={() => router.push('/transactions')} />;
}
