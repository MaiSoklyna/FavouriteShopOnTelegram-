"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { fetchNearbyShops, type NearbyShop } from "@/lib/addresses";
import { formatEta, formatKm } from "@/lib/mapbox";
import { useHomeLocation } from "@/lib/useHomeLocation";
import { SHOP_FILTERS, THEMES, applyShopFilter, useShopExtras, type ShopFilter } from "@/lib/shopTheme";
import { haptic } from "@/lib/telegram";
import { LocationSheet, ShopCard, ShopCardSkeleton, ShopCover, type ShopCardData } from "@/components/shop";
import { Icon } from "@/components/shop/Icon";

const ShopsMap = dynamic(() => import("@/components/map/ShopsMap"), {
  ssr: false,
  loading: () => <div className="fos-shimmer w-full" style={{ height: MAP_HEIGHT }} />,
});

// About a quarter of the screen: the cards are the point, the map is context
const MAP_HEIGHT = "clamp(190px, 28vh, 250px)";

const SORTS = ["Nearest", "Fastest", "Cheapest"] as const;
type Sort = (typeof SORTS)[number];

type Shop = ShopCardData & { lat: number; lng: number };

function sortShops(shops: Shop[], sort: Sort): Shop[] {
  const fee = (s: Shop) => (s.can_deliver === false || s.delivery_fee == null ? Infinity : Number(s.delivery_fee));
  const key: Record<Sort, (s: Shop) => number> = {
    Nearest: (s) => s.distance_km ?? Infinity,
    Fastest: (s) => s.eta_minutes ?? Infinity,
    Cheapest: fee,
  };
  // Open shops stay ahead of closed ones whatever the sort
  return [...shops].sort((a, b) => Number(a.is_open === false) - Number(b.is_open === false) || key[sort](a) - key[sort](b));
}

export default function NearbyPage() {
  const router = useRouter();
  const { user } = useAuth();
  const signedIn = !!user && "telegram_id" in (user as object);
  const { location, resolved, save } = useHomeLocation(signedIn);
  const [rows, setRows] = useState<NearbyShop[] | null>(null);
  const [error, setError] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filter, setFilter] = useState<ShopFilter>("All");
  const [sort, setSort] = useState<Sort>("Nearest");
  const [selected, setSelected] = useState<number | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const scrollLock = useRef(0);

  useEffect(() => {
    if (!location) return;
    let cancelled = false;
    setRows(null); setError(false);
    fetchNearbyShops(location.lat, location.lng, 0, 50)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch(() => { if (!cancelled) { setRows([]); setError(true); } });
    return () => { cancelled = true; };
  }, [location?.lat, location?.lng]);

  useEffect(() => { if (resolved && !location) setSheetOpen(true); }, [resolved, location]);

  const base = useMemo<Shop[]>(() => (rows ?? [])
    .map((s) => s as NearbyShop & { latitude?: number | null; longitude?: number | null })
    .filter((s) => s.latitude != null && s.longitude != null)
    .map((s) => ({
      id: s.id, name: s.name, tagline: s.tagline, logo_url: s.logo_url, icon_emoji: s.icon_emoji,
      distance_km: s.distance_km, can_deliver: s.can_deliver, delivery_fee: s.delivery_fee,
      eta_minutes: s.eta_minutes, eta_max_minutes: s.eta_max_minutes, is_open: s.is_open,
      lat: Number(s.latitude), lng: Number(s.longitude),
    })), [rows]);
  const extras = useShopExtras(base);
  const shops = useMemo(
    () => sortShops(applyShopFilter(base, filter), sort).map((s) => ({ ...s, theme: extras[s.id]?.theme, rating: extras[s.id]?.rating ?? null })),
    [base, filter, sort, extras],
  );
  const pins = useMemo(() => shops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, logo_url: s.logo_url, distance_km: s.distance_km })), [shops]);
  const delivering = base.filter((s) => s.can_deliver !== false).length;

  // First card is selected whenever the list changes
  useEffect(() => {
    setSelected(shops[0]?.id ?? null);
    rail.current?.scrollTo({ left: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shops.map((s) => s.id).join(",")]);

  /** Swiping the carousel selects the card in the middle. */
  function onRailScroll() {
    const el = rail.current;
    if (!el || Date.now() < scrollLock.current) return;
    const first = el.firstElementChild as HTMLElement | null;
    if (!first) return;
    const step = first.offsetWidth + 12;
    const i = Math.min(shops.length - 1, Math.max(0, Math.round(el.scrollLeft / step)));
    if (shops[i] && shops[i].id !== selected) setSelected(shops[i].id);
  }

  /** Tapping a pin brings its card into view. */
  function pickFromMap(id: number) {
    haptic("select");
    setSelected(id);
    const i = shops.findIndex((s) => s.id === id);
    const card = rail.current?.children[i] as HTMLElement | undefined;
    if (card && rail.current) {
      scrollLock.current = Date.now() + 600;
      rail.current.scrollTo({ left: card.offsetLeft - 16, behavior: "smooth" });
    }
  }

  return (
    <div className="min-h-screen bg-card font-sans">
      {/* Map: about a quarter of the screen */}
      <div className="relative">
        {location
          ? <ShopsMap you={location} shops={pins} selectedId={selected} onSelect={pickFromMap} height={MAP_HEIGHT} />
          : <div className="w-full bg-tint-map" style={{ height: MAP_HEIGHT }} />}
        <div className="absolute inset-x-4 top-3 flex items-center gap-2.5">
          <button type="button" onClick={() => router.back()} aria-label="Back"
            className="fos-press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-card text-ink-900 shadow-fos-md">
            <Icon name="back" size={20} strokeWidth={2.4} />
          </button>
          <button type="button" onClick={() => setSheetOpen(true)}
            className="fos-press flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-card px-3.5 shadow-fos-md">
            <Icon name="pin" size={16} strokeWidth={2.2} className="text-mango-500" />
            <span className="min-w-0 flex-1 truncate text-left text-[14px] font-extrabold text-ink-900">{location?.area || "Set your location"}</span>
            <span className="text-[12px] font-extrabold text-navy-500">Change</span>
          </button>
        </div>
      </div>

      {/* Sheet: the cards are the main thing */}
      <div className="relative z-[1] -mt-6 rounded-t-[28px] bg-card pb-6 shadow-[0_-10px_30px_rgba(8,29,60,0.10)]">
        <div className="mx-auto h-1 w-10 rounded-full bg-line pt-0" style={{ transform: "translateY(10px)" }} />

        <div className="flex items-end justify-between gap-3 px-4 pt-6">
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-extrabold leading-7 tracking-[-0.01em] text-ink-900">
              {rows == null ? "Finding shops…" : delivering > 0 ? `${delivering} ${delivering === 1 ? "shop delivers" : "shops deliver"} here` : "No shops deliver here yet"}
            </h1>
            <p className="truncate text-[13px] font-semibold text-ink-500">
              {error ? "Couldn't load shops. Check your connection." : "Distance, time and fee from your pin"}
            </p>
          </div>
          <button type="button" onClick={() => { haptic("select"); setSort(SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length]); }}
            aria-label={`Sort: ${sort}`}
            className="fos-press flex h-9 shrink-0 items-center gap-1 rounded-full border-[1.5px] border-line px-3 text-[12px] font-extrabold text-ink-900">
            {sort}<Icon name="down" size={14} strokeWidth={2.4} />
          </button>
        </div>

        <div className="fos-no-scrollbar mt-3 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label="Filter shops">
          {SHOP_FILTERS.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}
              className={`fos-press h-9 shrink-0 rounded-full px-3.5 text-[13px] font-extrabold ${filter === f ? "bg-navy-700 text-white" : "border-[1.5px] border-line bg-card text-ink-900"}`}>
              {f}
            </button>
          ))}
        </div>

        {/* Carousel */}
        <div ref={rail} onScroll={onRailScroll} className="fos-no-scrollbar mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-3">
          {rows == null
            ? [0, 1].map((i) => <ShopCardSkeleton key={i} variant="wide" />)
            : shops.map((s) => <ShopCard key={s.id} shop={s} variant="wide" selected={s.id === selected} />)}
        </div>
        {shops.length > 1 && (
          <div className="flex justify-center gap-1.5" aria-hidden>
            {shops.map((s) => (
              <span key={s.id} className={`h-1.5 rounded-full transition-all ${s.id === selected ? "w-[18px] bg-navy-700" : "w-1.5 bg-line"}`} />
            ))}
          </div>
        )}

        {rows != null && shops.length === 0 && (
          <div className="mx-4 mt-2 flex flex-col items-center gap-1 rounded-hero bg-surface px-6 py-8 text-center">
            <Icon name="store" size={36} strokeWidth={1.5} className="text-ink-500" />
            <p className="mt-1 text-[15px] font-extrabold text-ink-900">{base.length ? "No shops match this filter" : "No shops near this spot yet"}</p>
            <button type="button" onClick={() => (base.length ? setFilter("All") : setSheetOpen(true))} className="fos-press min-h-[40px] text-[13px] font-bold text-navy-500">
              {base.length ? "Show all shops" : "Try another location"}
            </button>
          </div>
        )}

        {/* Everything nearby, compact */}
        {shops.length > 1 && (
          <section className="mt-6 px-4">
            <h2 className="text-[17px] font-extrabold text-ink-900">All nearby shops</h2>
            <ul className="mt-2 divide-y divide-line">
              {shops.map((s) => (
                <li key={s.id}>
                  <Link href={`/shop/merchant/${s.id}`} className="fos-press flex items-center gap-3 py-3">
                    <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-thumb">
                      <ShopCover theme={s.theme ?? "general"} url={s.cover_url} />
                      {s.logo_url && <img src={s.logo_url} alt="" className="absolute bottom-1 right-1 h-7 w-7 rounded-lg border-2 border-card object-cover" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[15px] font-extrabold text-ink-900">{s.name}</span>
                        {s.rating != null
                          ? <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] font-extrabold text-gold-700"><Icon name="star" size={12} filled />{s.rating.toFixed(1)}</span>
                          : <span className="shrink-0 rounded-full bg-tint-navy px-1.5 text-[10px] font-extrabold text-navy-500">New</span>}
                      </span>
                      <span className="block truncate text-[12px] font-semibold text-ink-500">{s.tagline || THEMES[s.theme ?? "general"].label}{s.is_open === false ? " · Closed" : ""}</span>
                      <span className="mt-1 flex items-center gap-2.5 text-[12px] font-extrabold text-navy-700">
                        <span className="inline-flex items-center gap-0.5"><Icon name="pin" size={12} strokeWidth={2.4} />{formatKm(s.distance_km!)}</span>
                        {s.eta_minutes != null && s.eta_max_minutes != null && (
                          <span className="inline-flex items-center gap-0.5"><Icon name="clock" size={12} strokeWidth={2.4} />{formatEta(s.eta_minutes, s.eta_max_minutes)}</span>
                        )}
                        <span className={`inline-flex items-center gap-0.5 ${s.can_deliver === false ? "text-tone-mango" : "text-tone-jade"}`}>
                          <Icon name="truck" size={13} strokeWidth={2.2} />
                          {s.can_deliver === false ? "Pickup only" : Number(s.delivery_fee) === 0 ? "Free" : `$${Number(s.delivery_fee).toFixed(2)}`}
                        </span>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {sheetOpen && (
        <LocationSheet
          current={location}
          onClose={() => setSheetOpen(false)}
          onConfirm={(loc) => { save(loc); setSheetOpen(false); }}
        />
      )}
    </div>
  );
}
