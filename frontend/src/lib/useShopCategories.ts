"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ShopCategory } from "@/types";

/**
 * Shop categories with their active-shop counts (GET /shop-categories). By default only the
 * categories and subcategories that have at least one active shop; `onlyWithShops = false`
 * returns them all (a category page still needs its name when nobody sells there yet).
 * `loading` is true until the first answer; a failed request just yields no categories.
 */
export function useShopCategories(onlyWithShops = true) {
  const [categories, setCategories] = useState<ShopCategory[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    api.get<{ data: ShopCategory[] }>("/shop-categories", { params: onlyWithShops ? { with_shops: "true" } : undefined })
      .then((r) => { if (live) setCategories(r.data || []); })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [onlyWithShops]);
  return { categories, loading };
}
