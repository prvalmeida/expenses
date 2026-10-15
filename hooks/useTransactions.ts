'use client';

import { useEffect, useState } from 'react';
import type { Expense, Income } from '@/types';

export type LoadStatus = 'loading' | 'ready' | 'error';

/**
 * Every expense and income, loaded once per mount. Month filtering is client-side, so
 * switching months (a URL change on the same route) never refetches. `status` separates
 * "still loading" from "empty" so a screen doesn't flash its empty state, and "failed"
 * from both so a 500 never reads as a month with no spending.
 */
export function useTransactions() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [e, i] = await Promise.all([fetch('/api/expenses'), fetch('/api/income')]);
        if (!e.ok || !i.ok) throw new Error(`expenses ${e.status}, income ${i.status}`);
        const [expenseData, incomeData]: [Expense[], Income[]] = await Promise.all([e.json(), i.json()]);
        if (cancelled) return;
        setExpenses(expenseData);
        setIncomes(incomeData);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { expenses, setExpenses, incomes, setIncomes, status };
}
