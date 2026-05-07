"use client";

import { useEffect, useRef, useCallback, useState } from "react";

interface Options {
  interval?: number;
  refetchOnFocus?: boolean;
  enabled?: boolean;
}

export function useAutoRefresh(fetchFn: () => Promise<void>, options: Options = {}) {
  const { interval = 30000, refetchOnFocus = true, enabled = true } = options;
  const fetchRef = useRef(fetchFn);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  fetchRef.current = fetchFn;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchRef.current();
      setLastUpdated(new Date());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !interval) return;
    const id = setInterval(() => {
      fetchRef.current().then(() => setLastUpdated(new Date())).catch(() => {});
    }, interval);
    return () => clearInterval(id);
  }, [interval, enabled]);

  useEffect(() => {
    if (!enabled || !refetchOnFocus) return;
    const handler = () => {
      if (document.visibilityState === "visible") {
        fetchRef.current().then(() => setLastUpdated(new Date())).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [enabled, refetchOnFocus]);

  return { refresh, refreshing, lastUpdated };
}
