'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export interface CategoryDoc {
  _id?: string;
  kind: 'expense' | 'income';
  name: string;
  subtypes: string[];
  order?: number;
}

let cache: CategoryDoc[] | null = null;
let inflight: Promise<CategoryDoc[]> | null = null;
const listeners = new Set<(data: CategoryDoc[]) => void>();

async function loadCategories(force = false): Promise<CategoryDoc[]> {
  if (cache && !force) return cache;
  if (inflight && !force) return inflight;
  inflight = fetch('/api/categories')
    .then(res => (res.ok ? res.json() : []))
    .then((data: CategoryDoc[]) => {
      cache = data;
      inflight = null;
      listeners.forEach(fn => fn(data));
      return data;
    })
    .catch(() => {
      inflight = null;
      return cache ?? [];
    });
  return inflight;
}

export function useCategories() {
  const [categories, setCategories] = useState<CategoryDoc[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    const listener = (data: CategoryDoc[]) => setCategories(data);
    listeners.add(listener);
    loadCategories().then(() => setLoading(false));
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);
    await loadCategories(true);
    setLoading(false);
  }, []);

  const expense = useMemo(() => categories.filter(c => c.kind === 'expense'), [categories]);
  const expenseTypes = useMemo(() => expense.map(c => c.name), [expense]);
  const incomeTypes = useMemo(
    () => categories.filter(c => c.kind === 'income').map(c => c.name),
    [categories]
  );

  const subtypesFor = useCallback(
    (type: string): string[] => expense.find(c => c.name === type)?.subtypes ?? [],
    [expense]
  );

  const isValidType = useCallback((type: string): boolean => expenseTypes.includes(type), [expenseTypes]);

  const isValidPair = useCallback(
    (type: string, subtype?: string | null): boolean => {
      const cat = expense.find(c => c.name === type);
      if (!cat) return false;
      if (!subtype) return true;
      return cat.subtypes.includes(subtype);
    },
    [expense]
  );

  return { categories, expenseTypes, incomeTypes, subtypesFor, isValidType, isValidPair, loading, refetch };
}
