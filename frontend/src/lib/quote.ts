/**
 * Order quote — the backend's price for the current cart.
 *
 * The cart and checkout pages display these numbers instead of doing their
 * own math, so what the customer sees is exactly what placing the order
 * (and the PayWay QR) charges.
 */

import { api } from "@/lib/api";

export interface ShopQuote {
  merchant_id: number;
  subtotal: string;
  discount: string;
  delivery_fee: string;
  total: string;
  promo_applied: boolean;
}

export interface CartQuote {
  orders: ShopQuote[];
  totals: { subtotal: string; discount: string; delivery_fee: string; total: string };
  promo: { code: string; applied: boolean; merchant_id: number | null; error: string | null } | null;
}

export async function fetchQuote(promoCode?: string | null): Promise<CartQuote> {
  const res = await api.post<{ data: CartQuote }>("/orders/quote", { promo_code: promoCode || undefined });
  return res.data;
}

// The applied promo code survives cart → checkout navigation.
const KEY = "fos_promo_code";

export function getSavedPromo(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

export function savePromo(code: string | null) {
  try {
    if (code) sessionStorage.setItem(KEY, code);
    else sessionStorage.removeItem(KEY);
  } catch { /* storage unavailable — promo just won't carry over */ }
}

export const money = (v: string | number | undefined | null) => `$${Number(v ?? 0).toFixed(2)}`;
