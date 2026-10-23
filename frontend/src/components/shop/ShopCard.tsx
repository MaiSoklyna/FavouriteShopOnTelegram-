import Link from "next/link";
import { formatKm } from "@/lib/mapbox";
import { Pill, RatingPill } from "./Pill";

export interface ShopCardData {
  id: number;
  name: string;
  logo_url?: string | null;
  icon_emoji?: string | null;
  /** Shop cover photo. No cover is stored for shops yet, so the gradient placeholder shows. */
  cover_url?: string | null;
  rating?: number | null;
  /** Only known once the customer has a location. */
  distance_km?: number;
  can_deliver?: boolean;
  delivery_fee?: string | null;
  is_open?: boolean;
}

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

/**
 * 280×214, r24. Cover 280×120 (7:3), 52² logo overlapping it by 28px.
 * Pills show only what we actually know: rating (placeholder "★ —"),
 * distance, delivery fee, and "Open" when the API says so.
 */
export function ShopCard({ shop }: { shop: ShopCardData }) {
  const fee = shop.delivery_fee != null ? Number(shop.delivery_fee) : null;
  return (
    <Link
      href={`/shop/merchant/${shop.id}`}
      className="fos-press block h-[214px] w-[280px] shrink-0 overflow-hidden rounded-hero bg-white shadow-fos-md"
    >
      <div className="relative h-[120px] w-full bg-grad-hero">
        {shop.cover_url && <img src={shop.cover_url} alt="" loading="lazy" className="h-full w-full object-cover" />}
      </div>

      <div className="px-3.5 pb-3">
        <div className="-mt-7 grid h-[52px] w-[52px] place-items-center overflow-hidden rounded-thumb border-[3px] border-white bg-[#EEF2F8] text-lg font-extrabold text-navy-700">
          {shop.logo_url ? <img src={shop.logo_url} alt="" className="h-full w-full object-cover" /> : (shop.icon_emoji || initials(shop.name) || "🏪")}
        </div>
        <p className="mt-1.5 truncate text-[16px] font-extrabold leading-5 text-ink-900">{shop.name}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <RatingPill rating={shop.rating} />
          {shop.distance_km != null && <Pill>{`📍 ${formatKm(shop.distance_km)}`}</Pill>}
          {shop.can_deliver && fee != null && <Pill variant="jade">{fee === 0 ? "Free delivery" : `🚚 $${fee.toFixed(2)}`}</Pill>}
          {shop.can_deliver === false && <Pill variant="neutral">Pickup only</Pill>}
          {shop.is_open === true && <Pill variant="mango">Open</Pill>}
        </div>
      </div>
    </Link>
  );
}

export function ShopCardSkeleton() {
  return (
    <div className="h-[214px] w-[280px] shrink-0 overflow-hidden rounded-hero bg-white shadow-fos-md" aria-hidden>
      <div className="fos-shimmer h-[120px] w-full" />
      <div className="px-3.5">
        <div className="fos-shimmer -mt-7 h-[52px] w-[52px] rounded-thumb border-[3px] border-white" />
        <div className="fos-shimmer mt-2 h-4 w-32 rounded-md" />
        <div className="mt-2 flex gap-1.5">
          <div className="fos-shimmer h-6 w-12 rounded-full" /><div className="fos-shimmer h-6 w-16 rounded-full" /><div className="fos-shimmer h-6 w-14 rounded-full" />
        </div>
      </div>
    </div>
  );
}
