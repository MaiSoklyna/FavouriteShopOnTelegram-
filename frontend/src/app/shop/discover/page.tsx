"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useHomeLocation } from "@/lib/useHomeLocation";
import { COLLECTIONS, isNewShop, useDiscoverShops, type DiscoverShop } from "@/lib/useDiscoverShops";
import { classifyShop, THEMES, type ShopTheme } from "@/lib/shopTheme";
import { HeroCarousel, LocationSheet, ShopCard, ShopCardSkeleton, ShopCover, Skeleton, type HeroSlide } from "@/components/shop";
import { ShopRow } from "@/components/shop/ShopRow";
import { Icon } from "@/components/shop/Icon";
import type { Category } from "@/types";

interface Banner { id: number; title: string; subtitle?: string | null; image_url?: string | null; category_id: number }

/** A rail shows only with 2+ shops; with fewer than 3 rails they merge into one. */
const MIN_RAIL = 2;

export default function DiscoverPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { location, save: saveLocation } = useHomeLocation(!!user);
  const { shops, loading } = useDiscoverShops(location);
  const [categories, setCategories] = useState<Category[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    api.get<Category[]>("/categories").then(setCategories).catch(() => {});
    // Discover shows the "category" banners; Home keeps its own "home" ones
    api.get<Banner[]>("/category-banners", { params: { placement: "category" } }).then(setBanners).catch(() => {});
  }, []);

  const all = shops ?? [];
  const byNearest = (a: DiscoverShop, b: DiscoverShop) =>
    Number(b.is_open ?? false) - Number(a.is_open ?? false) || (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9);

  // Rails, each shop in at most two of them
  const rails = useMemo(() => {
    const used = new Map<number, number>();
    const take = (list: DiscoverShop[]) => list.filter((s) => (used.get(s.id) ?? 0) < 2);
    const mark = (list: DiscoverShop[]) => { list.forEach((s) => used.set(s.id, (used.get(s.id) ?? 0) + 1)); return list; };
    const out: { key: string; title: string; action?: { label: string; href: string }; shops: DiscoverShop[] }[] = [];
    const featured = take(all.filter((s) => s.is_featured));
    if (featured.length >= MIN_RAIL) out.push({ key: "featured", title: "Featured shops", shops: mark(featured) });
    const fresh = take(all.filter(isNewShop).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")));
    if (fresh.length >= MIN_RAIL) out.push({ key: "new", title: "New on Byme24", action: { label: "All", href: "/shop/collection/new" }, shops: mark(fresh) });
    const nearby = take(all.filter((s) => s.distance_km != null).sort(byNearest));
    if (nearby.length >= MIN_RAIL) out.push({ key: "near", title: "Near you", action: { label: "Map", href: "/shop/nearby" }, shops: mark(nearby) });
    return out;
  }, [all]); // eslint-disable-line react-hooks/exhaustive-deps
  const merged = rails.length < 3;

  const collections = COLLECTIONS
    .map((c) => ({ ...c, shops: all.filter(c.match) }))
    .filter((c) => c.shops.length >= MIN_RAIL);

  // Categories grouped into a few parents by name (no parent column in the data yet)
  const groups = useMemo(() => {
    const map = new Map<ShopTheme, { cats: Category[]; items: number; image?: string | null }>();
    for (const c of categories) {
      const n = Number((c as { product_count?: number }).product_count ?? 0);
      if (n <= 0) continue;
      const g = classifyShop([c.name]);
      const cur = map.get(g) ?? { cats: [], items: 0, image: null };
      cur.cats.push(c); cur.items += n;
      cur.image = cur.image || (c as { image_url?: string | null }).image_url || null;
      map.set(g, cur);
    }
    return Array.from(map, ([theme, v]) => ({ theme, ...v })).sort((a, b) => b.items - a.items);
  }, [categories]);

  // Banners: uploaded Discover banners, else campaigns built from real shop data
  const slides: HeroSlide[] = useMemo(() => {
    const uploaded = banners.filter((b) => b.image_url);
    if (uploaded.length) return uploaded.map((b) => ({ key: b.id, label: b.subtitle, title: b.title, image: b.image_url, cta: "Shop now", href: `/shop/category/${b.category_id}` }));
    const out: HeroSlide[] = [];
    const fresh = all.filter(isNewShop);
    if (fresh.length) out.push({ key: "new", label: "New this month", title: fresh.length === 1 ? `Welcome ${fresh[0].name}` : `${fresh.length} new shops`, cta: fresh.length === 1 ? "Visit shop" : "See shops", href: fresh.length === 1 ? `/shop/merchant/${fresh[0].id}` : "/shop/collection/new" });
    const star = all.find((s) => s.is_featured && s.cover_url) ?? all.find((s) => s.is_featured);
    if (star) out.push({ key: `shop-${star.id}`, label: "Featured shop", title: star.name, image: star.cover_url, cta: "Visit shop", href: `/shop/merchant/${star.id}` });
    const free = collections.find((c) => c.key === "free-delivery");
    if (free) out.push({ key: "free", label: "Delivers for $0", title: `${free.shops.length} free delivery shops`, cta: "See shops", href: "/shop/collection/free-delivery" });
    if (!out.length && all.length) out.push({ key: "all", label: "On Byme24", title: `${all.length} local shops`, cta: "Explore", href: "#all-shops" });
    return out;
  }, [banners, all, collections]);

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <div className="px-gutter pt-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-display text-ink-900">Discover</h1>
          <button type="button" onClick={() => setSheetOpen(true)} aria-label="Change location"
            className="fos-press flex h-9 min-w-0 items-center gap-1.5 rounded-full bg-card px-3 text-[13px] font-extrabold text-ink-900 shadow-fos-sm">
            <Icon name="pin" size={15} className="text-mango-500" strokeWidth={2.2} />
            <span className="max-w-[120px] truncate">{location?.area ?? "Set location"}</span>
          </button>
        </div>
      </div>
      <div className="sticky top-0 z-30 bg-surface px-gutter pb-2 pt-3">
        <button type="button" onClick={() => router.push("/shop/search")}
          className="fos-press flex h-12 w-full items-center gap-2.5 rounded-thumb bg-card pl-3.5 pr-3 text-left shadow-fos-sm">
          <svg className="shrink-0 text-ink-500" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          <span className="flex-1 truncate text-[15px] text-ink-500">Search shops or categories</span>
        </button>
      </div>

      <div className="flex flex-col gap-6 px-gutter pb-8 pt-2">
        {/* Promotions */}
        {loading ? <Skeleton className="h-[180px] rounded-hero" /> : slides.length > 0 && <HeroCarousel slides={slides} />}

        {/* Shop rails */}
        {loading ? (
          <section>
            <Skeleton className="mb-3 h-5 w-40 rounded-md" />
            <div className="flex gap-3 overflow-hidden">{[0, 1].map((i) => <ShopCardSkeleton key={i} />)}</div>
          </section>
        ) : merged ? (
          all.length > 0 && <Rail title="Shops on Byme24" action={location ? { label: "Map", href: "/shop/nearby" } : undefined} shops={[...all].sort(byNearest)} located={!!location} />
        ) : (
          rails.map((r) => <Rail key={r.key} title={r.title} action={r.action} shops={r.shops} located={!!location} />)
        )}

        {!location && !loading && (
          <button type="button" onClick={() => setSheetOpen(true)}
            className="fos-press flex items-center gap-3 rounded-hero bg-card p-3.5 text-left shadow-fos-sm">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-tint-mango text-mango-500"><Icon name="pin" size={22} strokeWidth={2} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-extrabold text-ink-900">See distance, fees and ETAs</span>
              <span className="block text-caption text-ink-500">Set where you want things delivered</span>
            </span>
            <span className="shrink-0 rounded-full bg-navy-700 px-3 py-1.5 text-[12px] font-extrabold text-white">Set location</span>
          </button>
        )}

        {/* Collections */}
        {collections.length > 0 && (
          <section>
            <Header title="Collections" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              {collections.map((c) => <CollectionTile key={c.key} href={`/shop/collection/${c.key}`} title={c.title} tone={c.tone} shops={c.shops} />)}
            </div>
          </section>
        )}

        {/* Categories */}
        {groups.length > 0 && (
          <section>
            <Header title="Browse categories" action={{ label: "All", href: "/shop/categories" }} />
            <div className="mt-3 grid grid-cols-2 gap-3">
              {groups.slice(0, 6).map((g) => (
                <Link key={g.theme} href={g.cats.length === 1 ? `/shop/category/${g.cats[0].id}` : `/shop/categories?group=${g.theme}`}
                  className="fos-press relative flex h-24 overflow-hidden rounded-card bg-card shadow-fos-sm">
                  <span className="z-10 flex min-w-0 flex-1 flex-col justify-center pl-3.5">
                    <span className="truncate text-[15px] font-extrabold text-ink-900">{THEMES[g.theme].label === "Shop" ? "Everyday" : THEMES[g.theme].label}</span>
                    <span className="text-[12px] font-semibold text-ink-500">{g.items} {g.items === 1 ? "item" : "items"}</span>
                  </span>
                  <span className="relative w-[44%] shrink-0">
                    {g.image ? <img src={g.image} alt="" className="h-full w-full object-cover" /> : <ShopCover theme={g.theme} />}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* All shops */}
        {!loading && all.length > 0 && (
          <section id="all-shops" className="scroll-mt-20">
            <Header title={`All shops · ${all.length}`} />
            <div className="mt-3 flex flex-col gap-2.5">
              {[...all].sort((a, b) => (location ? byNearest(a, b) : a.name.localeCompare(b.name))).map((s) => (
                <ShopRow key={s.id} shop={s} ribbon={isNewShop(s) ? "New" : undefined} />
              ))}
            </div>
          </section>
        )}
      </div>

      {sheetOpen && (
        <LocationSheet current={location} onClose={() => setSheetOpen(false)}
          onConfirm={(loc) => { saveLocation(loc); setSheetOpen(false); }} />
      )}
    </div>
  );
}

function Header({ title, action }: { title: string; action?: { label: string; href: string } }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-section text-ink-900">{title}</h2>
      {action && <Link href={action.href} className="fos-press text-[13px] font-extrabold text-navy-700">{action.label}</Link>}
    </div>
  );
}

function Rail({ title, action, shops, located }: { title: string; action?: { label: string; href: string }; shops: DiscoverShop[]; located: boolean }) {
  return (
    <section>
      <Header title={title} action={action} />
      <div className="fos-no-scrollbar -mx-gutter mt-3 flex snap-x gap-3 overflow-x-auto scroll-px-4 px-gutter pb-2">
        {shops.map((s) => <ShopCard key={s.id} shop={s} located={located} />)}
      </div>
    </section>
  );
}

const TONES: Record<string, string> = {
  navy: "bg-grad-hero text-white",
  gold: "bg-grad-gold text-[#4A3610]",
  night: "bg-[linear-gradient(135deg,#1F1147,#3B2A7A)] text-white",
  jade: "bg-[linear-gradient(135deg,#05603A,#12B76A)] text-white",
};

function CollectionTile({ href, title, tone, shops }: { href: string; title: string; tone: string; shops: DiscoverShop[] }) {
  return (
    <Link href={href} className={`fos-press relative flex h-[104px] flex-col justify-between overflow-hidden rounded-card p-3 shadow-fos-sm ring-1 ring-line ${TONES[tone]}`}>
      <span className="text-[15px] font-extrabold leading-5">{title}</span>
      <span className="flex items-center gap-2">
        <span className="flex -space-x-2">
          {shops.slice(0, 3).map((s) => (
            <span key={s.id} className="grid h-7 w-7 place-items-center overflow-hidden rounded-full border-2 border-white/80 bg-white text-[10px] font-extrabold text-[#103562]">
              {s.logo_url ? <img src={s.logo_url} alt="" className="h-full w-full object-cover" /> : s.name[0]?.toUpperCase()}
            </span>
          ))}
        </span>
        <span className="text-[12px] font-bold opacity-85">{shops.length} shops</span>
      </span>
    </Link>
  );
}
