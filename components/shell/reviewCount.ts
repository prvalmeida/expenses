'use client';

import { createContext, useContext } from 'react';

// The shell already polls the pending-review count for its badge; screens read the same
// number from here instead of issuing a second request.
export const ReviewCountContext = createContext(0);

export function useReviewCount(): number {
  return useContext(ReviewCountContext);
}
