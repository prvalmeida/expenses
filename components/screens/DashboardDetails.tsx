'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ArrowDownLeft, Pencil, Plus, Receipt, Trash2, TriangleAlert } from 'lucide-react';
import type { Expense, Income } from '@/types';
import EditExpenseModal from '@/components/EditExpenseModal';
import { useCategories } from '@/hooks/useCategories';
import { useTransactions } from '@/hooks/useTransactions';
import { ICON_STROKE } from '@/components/shell/nav';
import { Button, ButtonLink, FOCUS_RING } from '@/components/ui/Button';
import { Card, Chip, EmptyState, Notice, ProgressBar, SummaryCard } from '@/components/ui/display';
import { ConfirmSheet, MonthSwitcher, SegmentedControl, Select } from '@/components/ui/controls';
import { formatBRL, isVoucher, paymentLabel } from '@/lib/utils/money';
import { dayHeading, isInMonth, monthLabel, monthName, shiftMonth, shortDate } from '@/lib/utils/monthUtils';
import type { ViewMode } from '@/lib/utils/routeParams';

export type TransactionsQuery = { month: string; mode: ViewMode; category: string | null };

type Props = TransactionsQuery & {
  onChange: (next: TransactionsQuery) => void;
};

type SortKey = 'date' | 'value' | 'name' | 'type';
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'date', label: 'Data (mais recentes)' },
  { value: 'value', label: 'Valor (maiores)' },
  { value: 'name', label: 'Nome (A–Z)' },
  { value: 'type', label: 'Categoria (A–Z)' },
];

type PendingDelete =
  | { kind: 'expense'; expense: Expense; group: boolean }
  | { kind: 'bulk'; ids: string[] }
  | { kind: 'income'; income: Income };

const COMPARE_OFFSETS = Array.from({ length: 12 }, (_, i) => i + 1);

// Lançamentos: every record of the month. Month, mode and category are controlled by the
// URL (`?month=&mode=&category=`), so they survive a refresh and a shared link; sorting,
// selection and the analysis tab are view state and stay local.
export default function DashboardDetails({ month, mode, category, onChange }: Props) {
  const { expenseTypes, isValidType, isValidPair } = useCategories();
  const { expenses, setExpenses, incomes, setIncomes, status } = useTransactions();

  const [sort, setSort] = useState<SortKey>('date');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ expense: Expense; originalDate?: string } | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<'detail' | 'compare'>('detail');
  const [focusType, setFocusType] = useState<string | null>(null);
  const [compareOffset, setCompareOffset] = useState(1);

  const set = (patch: Partial<TransactionsQuery>) => onChange({ month, mode, category, ...patch });

  const isOrphan = useCallback(
    (e: Expense) => !isValidType(e.type) || (!!e.subtype && !isValidPair(e.type, e.subtype)),
    [isValidType, isValidPair]
  );
  const dateOf = useCallback((e: Expense) => (mode === 'payment' ? e.effectiveDate : e.date), [mode]);

  const monthExpenses = useMemo(() => expenses.filter(e => isInMonth(dateOf(e), month)), [expenses, dateOf, month]);
  const monthIncomes = useMemo(
    () => incomes.filter(i => isInMonth(i.date, month)).sort((a, b) => b.date.localeCompare(a.date)),
    [incomes, month]
  );

  const spent = useMemo(() => monthExpenses.filter(e => !isVoucher(e.paymentType)).reduce((s, e) => s + e.value, 0), [monthExpenses]);
  const received = useMemo(() => monthIncomes.reduce((s, i) => s + i.value, 0), [monthIncomes]);

  // --- Analysis ---
  const totalsByType = useCallback((ym: string) => {
    const map = new Map<string, number>();
    for (const e of expenses) if (isInMonth(dateOf(e), ym)) map.set(e.type, (map.get(e.type) ?? 0) + e.value);
    return map;
  }, [expenses, dateOf]);

  const totalsBySubtype = useCallback((ym: string, type: string) => {
    const map = new Map<string, number>();
    for (const e of expenses) {
      if (e.type !== type || !isInMonth(dateOf(e), ym)) continue;
      const key = e.subtype || 'Geral';
      map.set(key, (map.get(key) ?? 0) + e.value);
    }
    return map;
  }, [expenses, dateOf]);

  const typesNow = useMemo(() => [...totalsByType(month).entries()].sort((a, b) => b[1] - a[1]), [totalsByType, month]);
  const detailType = focusType && typesNow.some(([t]) => t === focusType) ? focusType : category ?? typesNow[0]?.[0] ?? null;
  const otherMonth = shiftMonth(month, -compareOffset);

  // --- List ---
  const visible = useMemo(() => {
    const rows = category ? monthExpenses.filter(e => e.type === category) : monthExpenses;
    const sorted = [...rows];
    if (sort === 'date') sorted.sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || a.name.localeCompare(b.name));
    if (sort === 'value') sorted.sort((a, b) => b.value - a.value);
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'type') sorted.sort((a, b) => a.type.localeCompare(b.type) || dateOf(b).localeCompare(dateOf(a)));
    return sorted;
  }, [monthExpenses, category, sort, dateOf]);

  // Selection is pruned to what is on screen instead of being reset in an effect: a
  // month/mode/filter change hides rows, and hidden rows must never be bulk-deleted.
  const selected = useMemo(() => visible.filter(e => e._id && selectedIds.has(e._id)).map(e => e._id!), [visible, selectedIds]);
  const allSelected = visible.length > 0 && selected.length === visible.length;
  const selectAllRef = useCallback((el: HTMLInputElement | null) => {
    if (el) el.indeterminate = selected.length > 0 && !allSelected;
  }, [selected.length, allSelected]);

  const toggle = (id: string, on: boolean) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const categoryOptions = useMemo(() => {
    const names = new Set(expenseTypes);
    if (category) names.add(category);
    return [...names].sort((a, b) => a.localeCompare(b)).map(n => ({ value: n, label: n }));
  }, [expenseTypes, category]);

  // --- Editing ---
  const startEdit = (expense: Expense) => {
    let originalDate: string | undefined;
    if (expense.paymentType === 'credit' && expense.totalInstallments > 1 && expense.transactionId) {
      originalDate = expenses
        .filter(e => e.transactionId === expense.transactionId)
        .sort((a, b) => (a.paymentType === 'credit' ? a.installment : 0) - (b.paymentType === 'credit' ? b.installment : 0))[0]?.date;
    }
    setEditing({ expense, originalDate });
  };

  const handleSaved = (updated: Expense | Expense[]) => {
    setExpenses(prev => {
      if (Array.isArray(updated)) {
        const tid = updated[0]?.transactionId;
        return tid ? [...prev.filter(e => e.transactionId !== tid), ...updated] : [...prev, ...updated];
      }
      return prev.map(e => (e._id === updated._id ? updated : e));
    });
    setEditing(null);
  };

  // --- Deleting ---
  const askDelete = (p: PendingDelete) => {
    setDeleteError(null);
    setPending(p);
  };

  const confirmDelete = async () => {
    if (!pending) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      if (pending.kind === 'expense') {
        const { expense, group } = pending;
        const res = await fetch(`/api/expenses/${expense._id}${group ? '?all=true' : ''}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(String(res.status));
        setExpenses(prev => prev.filter(e => (group && expense.transactionId ? e.transactionId !== expense.transactionId : e._id !== expense._id)));
      } else if (pending.kind === 'bulk') {
        const res = await fetch('/api/expenses/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: pending.ids }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const gone = new Set(pending.ids);
        setExpenses(prev => prev.filter(e => !gone.has(e._id!)));
        setSelectedIds(new Set());
      } else {
        const res = await fetch(`/api/income/${pending.income._id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(String(res.status));
        const id = pending.income._id;
        setIncomes(prev => prev.filter(i => i._id !== id));
      }
      setPending(null);
    } catch {
      setDeleteError('Não foi possível excluir. Tente de novo.');
    } finally {
      setDeleting(false);
    }
  };

  const groups = useMemo(() => {
    if (sort !== 'date') return [{ key: 'all', heading: null as string | null, rows: visible }];
    const out: { key: string; heading: string | null; rows: Expense[] }[] = [];
    for (const e of visible) {
      const day = dateOf(e).slice(0, 10);
      const last = out[out.length - 1];
      if (last?.key === day) last.rows.push(e);
      else out.push({ key: day, heading: dayHeading(day), rows: [e] });
    }
    return out;
  }, [visible, sort, dateOf]);

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-4">
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <MonthSwitcher month={month} onChange={m => set({ month: m })} />
        <div className="w-full sm:w-80">
          <SegmentedControl
            label="Data usada"
            value={mode}
            onChange={m => set({ mode: m })}
            options={[{ value: 'purchase', label: 'Por compra' }, { value: 'payment', label: 'Fluxo de caixa' }]}
          />
        </div>
      </div>

      {status === 'error' && (
        <Notice tone="error" title="Não foi possível carregar os lançamentos">Verifique a conexão e recarregue a página.</Notice>
      )}

      {status === 'loading' && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando">
          <div className="h-[104px] animate-pulse rounded-card bg-surface-2" />
          <div className="h-72 animate-pulse rounded-card bg-surface-2" />
        </div>
      )}

      {status === 'ready' && (
        <>
          <div className={`grid gap-3 ${mode === 'payment' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            <SummaryCard label={mode === 'payment' ? 'A pagar' : 'Gastos'} amount={spent} note="Sem vales" />
            <SummaryCard label="Receitas" amount={received} sign />
            {mode === 'payment' && <SummaryCard label="Saldo" amount={received - spent} sign />}
          </div>

          <Card
            title="Análise"
            action={
              <div className="w-64">
                <SegmentedControl
                  label="Tipo de análise"
                  value={analysis}
                  onChange={setAnalysis}
                  options={[{ value: 'detail', label: 'Por categoria' }, { value: 'compare', label: 'Comparar meses' }]}
                />
              </div>
            }
          >
            {typesNow.length === 0 && analysis === 'detail' ? (
              <p className="text-ink-muted">Nenhum gasto em {monthName(month)}.</p>
            ) : analysis === 'detail' ? (
              <div className="grid gap-6 md:grid-cols-2">
                <BarList
                  title="Categorias"
                  rows={typesNow.map(([t, v]) => ({ key: t, label: t, value: v }))}
                  activeKey={detailType}
                  onSelect={setFocusType}
                />
                <BarList
                  title={detailType ? `Subcategorias de ${detailType}` : 'Subcategorias'}
                  rows={detailType ? [...totalsBySubtype(month, detailType).entries()].sort((a, b) => b[1] - a[1]).map(([s, v]) => ({ key: s, label: s, value: v })) : []}
                />
              </div>
            ) : (
              <Comparison
                month={month}
                other={otherMonth}
                offsetSelect={
                  <Select
                    label="Comparar com"
                    value={String(compareOffset)}
                    onChange={e => setCompareOffset(Number(e.target.value))}
                    options={COMPARE_OFFSETS.map(o => ({ value: String(o), label: monthLabel(shiftMonth(month, -o)) }))}
                  />
                }
                a={totalsByType(month)}
                b={totalsByType(otherMonth)}
                selected={focusType}
                onSelect={setFocusType}
                subA={focusType ? totalsBySubtype(month, focusType) : null}
                subB={focusType ? totalsBySubtype(otherMonth, focusType) : null}
              />
            )}
          </Card>

          <Card flush title="Gastos">
            <div className="flex flex-col gap-3 px-4 pb-3 pt-2 sm:flex-row sm:items-end sm:px-5">
              <Select
                className="sm:w-56"
                label="Categoria"
                placeholder="Todas"
                value={category ?? ''}
                onChange={e => set({ category: e.target.value || null })}
                options={categoryOptions}
              />
              <Select className="sm:w-56" label="Ordenar por" value={sort} onChange={e => setSort(e.target.value as SortKey)} options={SORTS} />
            </div>

            {visible.length > 0 && (
              <div className="flex min-h-12 items-center gap-3 border-y border-border bg-surface-2 px-4 sm:px-5">
                <input
                  type="checkbox"
                  ref={selectAllRef}
                  checked={allSelected}
                  onChange={e => setSelectedIds(e.target.checked ? new Set(visible.map(v => v._id!)) : new Set())}
                  aria-label="Selecionar todos"
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className="flex-1 text-[13px] text-ink-muted">
                  {selected.length > 0 ? `${selected.length} selecionado${selected.length === 1 ? '' : 's'}` : `${visible.length} lançamento${visible.length === 1 ? '' : 's'}`}
                </span>
                {selected.length > 0 && (
                  <Button size="sm" variant="danger" icon={Trash2} onClick={() => askDelete({ kind: 'bulk', ids: selected })}>
                    Excluir
                  </Button>
                )}
              </div>
            )}

            {visible.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title={category ? `Nenhum gasto em ${category}` : `Nenhum gasto em ${monthName(month)}`}
                action={<ButtonLink variant="secondary" icon={Plus} href="/new/expense">Novo gasto</ButtonLink>}
              >
                {mode === 'payment' ? 'No fluxo de caixa, compras no cartão contam no mês do vencimento.' : 'Lance um gasto ou importe uma fatura.'}
              </EmptyState>
            ) : (
              groups.map(g => (
                <div key={g.key}>
                  {g.heading && <h3 className="px-4 pb-1 pt-3 text-[13px] font-medium text-ink-muted sm:px-5">{g.heading}</h3>}
                  <ul>
                    {g.rows.map(e => (
                      <ExpenseRow
                        key={e._id}
                        expense={e}
                        date={sort === 'date' ? null : shortDate(dateOf(e))}
                        orphan={isOrphan(e)}
                        checked={selectedIds.has(e._id!)}
                        onCheck={on => toggle(e._id!, on)}
                        onEdit={() => startEdit(e)}
                        onDelete={() => askDelete({ kind: 'expense', expense: e, group: (e.totalInstallments ?? 0) > 1 })}
                      />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </Card>

          <Card flush title="Receitas">
            {monthIncomes.length === 0 ? (
              <p className="px-4 pb-4 text-ink-muted sm:px-5">Nenhuma receita em {monthName(month)}.</p>
            ) : (
              <ul className="pb-1">
                {monthIncomes.map(i => (
                  <li key={i._id} className="flex min-h-14 items-center gap-3 border-t border-border px-4 py-2 first:border-t-0 sm:px-5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
                      <ArrowDownLeft size={20} strokeWidth={ICON_STROKE} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{i.name}</p>
                      <p className="truncate text-xs text-ink-muted">{shortDate(i.date)} · {i.type}</p>
                    </div>
                    <span className="shrink-0 font-medium text-positive tabular-nums">{formatBRL(i.value, { sign: true })}</span>
                    <Button variant="ghost" iconOnly icon={Trash2} aria-label={`Excluir receita ${i.name}`} onClick={() => askDelete({ kind: 'income', income: i })} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <ConfirmSheet
        open={pending !== null}
        busy={deleting}
        error={deleteError}
        onClose={() => setPending(null)}
        onConfirm={confirmDelete}
        {...confirmCopy(pending)}
      />

      {editing && (
        <EditExpenseModal
          expense={editing.expense}
          originalDate={editing.originalDate}
          onSave={handleSaved}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function confirmCopy(p: PendingDelete | null): { title: string; confirmLabel: string; children?: ReactNode } {
  if (!p) return { title: '', confirmLabel: '' };
  if (p.kind === 'bulk') {
    const n = p.ids.length;
    return {
      title: `Excluir ${n} ${n === 1 ? 'gasto' : 'gastos'}?`,
      confirmLabel: `Excluir ${n}`,
      children: <p className="text-ink-muted">Só os lançamentos selecionados são excluídos; outras parcelas do mesmo grupo continuam.</p>,
    };
  }
  if (p.kind === 'income') {
    return {
      title: 'Excluir receita?',
      confirmLabel: 'Excluir receita',
      children: <p>{p.income.name} · {formatBRL(p.income.value)}</p>,
    };
  }
  const e = p.expense;
  if (p.group && e.paymentType === 'credit') {
    return {
      title: 'Excluir gasto parcelado?',
      confirmLabel: `Excluir ${e.totalInstallments} parcelas`,
      children: (
        <>
          <p>{e.name} · {formatBRL(e.value)} em {e.totalInstallments} parcelas</p>
          <p className="text-ink-muted">Todas as parcelas do grupo serão excluídas.</p>
        </>
      ),
    };
  }
  return { title: 'Excluir gasto?', confirmLabel: 'Excluir gasto', children: <p>{e.name} · {formatBRL(e.value)}</p> };
}

function ExpenseRow({ expense: e, date, orphan, checked, onCheck, onEdit, onDelete }: {
  expense: Expense;
  date: string | null;
  orphan: boolean;
  checked: boolean;
  onCheck: (on: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const meta = [
    date,
    paymentLabel(e.paymentType),
    e.paymentType === 'credit' ? `${e.cardBrand}${e.totalInstallments > 1 ? ` · ${e.installment}/${e.totalInstallments}` : ''}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <li className="flex items-center gap-1 border-t border-border pl-4 pr-1 first:border-t-0 sm:pl-5 sm:pr-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={ev => onCheck(ev.target.checked)}
        aria-label={`Selecionar ${e.name}`}
        className="h-4 w-4 shrink-0 accent-[var(--accent)]"
      />
      <button
        type="button"
        onClick={onEdit}
        className={`flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-surface-2 ${FOCUS_RING}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{e.name}</span>
          {/* Wraps instead of truncating: on a phone the chip and the payment line
              cannot share one row without cutting the card name off. */}
          <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
            <Chip tone={orphan ? 'warning' : 'neutral'} icon={orphan ? TriangleAlert : undefined}>
              {e.subtype ? `${e.type} · ${e.subtype}` : e.type}
            </Chip>
            <span>{meta}</span>
          </span>
        </span>
        <span className="shrink-0 font-medium tabular-nums">{formatBRL(e.value)}</span>
        <Pencil size={16} strokeWidth={ICON_STROKE} aria-hidden="true" className="hidden shrink-0 text-ink-muted sm:block" />
        <span className="sr-only">Editar</span>
      </button>
      <Button variant="ghost" iconOnly icon={Trash2} aria-label={`Excluir ${e.name}`} onClick={onDelete} />
    </li>
  );
}

function BarList({ title, rows, activeKey, onSelect }: {
  title: string;
  rows: { key: string; label: string; value: number }[];
  activeKey?: string | null;
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(0, ...rows.map(r => r.value));
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-medium text-ink-muted">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-ink-muted">Selecione uma categoria.</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {rows.map(r => {
            const inner = (
              <>
                <span className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="truncate">{r.label}</span>
                  <span className="shrink-0 font-medium tabular-nums">{formatBRL(r.value)}</span>
                </span>
                <ProgressBar value={r.value} max={max} label={r.label} />
              </>
            );
            const base = 'block w-full rounded-control px-2 py-2 text-left';
            return (
              <li key={r.key}>
                {onSelect ? (
                  <button
                    type="button"
                    aria-pressed={r.key === activeKey}
                    onClick={() => onSelect(r.key)}
                    className={`${base} ${FOCUS_RING} ${r.key === activeKey ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
                  >
                    {inner}
                  </button>
                ) : (
                  <div className={base}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Two series per row, told apart by lightness (accent vs border-strong) and by the
// legend's labels — never by hue alone.
function Comparison({ month, other, offsetSelect, a, b, selected, onSelect, subA, subB }: {
  month: string;
  other: string;
  offsetSelect: ReactNode;
  a: Map<string, number>;
  b: Map<string, number>;
  selected: string | null;
  onSelect: (type: string) => void;
  subA: Map<string, number> | null;
  subB: Map<string, number> | null;
}) {
  const rows = (x: Map<string, number>, y: Map<string, number>) => {
    const keys = [...new Set([...x.keys(), ...y.keys()])];
    return keys
      .map(k => ({ key: k, a: x.get(k) ?? 0, b: y.get(k) ?? 0 }))
      .sort((p, q) => Math.max(q.a, q.b) - Math.max(p.a, p.b));
  };
  const main = rows(a, b);
  const subs = subA && subB ? rows(subA, subB) : [];

  const block = (list: typeof main, select?: (k: string) => void) => {
    const max = Math.max(0, ...list.flatMap(r => [r.a, r.b]));
    return (
      <ul className="-mx-2 flex flex-col">
        {list.map(r => {
          const delta = r.a - r.b;
          const body = (
            <>
              <span className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="truncate">{r.key}</span>
                <span className="shrink-0 text-[13px] tabular-nums">
                  <span className="font-medium">{formatBRL(r.a)}</span>
                  <span className="text-ink-muted"> · {formatBRL(r.b)}</span>
                  {delta !== 0 && <span className={`ml-2 ${delta > 0 ? 'text-negative' : 'text-positive'}`}>{delta > 0 ? '+' : '−'}{formatBRL(Math.abs(delta))}</span>}
                </span>
              </span>
              <span className="flex flex-col gap-1">
                <ProgressBar value={r.a} max={max} label={`${r.key}, ${monthLabel(month)}`} />
                <ProgressBar value={r.b} max={max} tone="muted" label={`${r.key}, ${monthLabel(other)}`} />
              </span>
            </>
          );
          const base = 'block w-full rounded-control px-2 py-2 text-left';
          return (
            <li key={r.key}>
              {select ? (
                <button type="button" aria-pressed={r.key === selected} onClick={() => select(r.key)} className={`${base} ${FOCUS_RING} ${r.key === selected ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}>
                  {body}
                </button>
              ) : (
                <div className={base}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="sm:w-56">{offsetSelect}</div>
        <div className="flex gap-4 text-[13px] text-ink-muted">
          <span className="flex items-center gap-2"><span className="h-1 w-4 rounded-full bg-accent" />{monthLabel(month)}</span>
          <span className="flex items-center gap-2"><span className="h-1 w-4 rounded-full bg-border-strong" />{monthLabel(other)}</span>
        </div>
      </div>
      {main.length === 0 ? <p className="text-ink-muted">Nenhum gasto nos dois meses.</p> : block(main, onSelect)}
      {selected && subs.length > 0 && (
        <div>
          <h3 className="mb-2 text-[13px] font-medium text-ink-muted">Subcategorias de {selected}</h3>
          {block(subs)}
        </div>
      )}
    </div>
  );
}
