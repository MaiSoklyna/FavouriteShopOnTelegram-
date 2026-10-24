"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useShopExtras, type ShopTheme } from "@/lib/shopTheme";
import type { ShopCardData } from "@/components/shop";
import type { HomeLocation } from "@/lib/useHomeLocation";

/** A shop as Discover shows it: public merchant fields + delivery info for the customer's location. */
export interface DiscoverShop extends ShopCardData {
  is_featured?: boolean;
  created_at?: string;
  opening_hours?: Record<string, [string, string][]> | null;
  theme?: ShopTheme;
  reviews?: number;
}

interface MerchantRow {
  id: number; name: string; tagline?: string | null; logo_url?: string | null; icon_emoji?: string | null;
  is_featured?: boolean; created_at?: string; opening_hours?: DiscoverShop["opening_hours"];
}
interface NearbyRow {
  id: number; distance_km: number; can_deliver: boolean; delivery_fee: string | null;
  eta_minutes: number | null; eta_max_minutes: number | null; is_open: boolean;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const NEW_DAYS = 30;

export const isNewShop = (s: DiscoverShop) =>
  !!s.created_at && Date.now() - new Date(s.created_at).getTime() < NEW_DAYS * 86400000;

/** Opening hours run past 21:00 today. Shops without hours set are unknown, not "late". */
export function opensLate(s: DiscoverShop, now = new Date()): boolean {
  const today = s.opening_hours?.[DAYS[now.getDay()]];
  return !!today?.some(([, close]) => close > "21:00" || close === "00:00");
}

/** Rule-based collections (no curated data needed). */
export const COLLECTIONS = [
  { key: "free-delivery", title: "Free delivery shops", sub: "Delivers to you for $0", tone: "navy", match: (s: DiscoverShop) => s.can_deliver !== false && s.delivery_fee != null && Number(s.delivery_fee) === 0 },
  { key: "best-rated", title: "Best rated", sub: "4.5★ and up", tone: "gold", match: (s: DiscoverShop) => (s.rating ?? 0) >= 4.5 && (s.reviews ?? 0) >= 5 },
  { key: "open-late", title: "Open late", sub: "Past 9 pm tonight", tone: "night", match: (s: DiscoverShop) => opensLate(s) },
  { key: "new", title: "New on Byme24", sub: `Joined in the last ${NEW_DAYS} days`, tone: "jade", match: isNewShop },
] as const;
export type CollectionKey = (typeof COLLECTIONS)[number]["key"];

/**
 * Every active shop, merged with what the backend says about delivering to
 * `location` (distance, fee, ETA, open), plus rating/theme and hero-photo covers.
 */
export function useDiscoverShops(location: HomeLocation | null) {
  const [rows, setRows] = useState<MerchantRow[] | null>(null);
  const [near, setNear] = useState<Record<number, NearbyRow>>({});
  const [covers, setCovers] = useState<Record<number, string>>({});

  useEffect(() => {
    api.get<MerchantRow[]>("/merchants").then(setRows).catch(() => setRows([]));
  }, []);

  useEffect(() => {
    if (!location) { setNear({}); return; }
    api.get<NearbyRow[]>("/merchants/nearby", { params: { lat: location.lat, lng: location.lng, radius_km: 25, limit: 50 } })
      .then((list) => setNear(Object.fromEntries(list.map((n) => [n.id, n]))))
      .catch(() => setNear({}));
  }, [location?.lat, location?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // A shop's own hero photo is its cover; the rest keep the generated cover
  useEffect(() => {
    if (!rows) return;
    let live = true;
    rows.forEach((m) => {
      api.get<{ url: string }[]>(`/merchants/${m.id}/hero-images`)
        .then((imgs) => { if (live && imgs[0]?.url) setCovers((c) => ({ ...c, [m.id]: imgs[0].url })); })
        .catch(() => {});
    });
    return () => { live = false; };
  }, [rows]);

  const extras = useShopExtras(rows ?? []);

  const shops = useMemo<DiscoverShop[] | null>(() => rows && rows.map((m) => {
    const n = near[m.id];
    const x = extras[m.id];
    return {
      id: m.id, name: m.name, tagline: m.tagline, logo_url: m.logo_url, icon_emoji: m.icon_emoji,
      is_featured: m.is_featured, created_at: m.created_at, opening_hours: m.opening_hours,
      cover_url: covers[m.id] ?? null,
      rating: x?.rating ?? null, reviews: x?.reviews ?? 0, theme: x?.theme,
      ...(n ? {
        distance_km: n.distance_km, can_deliver: n.can_deliver, delivery_fee: n.delivery_fee,
        eta_minutes: n.eta_minutes ?? undefined, eta_max_minutes: n.eta_max_minutes ?? undefined, is_open: n.is_open,
      } : {}),
    };
  }), [rows, near, extras, covers]);

  return { shops, loading: rows === null };
}
