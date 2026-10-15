'use client';

import { useRouter } from 'next/navigation';
import ImportReceipt from '@/components/screens/ImportReceipt';

export default function Page() {
  const router = useRouter();
  return <ImportReceipt onImported={() => router.push('/transactions')} />;
}
