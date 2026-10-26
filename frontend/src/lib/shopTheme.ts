"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { IconName } from "@/components/shop/Icon";

/**
 * Shops have no category, rating or cover columns, so the shop cards derive them:
 * the theme from the shop's name and its products, the rating from its product
 * reviews. A theme picks the generated cover art.
 */
export type ShopTheme = "electronics" | "fashion" | "beauty" | "food" | "flowers" | "kids" | "general";

export const THEMES: Record<ShopTheme, { label: string; bg: string; ink: string; icons: IconName[] }> = {
  electronics: { label: "Electronics", bg: "#DCE6F5", ink: "#1B4B8A", icons: ["laptop", "headphones", "mobile", "watch", "bolt"] },
  fashion:     { label: "Fashion",     bg: "#DDF2E6", ink: "#067647", icons: ["shirt", "hanger", "bag", "tag", "sparkle"] },
  beauty:      { label: "Beauty",      bg: "#FAE1EA", ink: "#9D2257", icons: ["lipstick", "bottle", "sparkle", "flower", "star"] },
  food:        { label: "Food & bakery", bg: "#F7EBCB", ink: "#8A5A19", icons: ["cake", "cup", "gift", "star", "sparkle"] },
  flowers:     { label: "Flowers & gifts", bg: "#F1E4F8", ink: "#6B2F8A", icons: ["flower", "gift", "sparkle", "tag", "star"] },
  kids:        { label: "Kids & toys", bg: "#FFF3C7", ink: "#8A5A00", icons: ["teddy", "gift", "star", "sparkle", "bag"] },
  general:     { label: "Shop",        bg: "#E6ECF4", ink: "#103562", icons: ["bag", "box", "tag", "gift", "sparkle"] },
};

const KEYWORDS: Record<Exclude<ShopTheme, "general">, string[]> = {
  electronics: ["electronic", "computer", "keyboard", "mouse", "laptop", "phone", "gadget", "tech", "smartwatch", "watch", "headphone", "earbud", "charger", "cable", "gaming", "camera", "speaker"],
  fashion: ["fashion", "cloth", "shirt", "t-shirt", "dress", "wear", "boutique", "shoe", "sneaker", "jean", "skirt", "jacket", "hoodie", "handbag", "style"],
  beauty: ["beauty", "skin", "serum", "cosmetic", "makeup", "lip", "nail", "shampoo", "conditioner", "sunscreen", "toner", "cleanser", "moistur", "cream", "foundation", "blush", "powder", "highlighter", "acne", "perfume", "shower", "scrub"],
  food: ["cake", "bakery", "bake", "food", "cafe", "coffee", "tea", "chocolate", "snack", "kitchen", "restaurant", "drink", "juice", "strawberry", "fruit", "dessert", "cookie", "bread", "noodle", "rice"],
  flowers: ["flower", "bloom", "florist", "bouquet", "rose", "gift"],
  kids: ["toy", "kid", "baby", "child", "girl", "boy"],
};

export function classifyShop(texts: string[]): ShopTheme {
  const hay = texts.join(" ").toLowerCase();
  let best: ShopTheme = "general";
  let bestScore = 0;
  for (const [theme, words] of Object.entries(KEYWORDS) as [ShopTheme, string[]][]) {
    const score = words.reduce((n, w) => n + (hay.split(w).length - 1), 0);
    if (score > bestScore) { best = theme; bestScore = score; }
  }
  return best;
}

export interface ShopExtras {
  theme: ShopTheme;
  /** Average of the shop's reviewed products; null = no reviews yet ("New"). */
  rating: number | null;
  reviews: number;
}

interface ProductLite { name: string; category_name?: string | null; rating_avg?: number | null; review_count?: number | null }

const cache = new Map<number, Promise<ShopExtras>>();

function loadExtras(shop: { id: number; name: string; tagline?: string | null }): Promise<ShopExtras> {
  let p = cache.get(shop.id);
  if (!p) {
    p = api.get<ProductLite[] | { data: ProductLite[] }>("/products", { params: { merchant_id: shop.id, page_size: 30 } })
      .then((res) => (Array.isArray(res) ? res : res.data ?? []))
      .catch(() => [] as ProductLite[])
      .then((products) => {
        // The shop's own name counts three times, so a bakery that also sells a mug stays a bakery
        const texts = [shop.name, shop.name, shop.name, shop.tagline || "", ...products.map((x) => `${x.name} ${x.category_name || ""}`)];
        let sum = 0, reviews = 0;
        for (const x of products) {
          const n = Number(x.review_count) || 0;
          if (n > 0) { sum += (Number(x.rating_avg) || 0) * n; reviews += n; }
        }
        return { theme: classifyShop(texts), rating: reviews ? sum / reviews : null, reviews };
      });
    cache.set(shop.id, p);
  }
  return p;
}

/** Theme + rating per shop id, filled in as each shop's products arrive. */
export function useShopExtras(shops: { id: number; name: string; tagline?: string | null }[]) {
  const [extras, setExtras] = useState<Record<number, ShopExtras>>({});
  const key = shops.map((s) => s.id).join(",");
  useEffect(() => {
    let cancelled = false;
    for (const s of shops) {
      loadExtras(s).then((x) => { if (!cancelled) setExtras((prev) => (prev[s.id] ? prev : { ...prev, [s.id]: x })); });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return extras;
}

/** Quick filters above the shop cards (home rail and nearby screen). */
export const SHOP_FILTERS = ["All", "Free delivery", "Open now", "Under 2 km"] as const;
export type ShopFilter = (typeof SHOP_FILTERS)[number];

export function applyShopFilter<T extends { delivery_fee?: string | null; can_deliver?: boolean; is_open?: boolean; distance_km?: number }>(shops: T[], f: ShopFilter): T[] {
  if (f === "Free delivery") return shops.filter((s) => s.can_deliver !== false && s.delivery_fee != null && Number(s.delivery_fee) === 0);
  if (f === "Open now") return shops.filter((s) => s.is_open !== false);
  if (f === "Under 2 km") return shops.filter((s) => s.distance_km != null && s.distance_km < 2);
  return shops;
}
