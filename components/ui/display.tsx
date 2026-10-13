import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight, CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { ICON_STROKE } from '@/components/shell/nav';
import { formatBRL } from '@/lib/utils/money';
import { FOCUS_RING } from './Button';

// Read-only building blocks from the design system: Card, SummaryCard, Chip, ProgressBar,
// Notice, EmptyState. Each mirrors the component of the same name there.

export function Card({ title, action, flush = false, className = '', children }: { title?: ReactNode; action?: ReactNode; flush?: boolean; className?: string; children?: ReactNode }) {
  return (
    <section className={`rounded-card border border-border bg-surface-1 ${flush ? 'overflow-hidden' : 'p-4 sm:p-5'} ${className}`}>
      {(title || action) && (
        <header className={`flex items-center justify-between gap-3 ${flush ? 'px-4 pt-3 pb-1 sm:px-5' : 'mb-3'}`}>
          {title && <h2 className="text-[17px] font-semibold leading-6">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function SummaryCard({ label, amount, size = 'lg', sign = false, note }: { label: string; amount: number; size?: 'xl' | 'lg'; sign?: boolean; note?: ReactNode }) {
  const tone = sign && amount > 0 ? 'text-positive' : sign && amount < 0 ? 'text-negative' : '';
  const figure = size === 'xl'
    ? 'text-[32px] leading-[38px] tracking-[-0.02em]'
    : 'text-[22px] leading-7 tracking-[-0.01em]';
  return (
    <div className="rounded-card border border-border bg-surface-1 p-4 sm:p-5">
      <p className="text-[13px] font-medium leading-[18px] text-ink-muted">{label}</p>
      <p className={`mt-1 font-semibold tabular-nums ${figure} ${tone}`}>{formatBRL(amount, { sign })}</p>
      {note && <p className="mt-1 text-xs text-ink-muted">{note}</p>}
    </div>
  );
}

export function Chip({ tone = 'neutral', icon: Icon, children }: { tone?: 'neutral' | 'accent' | 'warning'; icon?: LucideIcon; children: ReactNode }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-muted',
    accent: 'bg-accent-soft text-ink',
    warning: 'bg-warning-soft text-warning',
  };
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-chip px-2 py-px text-xs font-medium leading-[18px] ${tones[tone]}`}>
      {Icon && <Icon size={14} strokeWidth={ICON_STROKE} aria-hidden="true" className="shrink-0" />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A proportion, not a reading: the figure beside it carries the meaning. */
export function ProgressBar({ value, max = 100, tone = 'accent', label }: { value: number; max?: number; tone?: 'accent' | 'muted'; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`h-full rounded-full ${tone === 'accent' ? 'bg-accent' : 'bg-border-strong'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const NOTICE = {
  info: { icon: Info, box: 'bg-surface-2', ink: 'text-ink-muted', title: '' },
  success: { icon: CircleCheck, box: 'bg-accent-soft', ink: 'text-accent', title: '' },
  warning: { icon: TriangleAlert, box: 'bg-warning-soft', ink: 'text-warning', title: 'text-warning' },
  error: { icon: CircleAlert, box: 'bg-negative-soft', ink: 'text-negative', title: 'text-negative' },
} as const;

/** Every tone carries its icon — never colour alone. With `href` the whole notice is a link. */
export function Notice({ tone = 'info', title, children, action, href }: { tone?: keyof typeof NOTICE; title?: ReactNode; children?: ReactNode; action?: ReactNode; href?: string }) {
  const t = NOTICE[tone];
  const Icon = t.icon;
  const body = (
    <>
      <Icon size={20} strokeWidth={ICON_STROKE} aria-hidden="true" className={`shrink-0 ${href ? '' : 'mt-px'} ${t.ink}`} />
      <div className="min-w-0 flex-1">
        {title && <p className={`font-medium ${t.title}`}>{title}</p>}
        {children && <p className="text-[13px] leading-[18px]">{children}</p>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
      {href && <ChevronRight size={20} strokeWidth={ICON_STROKE} aria-hidden="true" className="shrink-0 text-ink-muted" />}
    </>
  );
  const cls = `flex gap-3 rounded-control px-4 py-3 text-ink ${t.box}`;
  if (href) return <Link href={href} className={`${cls} items-center ${FOCUS_RING}`}>{body}</Link>;
  return <div className={`${cls} items-start`} role={tone === 'error' ? 'alert' : 'status'}>{body}</div>;
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
        <Icon size={24} strokeWidth={ICON_STROKE} aria-hidden="true" />
      </span>
      <p className="text-[17px] font-semibold leading-6">{title}</p>
      {children && <p className="mb-2 max-w-[32ch] text-ink-muted">{children}</p>}
      {action}
    </div>
  );
}
