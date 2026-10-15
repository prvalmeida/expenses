'use client';

import { useEffect, useState } from 'react';

// The badge only distinguishes 0, 1–99 and "99+", so one page of 100 is enough; the list
// endpoint has no count and adding one is not worth a second query shape.
const BADGE_PAGE = 100;

/**
 * Pending Pluggy rows awaiting review, for the Revisar badge. Refetches when `key` changes
 * (the shell passes the pathname, so leaving the review screen after importing updates it)
 * and when the tab regains focus, since the 6h cron stages rows while the app sits open.
 * A failed request keeps the last count rather than flashing 0.
 */
export function usePendingReviewCount(key: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/pluggy/transactions?status=pending&limit=${BADGE_PAGE}`);
        if (!res.ok) return;
        const data: { items?: unknown[] } = await res.json();
        if (!cancelled) setCount(data.items?.length ?? 0);
      } catch {
        // Offline or server down: keep the previous count.
      }
    };
    load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key]);

  return count;
}
