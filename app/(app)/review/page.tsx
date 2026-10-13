'use client';

import { useRouter } from 'next/navigation';
import PluggySync from '@/components/screens/PluggySync';

export default function Page() {
  const router = useRouter();
  return <PluggySync onDone={() => router.push('/')} />;
}
