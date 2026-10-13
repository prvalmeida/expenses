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

// md and up. Ajustes is pinned to the bottom: it is visited rarely and should not sit
// between the everyday sections.
export default function Sidebar({ active, reviewCount, onAdd, addOpen }: Props) {
  const link = ({ id, label, href, icon: Icon }: (typeof NAV_ITEMS)[number]) => {
    const isActive = id === active;
    return (
      <Link
        key={id}
        href={href}
        aria-current={isActive ? 'page' : undefined}
        className={`flex min-h-10 items-center gap-3 rounded-control px-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${isActive ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
      >
        <Icon size={20} strokeWidth={ICON_STROKE} aria-hidden="true" className={isActive ? 'text-accent' : 'text-ink-muted'} />
        <span className="flex-1">{label}</span>
        {id === 'review' && reviewCount > 0 && (
          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning px-[5px] text-[11px] font-semibold leading-none text-surface-1 tabular-nums">
            {formatBadge(reviewCount)}
            <span className="sr-only"> pendentes</span>
          </span>
        )}
      </Link>
    );
  };

  const main = NAV_ITEMS.filter(i => i.id !== 'settings');
  const settings = NAV_ITEMS.filter(i => i.id === 'settings');

  return (
    <nav
      aria-label="Navegação principal"
      className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface-0 px-3 py-4 md:flex"
    >
      <p className="px-3 pb-3 pt-1 text-[17px] font-semibold leading-6">Expenses</p>
      <button
        type="button"
        onClick={onAdd}
        aria-haspopup="dialog"
        aria-expanded={addOpen}
        className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-control bg-accent px-4 font-medium text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <Plus size={20} strokeWidth={ICON_STROKE} aria-hidden="true" />
        Novo lançamento
      </button>
      <div className="flex flex-col gap-0.5">{main.map(link)}</div>
      <div className="mt-auto flex flex-col gap-0.5 pt-3">{settings.map(link)}</div>
    </nav>
  );
}
