'use client';

import { useRouter } from 'next/navigation';
import ImportBill from '@/components/screens/ImportBill';

export default function Page() {
  const router = useRouter();
  return <ImportBill onDone={() => router.push('/transactions')} />;
}
