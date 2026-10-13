'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ChevronRight, Plus, Receipt, TriangleAlert } from 'lucide-react';
import { useCategories } from '@/hooks/useCategories';
import { useTransactions } from '@/hooks/useTransactions';
import { useReviewCount } from '@/components/shell/reviewCount';
import { ICON_STROKE } from '@/components/shell/nav';
import { ButtonLink, FOCUS_RING } from '@/components/ui/Button';
import { Card, Chip, EmptyState, Notice, ProgressBar, SummaryCard } from '@/components/ui/display';
import { MonthSwitcher } from '@/components/ui/controls';
import { formatBRL, isVoucher } from '@/lib/utils/money';
import { isInMonth, monthName } from '@/lib/utils/monthUtils';
import { transactionsHref } from '@/lib/utils/routeParams';

type Props = {
  month: string;
  onMonthChange: (month: string) => void;
};

// Início: one simple view of the month by purchase date. The cash-flow view, the
// month comparison and every individual record live in Lançamentos.
export default function Dashboard({ month, onMonthChange }: Props) {
  const { isValidType } = useCategories();
  const { expenses, incomes, status } = useTransactions();
  const reviewCount = useReviewCount();

  const monthExpenses = useMemo(() => expenses.filter(e => isInMonth(e.date, month)), [expenses, month]);

  // The headline total leaves vouchers out (not the household's money); the category
  // breakdown keeps them, so it still shows where food and fuel went.
  const { total, voucherTotal } = useMemo(() => {
    let t = 0;
    let v = 0;
    for (const e of monthExpenses) {
      if (isVoucher(e.paymentType)) v += e.value;
      else t += e.value;
    }
    return { total: t, voucherTotal: v };
  }, [monthExpenses]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of monthExpenses) map.set(e.type, (map.get(e.type) ?? 0) + e.value);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [monthExpenses]);

  const incomeTotal = useMemo(
    () => incomes.filter(i => isInMonth(i.date, month)).reduce((sum, i) => sum + i.value, 0),
    [incomes, month]
  );

  const largest = byCategory[0]?.[1] ?? 0;
  const count = monthExpenses.length;
  const note = [
    `${count} ${count === 1 ? 'lançamento' : 'lançamentos'}`,
    voucherTotal > 0 ? `${formatBRL(voucherTotal)} em vales fora do total` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-4">
      <div className="flex justify-center sm:justify-start">
        <MonthSwitcher month={month} onChange={onMonthChange} />
      </div>

      {reviewCount > 0 && (
        <Notice
          tone="warning"
          href="/review"
          title={`${reviewCount > 99 ? '99+' : reviewCount} ${reviewCount === 1 ? 'transação do banco' : 'transações do banco'} a revisar`}
        />
      )}

      {status === 'error' && (
        <Notice tone="error" title="Não foi possível carregar os lançamentos">
          Verifique a conexão e recarregue a página.
        </Notice>
      )}

      {status === 'loading' && (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Carregando">
          <div className="h-[118px] animate-pulse rounded-card bg-surface-2" />
          <div className="h-[118px] animate-pulse rounded-card bg-surface-2" />
          <div className="h-48 animate-pulse rounded-card bg-surface-2 sm:col-span-2" />
        </div>
      )}

      {status === 'ready' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryCard label={`Gastos em ${monthName(month)}`} amount={total} size="xl" note={note} />
            <SummaryCard label="Receitas" amount={incomeTotal} sign />
          </div>

          <Card
            flush
            title="Por categoria"
            action={byCategory.length > 0 && (
              <ButtonLink variant="ghost" size="sm" href={transactionsHref(month, 'purchase')}>Ver lançamentos</ButtonLink>
            )}
          >
            {byCategory.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title={`Nenhum gasto em ${monthName(month)}`}
                action={<ButtonLink variant="secondary" icon={Plus} href="/new/expense">Novo gasto</ButtonLink>}
              >
                Lance um gasto ou importe uma fatura.
              </EmptyState>
            ) : (
              <ul className="pb-2">
                {byCategory.map(([type, value]) => (
                  <li key={type}>
                    <Link
                      href={transactionsHref(month, 'purchase', type)}
                      className={`flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2 sm:px-5 ${FOCUS_RING} focus-visible:-outline-offset-2`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="mb-1.5 flex items-baseline justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate">{type}</span>
                            {!isValidType(type) && <Chip tone="warning" icon={TriangleAlert}>Categoria removida</Chip>}
                          </span>
                          <span className="shrink-0 font-medium tabular-nums">{formatBRL(value)}</span>
                        </div>
                        <ProgressBar value={value} max={largest} label={type} />
                      </div>
                      <ChevronRight size={18} strokeWidth={ICON_STROKE} aria-hidden="true" className="shrink-0 text-ink-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
