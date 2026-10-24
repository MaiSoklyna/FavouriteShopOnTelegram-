import Link from "next/link";
import { formatEta, formatKm } from "@/lib/mapbox";
import { THEMES, type ShopTheme } from "@/lib/shopTheme";
import { Icon } from "./Icon";
import { ShopCover } from "./ShopCover";

export interface ShopCardData {
  id: number;
  name: string;
  tagline?: string | null;
  logo_url?: string | null;
  icon_emoji?: string | null;
  /** No cover column on shops yet, so the category art shows. */
  cover_url?: string | null;
  theme?: ShopTheme;
  /** Null = no reviews yet → "New". */
  rating?: number | null;
  /** The rest are only known once the customer has a location. */
  distance_km?: number;
  can_deliver?: boolean;
  delivery_fee?: string | null;
  eta_minutes?: number;
  eta_max_minutes?: number;
  is_open?: boolean;
}

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

/**
 * Shop card, GrabFood-style: category cover, logo, then rating, distance, ETA and
 * delivery fee always on the card. "rail" is the home-page size; "wide" fills the
 * nearby carousel and adds a Shop now button.
 */
export function ShopCard({ shop, variant = "rail", selected = false }: { shop: ShopCardData; variant?: "rail" | "wide"; selected?: boolean }) {
  const theme = shop.theme ?? "general";
  const fee = shop.delivery_fee != null ? Number(shop.delivery_fee) : null;
  const known = shop.distance_km != null;
  const free = shop.can_deliver !== false && fee === 0;
  const wide = variant === "wide";
  const feeLabel = shop.can_deliver === false ? "Pickup only" : fee == null ? "Fee at checkout" : free ? "Free" : `$${fee.toFixed(2)}`;
  return (
    <Link
      href={`/shop/merchant/${shop.id}`}
      className={`fos-press flex shrink-0 flex-col overflow-hidden rounded-hero bg-card shadow-fos-md ${wide ? "w-[84vw] max-w-[340px] snap-center" : "w-[268px] snap-start"} ${selected ? "ring-2 ring-navy-700" : ""}`}
    >
      <div className={`relative w-full ${wide ? "h-[150px]" : "h-[136px]"}`}>
        <ShopCover url={shop.cover_url} theme={theme} />
        {shop.is_open != null && (
          <span className={`absolute left-2.5 top-2.5 inline-flex h-6 items-center gap-1.5 rounded-full bg-card px-2.5 text-[11px] font-extrabold ${shop.is_open ? "text-tone-jade" : "text-ink-500"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${shop.is_open ? "bg-jade-500" : "bg-ink-500"}`} />
            {shop.is_open ? "Open" : "Closed"}
          </span>
        )}
        {free && known && (
          <span className="absolute right-2.5 top-2.5 inline-flex h-6 items-center gap-1 rounded-full bg-jade-500 px-2.5 text-[11px] font-extrabold text-white">
            <Icon name="truck" size={13} strokeWidth={2.2} />Free delivery
          </span>
        )}
        {known && shop.eta_minutes != null && shop.eta_max_minutes != null && (
          <span className="absolute bottom-2.5 right-2.5 inline-flex h-[26px] items-center gap-1 rounded-full bg-navy-900/85 px-2.5 text-[11px] font-extrabold text-white">
            <Icon name="clock" size={13} strokeWidth={2.4} />{formatEta(shop.eta_minutes, shop.eta_max_minutes)}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col px-3.5 pb-3.5">
        <div className="relative z-[1] -mt-[26px] flex items-end justify-between">
          <div className="grid h-[52px] w-[52px] place-items-center overflow-hidden rounded-thumb border-[3px] border-card bg-tint-navy text-[17px] font-extrabold text-navy-700">
            {shop.logo_url ? <img src={shop.logo_url} alt="" className="h-full w-full object-cover" /> : (shop.icon_emoji || initials(shop.name) || <Icon name="store" size={22} />)}
          </div>
          {shop.rating != null ? (
            <span className="inline-flex h-6 items-center gap-1 rounded-full bg-tint-gold px-2 text-[11px] font-extrabold text-gold-700">
              <Icon name="star" size={12} filled />{shop.rating.toFixed(1)}
            </span>
          ) : (
            <span className="inline-flex h-6 items-center rounded-full bg-tint-navy px-2 text-[11px] font-extrabold text-navy-500">New</span>
          )}
        </div>
        <p className={`mt-2 truncate font-extrabold leading-5 text-ink-900 ${wide ? "text-[17px]" : "text-[16px]"}`}>{shop.name}</p>
        <p className="mt-0.5 truncate text-[12px] font-semibold text-ink-500">{shop.tagline || THEMES[theme].label}</p>

        {known ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span className="inline-flex h-6 items-center gap-1 rounded-full bg-tint-navy px-2 text-[11px] font-extrabold text-navy-700">
              <Icon name="pin" size={12} strokeWidth={2.4} />{formatKm(shop.distance_km!)}
            </span>
            {shop.eta_minutes != null && shop.eta_max_minutes != null && (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-tint-navy px-2 text-[11px] font-extrabold text-navy-700">
                <Icon name="clock" size={12} strokeWidth={2.4} />{formatEta(shop.eta_minutes, shop.eta_max_minutes)}
              </span>
            )}
            <span className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-extrabold ${shop.can_deliver === false ? "bg-tint-mango text-tone-mango" : "bg-tint-jade text-tone-jade"}`}>
              <Icon name="truck" size={13} strokeWidth={2.2} />{feeLabel}
            </span>
          </div>
        ) : (
          <p className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-bold text-navy-500">
            <Icon name="pin" size={13} strokeWidth={2.2} />Set location for fee &amp; time
          </p>
        )}

        {wide && (
          <span className="mt-3 flex h-[46px] items-center justify-center gap-1.5 rounded-thumb bg-navy-700 text-[14px] font-extrabold text-white">
            Shop now
            {known && <span className="font-bold text-white/75">· {shop.can_deliver === false ? "pickup" : free ? "free delivery" : `delivery ${feeLabel}`}</span>}
          </span>
        )}
      </div>
    </Link>
  );
}

export function ShopCardSkeleton({ variant = "rail" }: { variant?: "rail" | "wide" }) {
  return (
    <div className={`shrink-0 overflow-hidden rounded-hero bg-card shadow-fos-md ${variant === "wide" ? "w-[84vw] max-w-[340px]" : "w-[268px]"}`} aria-hidden>
      <div className="fos-shimmer h-[136px] w-full" />
      <div className="px-3.5 pb-3.5">
        <div className="fos-shimmer -mt-[26px] h-[52px] w-[52px] rounded-thumb border-[3px] border-card" />
        <div className="fos-shimmer mt-2 h-4 w-32 rounded-md" />
        <div className="fos-shimmer mt-1.5 h-3 w-20 rounded-md" />
        <div className="mt-2.5 flex gap-1.5">
          <div className="fos-shimmer h-6 w-14 rounded-full" /><div className="fos-shimmer h-6 w-20 rounded-full" /><div className="fos-shimmer h-6 w-14 rounded-full" />
        </div>
      </div>
    </div>
  );
}
