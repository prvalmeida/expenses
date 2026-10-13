'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { ICON_STROKE, NAV_ITEMS, formatBadge, type NavId } from './nav';

type Props = {
  active: NavId | null;
  reviewCount: number;
  onAdd: () => void;
  addOpen: boolean;
};

// Phones only (below md). Two tabs, the + button, two tabs — the add action sits where the
// thumb rests.
export default function TabBar({ active, reviewCount, onAdd, addOpen }: Props) {
  const half = Math.ceil(NAV_ITEMS.length / 2);
  const tab = ({ id, label, href, icon: Icon }: (typeof NAV_ITEMS)[number]) => {
    const isActive = id === active;
    return (
      <Link
        key={id}
        href={href}
        aria-current={isActive ? 'page' : undefined}
        className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-control text-[11px] font-medium leading-[14px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${isActive ? 'text-accent' : 'text-ink-muted'}`}
      >
        <span className="relative flex">
          <Icon size={24} strokeWidth={ICON_STROKE} aria-hidden="true" />
          {id === 'review' && reviewCount > 0 && (
            <span className="absolute -top-1 left-3.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning px-[5px] text-[11px] font-semibold leading-none text-surface-1 tabular-nums">
              {formatBadge(reviewCount)}
            </span>
          )}
        </span>
        <span>{label}</span>
        {id === 'review' && reviewCount > 0 && <span className="sr-only">, {reviewCount} pendentes</span>}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border bg-surface-1 px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {NAV_ITEMS.slice(0, half).map(tab)}
      <span className="flex flex-1 justify-center">
        <button
          type="button"
          onClick={onAdd}
          aria-label="Adicionar"
          aria-haspopup="dialog"
          aria-expanded={addOpen}
          className="-mt-[18px] flex h-14 w-14 items-center justify-center rounded-full border-4 border-surface-0 bg-accent text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Plus size={26} strokeWidth={2} aria-hidden="true" />
        </button>
      </span>
      {NAV_ITEMS.slice(half).map(tab)}
    </nav>
  );
}
