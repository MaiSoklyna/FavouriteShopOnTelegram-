import type { Coupon, WalletCoupon } from "@/types";

/** "Ends today", "Ends in 3 days", "Ends Dec 7" or "No expiry". */
export function expiryText(expires?: string | null, now = new Date()): string {
  if (!expires) return "No expiry";
  const end = new Date(expires);
  if (Number.isNaN(end.getTime())) return "";
  const days = Math.ceil((end.getTime() - now.getTime()) / 86400000);
  if (days < 0) return "Expired";
  if (days === 0) return "Ends today";
  if (days <= 7) return `Ends in ${days} day${days === 1 ? "" : "s"}`;
  return `Ends ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** "Min. spend $20.00" or null when there is no minimum. */
export const minSpendText = (c: Pick<Coupon, "min_order">) => (c.min_order > 0 ? `Min. spend $${c.min_order.toFixed(2)}` : null);

export const shopText = (c: Pick<Coupon, "shop_name" | "merchant_id">) => (c.merchant_id ? c.shop_name || "One shop" : "All shops");

export const limitText = (c: Pick<Coupon, "per_user_limit">) =>
  c.per_user_limit == null ? null : c.per_user_limit === 1 ? "One use per customer" : `${c.per_user_limit} uses per customer`;

export const STATUS_LABEL: Record<WalletCoupon["status"], string> = {
  available: "Available", used: "Used", expired: "Expired", used_up: "Fully claimed", inactive: "Not available",
};
