"use client";

import { useCallback, useEffect, useState } from "react";
import { listAddresses } from "@/lib/addresses";

export interface HomeLocation {
  lat: number;
  lng: number;
  /** Short area name for the chip, e.g. "Tuol Kouk". */
  area: string;
}

const KEY = "fos_home_location";

/** "120405, Tuol Kouk, Phnom Penh" → "Tuol Kouk" (skips postcodes and empty parts). */
export function areaName(address: string): string {
  const part = address.split(",").map((p) => p.trim()).find((p) => p && !/^\d+$/.test(p));
  return part || "Current location";
}

function readStored(): HomeLocation | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    return v && Number.isFinite(v.lat) && Number.isFinite(v.lng) ? v : null;
  } catch { return null; }
}

/**
 * Where the customer is shopping from. A location picked on the Home map wins;
 * otherwise their default saved address (when signed in). `null` = not set yet.
 */
export function useHomeLocation(signedIn: boolean) {
  const [location, setLocation] = useState<HomeLocation | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    const stored = readStored();
    if (stored) { setLocation(stored); setResolved(true); return; }
    if (!signedIn) { setResolved(true); return; }
    let cancelled = false;
    listAddresses()
      .then((rows) => {
        const a = rows.find((r) => r.is_default) ?? rows[0];
        if (!cancelled && a) setLocation({ lat: a.latitude, lng: a.longitude, area: areaName(a.address) || a.label });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setResolved(true); });
    return () => { cancelled = true; };
  }, [signedIn]);

  const save = useCallback((loc: HomeLocation) => {
    setLocation(loc);
    try { localStorage.setItem(KEY, JSON.stringify(loc)); } catch { /* chip still updates for this visit */ }
  }, []);

  return { location, resolved, save };
}
