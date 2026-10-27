/**
 * Promotions — one model, one card. A promotion may have an image, a code with
 * a discount, a shop, products, a category and a schedule; any of them may be
 * missing. The card draws itself from what is there (components/shop/PromotionCard):
 * with an image it is a large banner, without one it is generated from the title,
 * discount, code, expiry and shop name.
 *
 * Sources: rows from GET /promotions (migration 018+), and — until migration 021
 * has turned them into promotions — plain shop promo codes from /promos/active.
 */

import type { PromoCode, Product } from "@/types";

export interface Promotion {
  /** "promotion-12", or "code-5" for a plain promo code */
  id: string;
  title: string;
  subtitle?: string | null;
  /** Banner image: when set the card is a large banner */
  image?: string | null;
  /** End of the current run (a weekend sale: Sunday midnight), or the end date */
  expiresAt?: string | null;
  cta: string;
  /** Deep link the card opens */
  href: string;
  /** The code to save for checkout (merchantId null = any shop) */
  code?: { code: string; merchantId: number | null };
  /** The offer, when the promotion has a code and discount */
  offer?: { discount: string; code: string; minOrder: number | null; auto?: boolean } | null;
  /** "Bloom & Co." / "every shop"; null when the shop is unknown */
  shopName?: string | null;
  /** "All products" / "3 selected products" / "All Serums" */
  covers?: string | null;
  /** "Every weekend (Saturday and Sunday)" for recurring promotions */
  schedule?: string | null;
  /** The shop's logo, emoji and accent colour, for the generated banner when there is no image */
  brand?: { logo?: string | null; emoji?: string | null; color?: string | null } | null;
}

/** A row from GET /promotions (and /promotions/admin/list) */
export interface PromotionRow {
  id: number;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  scope: "shop" | "product" | "category" | "platform";
  /** null for platform-wide promotions */
  merchant_id: number | null;
  category_id: number | null;
  category_name?: string | null;
  starts_at: string | null;
  ends_at: string | null;
  display_locations: string[];
  is_active: boolean;
  schedule_type?: "once" | "weekly" | "monthly" | "yearly";
  weekdays?: number[];
  month_days?: number[];
  yearly_ranges?: { start: string; end: string }[];
  auto_apply?: boolean;
  /** "Every weekend (Saturday and Sunday)" */
  schedule_text?: string;
  /** End of the current run (e.g. Sunday midnight for a weekend sale) */
  active_until?: string | null;
  /** When it next switches on (admin list; detail page on an off day) */
  next_start?: string | null;
  shop?: { id: number; name: string; logo_url?: string | null; icon_emoji?: string | null; accent_color?: string | null } | null;
  offer: { code: string; type: "percent" | "fixed"; value: number | string; min_order: number | string | null; max_uses: number | null; used_count: number | null; is_active: boolean } | null;
  product_count?: number | null;
  /** detail only */
  products?: Product[];
  /** admin list only */
  product_ids?: number[];
  is_live?: boolean;
}

/** "30% OFF" / "$5.00 OFF" */
export function discountLabel(p: Pick<PromoCode, "type" | "value">): string {
  return p.type === "percent" ? `${Number(p.value)}% OFF` : `$${Number(p.value).toFixed(2)} OFF`;
}

/** "7 Dec 2026"; null when there is no end date. */
export function expiryDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const DAY = 86400000;

/** "Ends in 5 h", "Ends in 3 days", "Until 7 Dec"; null when there is no end date. */
export function expiryLabel(iso?: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (Number.isNaN(end)) return null;
  const left = end - now;
  if (left <= 0) return "Ended";
  if (left < DAY) return `Ends in ${Math.max(1, Math.round(left / 3600000))} h`;
  if (left <= 7 * DAY) return `Ends in ${Math.ceil(left / DAY)} days`;
  return `Until ${new Date(end).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

/** "All products" / "3 selected products" / "All Serums" / "Every shop" */
export function coversLabel(p: Pick<PromotionRow, "scope" | "product_count" | "category_name">): string {
  if (p.scope === "platform") return "Every shop";
  if (p.scope === "product") return p.product_count ? `${p.product_count} selected ${p.product_count === 1 ? "product" : "products"}` : "Selected products";
  if (p.scope === "category") return p.category_name ? `All ${p.category_name}` : "One category";
  return "All products";
}

/** Any promotion row as a card: banner or generated, with or without an offer. */
export function promotionCard(p: PromotionRow): Promotion {
  const minOrder = p.offer?.min_order ? Number(p.offer.min_order) : null;
  return {
    id: `promotion-${p.id}`,
    title: p.title,
    subtitle: p.subtitle,
    image: p.image_url,
    expiresAt: p.active_until ?? p.ends_at,
    cta: p.offer ? "Shop now" : "See more",
    href: `/shop/promotion/${p.id}`,
    code: p.offer ? { code: p.offer.code, merchantId: p.merchant_id } : undefined,
    offer: p.offer
      ? { discount: discountLabel({ type: p.offer.type, value: Number(p.offer.value) }), code: p.offer.code, minOrder: minOrder || null, auto: !!p.auto_apply }
      : null,
    shopName: p.scope === "platform" ? "every shop" : p.shop?.name ?? null,
    covers: p.scope === "platform" ? null : coversLabel(p),
    schedule: p.schedule_type && p.schedule_type !== "once" ? p.schedule_text ?? null : null,
    brand: p.shop ? { logo: p.shop.logo_url, emoji: p.shop.icon_emoji, color: p.shop.accent_color } : null,
  };
}

const isLive = (iso?: string | null, now = Date.now()) => !iso || new Date(iso).getTime() > now;

/** A plain shop promo code (before migration 021 makes it a promotion) as a card. */
export function codeCard(
  p: PromoCode,
  shop?: { name: string; image?: string | null; logo?: string | null; emoji?: string | null; color?: string | null },
): Promotion | null {
  if (!p.is_active || !isLive(p.expires_at)) return null;
  if (p.max_uses != null && p.used_count >= p.max_uses) return null;
  // A code with no shop is platform-wide and belongs to a promotion, which shows it on its own days
  if (p.merchant_id == null) return null;
  const discount = discountLabel(p);
  return {
    id: `code-${p.id}`,
    title: shop ? `${discount.replace(" OFF", " off")} at ${shop.name}` : discount,
    image: shop?.image,
    expiresAt: p.expires_at,
    cta: "Shop now",
    // ?promo= lets the shop page confirm the code with a "Promotion applied" banner
    href: `/shop/merchant/${p.merchant_id}?promo=${encodeURIComponent(p.code)}`,
    code: { code: p.code, merchantId: p.merchant_id },
    offer: { discount, code: p.code, minOrder: p.min_order ? Number(p.min_order) : null },
    shopName: shop?.name ?? null,
    covers: "All products",
    brand: shop ? { logo: shop.logo, emoji: shop.emoji, color: shop.color } : null,
  };
}
