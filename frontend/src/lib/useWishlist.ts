"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "fos_wishlist";

function read(): number[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}

/**
 * Hearted products, kept on this device only. There is no wishlist table or
 * API yet, so nothing is synced to the account.
 */
export function useWishlist() {
  const [ids, setIds] = useState<number[]>([]);
  useEffect(() => { setIds(read()); }, []);

  const toggle = useCallback((id: number) => {
    setIds((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: heart still toggles for this visit */ }
      return next;
    });
  }, []);

  return { has: (id: number) => ids.includes(id), toggle };
}
