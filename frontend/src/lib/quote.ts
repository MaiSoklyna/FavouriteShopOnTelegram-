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
  distance_km: string | null;
  total: string;
  promo_applied: boolean;
  /** The code that applied (typed, or picked automatically) */
  promo_code?: string | null;
  /** The promotion behind it, e.g. "Weekend Sale" */
  promo_title?: string | null;
  /** True when no code was typed and the best live promotion applied by itself */
  promo_auto?: boolean;
  /** Null for pickup or when no pin was sent. */
  eta_minutes: number | null;
  eta_max_minutes: number | null;
  is_open: boolean;
  min_order_amount: string | null;
}

export interface CartQuote {
  orders: ShopQuote[];
  totals: { subtotal: string; discount: string; delivery_fee: string; total: string };
  promo: { code: string; applied: boolean; merchant_id: number | null; error: string | null } | null;
}

export interface DeliveryChoice {
  delivery_type: "delivery" | "pickup";
  /** The map pin; without it delivery is priced at the default fee. */
  lat?: number;
  lng?: number;
}

/** With merchantId only that shop's cart is priced — each shop checks out on its own. */
export async function fetchQuote(promoCode?: string | null, delivery?: DeliveryChoice, merchantId?: number): Promise<CartQuote> {
  const res = await api.post<{ data: CartQuote }>("/orders/quote", { promo_code: promoCode || undefined, ...delivery, merchant_id: merchantId });
  return res.data;
}

// The applied promo code survives cart → checkout navigation, together with
// the shop it belongs to, so another shop's checkout doesn't try to use it.
const KEY = "fos_promo_code";

export interface SavedPromo { code: string; merchantId: number | null }

export function getSavedPromo(): SavedPromo | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedPromo;
    return v && typeof v.code === "string" ? v : null;
  } catch { return null; }
}

/** The saved code if it can be used at this shop's checkout. */
export function savedPromoFor(merchantId: number): string | null {
  const p = getSavedPromo();
  return p && (p.merchantId == null || p.merchantId === merchantId) ? p.code : null;
}

export function savePromo(code: string | null, merchantId: number | null = null) {
  try {
    if (code) sessionStorage.setItem(KEY, JSON.stringify({ code, merchantId }));
    else sessionStorage.removeItem(KEY);
  } catch { /* storage unavailable — promo just won't carry over */ }
}

export const money = (v: string | number | undefined | null) => `$${Number(v ?? 0).toFixed(2)}`;
