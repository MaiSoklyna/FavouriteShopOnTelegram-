import Link from "next/link";
import { Icon } from "./Icon";
import { ShopCover } from "./ShopCover";
import type { ShopCardData } from "./ShopCard";
import { THEMES } from "@/lib/shopTheme";
import { formatEta, formatKm } from "@/lib/mapbox";

/**
 * List-size shop card (343 × 96): cover thumb with the logo on it, name and
 * category, then the same pills as the rail card in the same order.
 */
export function ShopRow({ shop, ribbon }: { shop: ShopCardData; ribbon?: "New" | "Promo" }) {
  const fee = shop.delivery_fee != null ? Number(shop.delivery_fee) : null;
  const known = shop.distance_km != null;
  const theme = shop.theme ?? "general";
  return (
    <Link href={`/shop/merchant/${shop.id}`} className="fos-press flex items-center gap-3 rounded-hero bg-card p-2.5 shadow-fos-sm">
      <span className={`relative h-[76px] w-[76px] shrink-0 overflow-hidden rounded-thumb ${shop.is_open === false ? "saturate-[.6]" : ""}`}>
        <ShopCover url={shop.cover_url} theme={theme} />
        <span className="absolute bottom-1.5 left-1.5 grid h-7 w-7 place-items-center overflow-hidden rounded-[9px] border-2 border-card bg-card text-[11px] font-extrabold text-navy-700">
          {shop.logo_url ? <img src={shop.logo_url} alt="" className="h-full w-full object-cover" /> : (shop.icon_emoji || shop.name[0]?.toUpperCase())}
        </span>
        {ribbon && <span className="absolute left-0 top-1.5 rounded-r-full bg-jade-500 px-1.5 py-0.5 text-[9px] font-extrabold text-white">{ribbon}</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-extrabold text-ink-900">{shop.name}</span>
        <span className="block truncate text-caption text-ink-500">{shop.tagline || THEMES[theme].label}</span>
        <span className="mt-1.5 flex flex-wrap gap-1">
          {shop.is_open != null && (
            <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-bold ${shop.is_open ? "bg-tint-jade text-tone-jade" : "bg-tint-ruby text-ruby-500"}`}>{shop.is_open ? "Open" : "Closed"}</span>
          )}
          <span className="inline-flex h-5 items-center gap-0.5 rounded-full bg-tint-neutral px-2 text-[10.5px] font-bold text-ink-500">
            <Icon name="star" size={10} filled />{shop.rating != null ? shop.rating.toFixed(1) : "New"}
          </span>
          {known && <span className="inline-flex h-5 items-center rounded-full bg-tint-neutral px-2 text-[10.5px] font-bold text-ink-500">{formatKm(shop.distance_km!)}</span>}
          {known && shop.eta_minutes != null && shop.eta_max_minutes != null && (
            <span className="inline-flex h-5 items-center rounded-full bg-tint-neutral px-2 text-[10.5px] font-bold text-ink-500">{formatEta(shop.eta_minutes, shop.eta_max_minutes)}</span>
          )}
          {known && (shop.can_deliver === false
            ? <span className="inline-flex h-5 items-center rounded-full bg-tint-mango px-2 text-[10.5px] font-bold text-tone-mango">Pickup only</span>
            : fee != null && <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-bold ${fee === 0 ? "bg-tint-jade text-tone-jade" : "bg-tint-neutral text-ink-500"}`}>{fee === 0 ? "Free delivery" : `$${fee.toFixed(2)}`}</span>)}
        </span>
      </span>
      <Icon name="chevron" size={18} className="text-ink-500" />
    </Link>
  );
}
