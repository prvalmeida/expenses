'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export interface CategoryDoc {
  _id?: string;
  kind: 'expense' | 'income';
  name: string;
  subtypes: string[];
  order?: number;
}

const REVALIDATE_INTERVAL_MS = 5000;

let cache: CategoryDoc[] | null = null;
let inflight: Promise<CategoryDoc[]> | null = null;
let queuedRefresh: Promise<CategoryDoc[]> | null = null;
let latestRequestId = 0;
let lastRequestStartedAt = 0;
const listeners = new Set<(data: CategoryDoc[]) => void>();

function fetchCategories(): Promise<CategoryDoc[]> {
  const requestId = ++latestRequestId;
  lastRequestStartedAt = Date.now();
  const request: Promise<CategoryDoc[]> = fetch('/api/categories')
    .then(res => (res.ok ? res.json() : []))
    .then((data: CategoryDoc[]) => {
      // A request superseded by a newer one must never write the cache or
      // broadcast: responses can settle out of order.
      if (requestId !== latestRequestId) return cache ?? data;
      cache = data;
      listeners.forEach(fn => fn(data));
      return data;
    })
    .catch(() => cache ?? [])
    .finally(() => {
      if (inflight === request) inflight = null;
    });
  inflight = request;
  return request;
}

/** Resolves with the cache, loading it once if this is the first consumer. */
function ensureCategories(): Promise<CategoryDoc[]> {
  if (cache) return Promise.resolve(cache);
  return inflight ?? fetchCategories();
}

/**
 * Always issues a request started *after* this call, so a `refetch()` that
 * follows a mutation can never resolve with a response predating it. Calls made
 * in the same tick (one per mounted consumer) collapse into a single request.
 */
function refreshCategories(): Promise<CategoryDoc[]> {
  queuedRefresh ??= Promise.resolve().then(() => {
    queuedRefresh = null;
    return fetchCategories();
  });
  return queuedRefresh;
}

/** Best-effort freshness check for focus/visibility — reuses recent work. */
function revalidateCategories(): Promise<CategoryDoc[]> {
  if (queuedRefresh) return queuedRefresh;
  if (inflight) return inflight;
  if (cache && Date.now() - lastRequestStartedAt < REVALIDATE_INTERVAL_MS) {
    return Promise.resolve(cache);
  }
  return fetchCategories();
}

export function useCategories() {
  const [categories, setCategories] = useState<CategoryDoc[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    const listener = (data: CategoryDoc[]) => setCategories(data);
    listeners.add(listener);
    ensureCategories().then(() => setLoading(false));

    // Categories may be created in another tab/window while a long-lived screen
    // (e.g. bill review) holds unsaved state; revalidate instead of forcing a reload.
    const revalidate = () => {
      if (document.visibilityState === 'visible') revalidateCategories();
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);

    return () => {
      listeners.delete(listener);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);
    await refreshCategories();
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
