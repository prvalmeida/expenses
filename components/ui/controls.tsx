'use client';

import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { ICON_STROKE } from '@/components/shell/nav';
import { monthLabel, shiftMonth } from '@/lib/utils/monthUtils';
import { Button, FOCUS_RING } from './Button';
import Sheet from '@/components/shell/Sheet';

// Interactive building blocks from the design system: SegmentedControl, MonthSwitcher,
// Select, ConfirmSheet.

export function SegmentedControl<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-control bg-surface-2 p-[3px]">
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`min-h-9 flex-1 rounded-chip px-3 text-[13px] font-medium leading-[18px] whitespace-nowrap ${FOCUS_RING} ${active ? 'bg-surface-1 text-ink ring-1 ring-border' : 'text-ink-muted hover:text-ink'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" iconOnly icon={ChevronLeft} aria-label="Mês anterior" onClick={() => onChange(shiftMonth(month, -1))} />
      <h1 className="min-w-[9.5em] text-center text-[22px] font-semibold leading-7 tracking-[-0.01em]" aria-live="polite">
        {monthLabel(month)}
      </h1>
      <Button variant="ghost" iconOnly icon={ChevronRight} aria-label="Próximo mês" onClick={() => onChange(shiftMonth(month, 1))} />
    </div>
  );
}

export function Select({ label, options, placeholder, className = '', ...rest }: { label: string; options: { value: string; label: string }[]; placeholder?: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-[13px] font-medium leading-[18px]">{label}</label>
      <div className="relative flex min-h-11 items-center rounded-control border border-border-strong bg-surface-1 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus">
        <select id={id} className="h-full min-h-[42px] w-full min-w-0 cursor-pointer appearance-none bg-transparent pl-3 pr-10 text-base text-ink outline-none" {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={18} strokeWidth={ICON_STROKE} aria-hidden="true" className="pointer-events-none absolute right-3 text-ink-muted" />
      </div>
    </div>
  );
}

type ConfirmProps = {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  busy: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * Replaces `window.confirm()` for destructive actions. Dismissal (Escape, scrim, Cancelar)
 * is ignored while `busy`, the same guard the edit modal uses: closing mid-request would
 * strand the result, or its error, behind a dialog that no longer exists.
 */
export function ConfirmSheet({ open, title, children, confirmLabel, busy, error, onConfirm, onClose }: ConfirmProps) {
  const close = () => { if (!busy) onClose(); };
  return (
    <Sheet
      open={open}
      title={title}
      onClose={close}
      footer={
        <>
          <Button className="flex-1 sm:flex-none" onClick={close} disabled={busy}>Cancelar</Button>
          <Button className="flex-1 sm:ml-auto sm:flex-none" variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Excluindo…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {children}
        {error && <p className="text-[13px] text-negative" role="alert">{error}</p>}
      </div>
    </Sheet>
  );
}
