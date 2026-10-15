'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import TabBar from './TabBar';
import AddSheet from './AddSheet';
import { activeNavId } from './nav';
import { usePendingReviewCount } from '@/hooks/usePendingReviewCount';

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = activeNavId(pathname);
  const reviewCount = usePendingReviewCount(pathname);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-surface-0 text-ink">
      <Sidebar active={active} reviewCount={reviewCount} onAdd={() => setAddOpen(true)} addOpen={addOpen} />

      {/* Bottom padding clears the fixed TabBar (56px + the + button's overhang) plus the
          safe area on phones; md and up have no TabBar, so it is restated there — an
          unconditional arbitrary pb-* would otherwise win at every breakpoint. */}
      <main className="min-w-0 flex-1 px-3 pt-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 md:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {children}
      </main>

      <TabBar active={active} reviewCount={reviewCount} onAdd={() => setAddOpen(true)} addOpen={addOpen} />
      <AddSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
