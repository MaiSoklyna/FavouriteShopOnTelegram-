"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { fetchNearbyShops } from "@/lib/addresses";
import { useHomeLocation } from "@/lib/useHomeLocation";
import { SHOP_FILTERS, applyShopFilter, useShopExtras, type ShopFilter } from "@/lib/shopTheme";
import { codeCard, promotionCard, type Promotion, type PromotionRow } from "@/lib/promotions";
import { useAuth } from "@/providers/AuthProvider";
import { useCart } from "@/providers/CartProvider";
import {
  CategoryPhotoIcon, Countdown, EmptyState, FlashCard, HomeTopBar, LocationSheet,
  ProductCard, PromotionCard, PromotionCardSkeleton, SearchBar, SectionHeader, ShopCard, ShopCardSkeleton, Skeleton,
  type ShopCardData,
} from "@/components/shop";
import type { Product, Category, Merchant, PromoCode, Notification } from "@/types";
import { Icon } from "@/components/shop/Icon";

const PAGE_SIZE = 20;

export default function ShopHomePage() {
  const { user } = useAuth();
  const { addToCart } = useCart();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [promos, setPromos] = useState<PromoCode[]>([]);
  /** Live promotions (banner + offer); empty until migration 018 is applied */
  const [promoRows, setPromoRows] = useState<PromotionRow[]>([]);
  /** Home's category icons, chosen and scheduled in admin (4–8); null until loaded or if that fails */
  const [homeCategories, setHomeCategories] = useState<Category[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  /** Shop deal banners: each promo shop's own hero photo */
  const [promoImages, setPromoImages] = useState<Record<number, string>>({});
  const [unreadCount, setUnreadCount] = useState(0);

  // For-you infinite scroll
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageRef = useRef(1);
  const sentinel = useRef<HTMLDivElement>(null);

  // Location → "Shops near you"
  const signedIn = !!user && "telegram_id" in (user as object);
  const { location, resolved: locationResolved, save: saveLocation } = useHomeLocation(signedIn);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [nearby, setNearby] = useState<ShopCardData[] | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [shopFilter, setShopFilter] = useState<ShopFilter>("All");

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (!user) { setUnreadCount(0); return; }
    let cancelled = false;
    async function loadUnread() {
      try {
        const list = await api.get<Notification[]>("/notifications");
        if (!cancelled) setUnreadCount(list.filter(n => !n.is_read).length);
      } catch { /* not logged in or endpoint unavailable */ }
    }
    loadUnread();
    const id = setInterval(loadUnread, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    Array.from(new Set(promos.map((p) => p.merchant_id))).forEach((id) => {
      api.get<{ url: string }[]>(`/merchants/${id}/hero-images`)
        .then((imgs) => { if (!cancelled && imgs[0]?.url) setPromoImages((cur) => ({ ...cur, [id]: imgs[0].url })); })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, [promos]);

  // Shops sorted by distance from the customer's location
  useEffect(() => {
    if (!location) { setNearby(null); return; }
    let cancelled = false;
    setNearbyLoading(true);
    fetchNearbyShops(location.lat, location.lng)
      .then((rows) => {
        if (cancelled) return;
        // A shop's own hero photo makes the best cover; shops without one keep the generated cover
        rows.forEach((s) => {
          api.get<{ url: string }[]>(`/merchants/${s.id}/hero-images`)
            .then((imgs) => { if (!cancelled && imgs[0]?.url) setNearby((cur) => cur && cur.map((c) => (c.id === s.id ? { ...c, cover_url: imgs[0].url } : c))); })
            .catch(() => {});
        });
        setNearby(rows.map((s) => ({
          id: s.id, name: s.name, tagline: s.tagline, logo_url: s.logo_url, icon_emoji: s.icon_emoji,
          distance_km: s.distance_km, can_deliver: s.can_deliver, delivery_fee: s.delivery_fee,
          eta_minutes: s.eta_minutes, eta_max_minutes: s.eta_max_minutes, is_open: s.is_open,
        })));
      })
      .catch(() => { if (!cancelled) setNearby(null); })
      .finally(() => { if (!cancelled) setNearbyLoading(false); });
    return () => { cancelled = true; };
  }, [location?.lat, location?.lng]);

  async function fetchData() {
    setLoadError(false);
    try {
      const [m, c, p] = await Promise.all([
        api.get<Merchant[]>("/merchants"),
        api.get<Category[]>("/categories"),
        api.get<Product[]>("/products", { params: { page_size: PAGE_SIZE } }),
      ]);
      setMerchants(m);
      setCategories(c);
      setProducts(p);
      pageRef.current = 1;
      setHasMore(p.length >= PAGE_SIZE);
      try {
        const promoData = await api.get<PromoCode[]>("/promos/active");
        setPromos(promoData);
      } catch { /* promos endpoint may not exist yet */ }
      try {
        setPromoRows(await api.get<PromotionRow[]>("/promotions"));
      } catch { /* promotions table not created yet (migration 018) */ }
      try {
        setHomeCategories(await api.get<Category[]>("/featured-categories/home"));
      } catch { /* Home falls back to the categories with the most products */ }
    } catch (err) {
      console.error("Load error:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const rows = await api.get<Product[]>("/products", { params: { page_size: PAGE_SIZE, page: next } });
      pageRef.current = next;
      setProducts((cur) => {
        const seen = new Set(cur.map((p) => p.id));
        return [...cur, ...rows.filter((p) => !seen.has(p.id))];
      });
      setHasMore(rows.length >= PAGE_SIZE);
    } catch {
      setHasMore(false); // stop retrying on a failing endpoint; pull-to-refresh resets it
    }
    setLoadingMore(false);
  }, [loadingMore, hasMore]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || loading) return;
    const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) loadMore(); }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, loading, products.length]);


  // ── Error ──
  const explicitlyFeatured = merchants.filter(m => m.is_featured);
  const featuredShops = explicitlyFeatured.length > 0
    ? explicitlyFeatured
    : [...merchants].sort((a, b) => (b.product_count ?? 0) - (a.product_count ?? 0)).slice(0, 3);

  // Shops rail: with a location, only shops we can show distance, time and fee for (nearest first);
  // without one, the featured shops and a prompt to set it.
  const baseCards: ShopCardData[] = nearby
    ?? featuredShops.map(m => ({ id: m.id, name: m.name, tagline: m.tagline, logo_url: m.logo_url, icon_emoji: m.icon_emoji }));
  // Before the early returns below: hooks must run on every render
  const extras = useShopExtras(baseCards);

  if (loadError && !loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface px-6">
        <EmptyState title="Can't reach the shop" action={{ label: "Retry", onClick: () => { setLoading(true); fetchData(); } }} />
      </div>
    );
  }

  // ── Loading: skeletons matching each block's size ──
  if (loading) {
    return (
      <div className="fos-on-navy min-h-screen">
        <div className="flex h-14 items-center justify-between px-4"><Skeleton className="h-8 w-40 rounded-md" /><Skeleton className="h-10 w-10 rounded-[14px]" /></div>
        <div className="px-4">
          <Skeleton className="h-12 w-full rounded-thumb" />
          <div className="mt-[18px] grid grid-cols-4 gap-x-2 gap-y-3.5">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5"><Skeleton className="h-16 w-16 rounded-cat" /><Skeleton className="h-2.5 w-10 rounded" /></div>
            ))}
          </div>
          <Skeleton className="mt-6 h-[26px] w-36 rounded-md" />
          <div className="mt-3 flex gap-3 overflow-hidden">
            {Array.from({ length: 2 }, (_, i) => <PromotionCardSkeleton key={i} />)}
          </div>
          <div className="mt-6 flex gap-2.5 overflow-hidden"><ShopCardSkeleton /></div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[276px] rounded-card" />)}
          </div>
        </div>
      </div>
    );
  }

  // Featured categories from admin (live schedule, priority order); the most-stocked ones if that call failed
  const topCategories = homeCategories ?? [...categories]
    .sort((a, b) => (b.product_count ?? 0) - (a.product_count ?? 0) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .slice(0, 8);

  const flashDeals = products.filter(p => p.compare_price && p.compare_price > p.base_price);


  const enriched = baseCards.map(c => ({ ...c, theme: extras[c.id]?.theme, rating: extras[c.id]?.rating ?? null }));
  const shopCards = nearby ? applyShopFilter(enriched, shopFilter) : enriched;
  // One Promotions section: every live promotion shown on Home (banner or generated card),
  // then any plain shop code not yet turned into a promotion (before migration 021), ending soonest first.
  const shopOf = (id: number) => merchants.find(m => m.id === id);
  const onHome = promoRows.filter(r => (r.display_locations ?? []).some(l => l === "home_promotions" || l === "home_featured"));
  // A code that belongs to a promotion is shown once, as that promotion
  const promotedCodes = new Set(promoRows.flatMap(r => (r.offer ? [`${r.merchant_id}:${r.offer.code}`] : [])));
  const promotions: Promotion[] = [
    ...onHome.map(promotionCard),
    ...[...promos]
      .filter(p => !promotedCodes.has(`${p.merchant_id}:${p.code}`))
      .sort((a, b) => (a.expires_at ? Date.parse(a.expires_at) : Infinity) - (b.expires_at ? Date.parse(b.expires_at) : Infinity))
      .map(p => {
        const m = shopOf(p.merchant_id);
        return codeCard(p, m ? { name: m.name, image: promoImages[p.merchant_id], logo: m.logo_url, emoji: m.icon_emoji, color: m.accent_color } : undefined);
      })
      .filter((p): p is Promotion => p !== null),
  ];

  return (
    <div className="fos-on-navy min-h-screen font-sans">
      <HomeTopBar area={location?.area ?? null} unread={unreadCount} onLocationClick={() => setSheetOpen(true)}
        name={user && "first_name" in user ? (user as { first_name?: string }).first_name : null} />
      <SearchBar />

      <div className="px-4">

        {/* 4 · Categories */}
        {topCategories.length > 0 && (
          <section className="mt-[18px] grid grid-cols-4 gap-x-2 gap-y-3.5">
            {topCategories.map(c => (
              <CategoryPhotoIcon key={c.id} href={`/shop/category/${c.id}`} label={c.name} imageUrl={c.image_url} emoji={c.icon_emoji} />
            ))}
          </section>
        )}

        {/* Promotions: the one place for offers and banners, below Categories */}
        {promotions.length > 0 && (
          <section id="promotions" className="mt-6 scroll-mt-4">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[20px] font-extrabold leading-[26px] tracking-[-0.01em] text-ink-900">Promotions</h2>
              <span className="text-caption text-ink-500">{promotions.length}</span>
            </div>
            <div className="fos-no-scrollbar -mx-4 mt-3 flex snap-x items-start gap-3 overflow-x-auto scroll-px-4 px-4 pb-2">
              {promotions.map(p => <PromotionCard key={p.id} promo={p} />)}
            </div>
          </section>
        )}

        {/* Shops near you (Option A): cards first, the map is one tap away */}
        {(baseCards.length > 0 || nearbyLoading || location) && (
          <section id="shops-section" className="mt-6 scroll-mt-4">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-[20px] font-extrabold leading-[26px] tracking-[-0.01em] text-ink-900">{location ? "Shops near you" : "Featured shops"}</h2>
                {!location && <p className="truncate text-[13px] font-semibold text-ink-500">Set your location to see delivery fees</p>}
              </div>
              {location ? (
                <Link href="/shop/nearby" className="fos-press flex min-h-[44px] shrink-0 items-center gap-1 text-[13px] font-extrabold text-navy-700">
                  <Icon name="map" size={16} strokeWidth={2.2} />See map
                </Link>
              ) : locationResolved && (
                <button type="button" onClick={() => setSheetOpen(true)} className="fos-press flex min-h-[44px] shrink-0 items-center gap-1 text-[13px] font-extrabold text-navy-700">
                  <Icon name="pin" size={16} strokeWidth={2.2} />Set location
                </button>
              )}
            </div>

            {location && (nearby?.length ?? 0) > 0 && (
              <div className="fos-no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label="Filter shops">
                {SHOP_FILTERS.map(f => (
                  <button key={f} type="button" role="radio" aria-checked={shopFilter === f} onClick={() => setShopFilter(f)}
                    className={`fos-press h-9 shrink-0 rounded-full px-3.5 text-[13px] font-extrabold ${shopFilter === f ? "bg-gold-400 text-navy-900" : "border-[1.5px] border-line bg-card text-ink-900"}`}>
                    {f}
                  </button>
                ))}
              </div>
            )}

            <div className="fos-no-scrollbar -mx-4 mt-3.5 flex snap-x gap-3 overflow-x-auto scroll-px-4 px-4 pb-2">
              {nearbyLoading
                ? [0, 1].map(i => <ShopCardSkeleton key={i} />)
                : shopCards.map(s => <ShopCard key={s.id} shop={s} />)}
              {!nearbyLoading && location && nearby && shopCards.length === 0 && (
                <div className="flex h-[120px] w-full flex-col items-center justify-center gap-1 rounded-hero bg-card text-center shadow-fos-sm">
                  <p className="text-[14px] font-extrabold text-ink-900">{nearby.length ? "No shops match this filter" : "No shops nearby yet"}</p>
                  <button type="button" onClick={() => (nearby.length ? setShopFilter("All") : setSheetOpen(true))} className="fos-press min-h-[36px] text-[13px] font-bold text-navy-500">
                    {nearby.length ? "Show all shops" : "Try another location"}
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {/* 5–6 · Flash deals */}
        {flashDeals.length > 0 && (
          <section className="mt-[22px]">
            <SectionHeader title={<span className="flex items-center gap-1"><Icon name="bolt" size={18} filled className="text-gold-400" />Flash</span>} extra={<Countdown />} href="/shop/search" />
            <div className="fos-no-scrollbar -mx-4 mt-3 flex gap-2.5 overflow-x-auto px-4 pb-1">
              {flashDeals.slice(0, 8).map(p => <FlashCard key={p.id} product={p} />)}
            </div>
          </section>
        )}

        {/* 9 · For you */}
        <section id="for-you" className="mt-6 scroll-mt-4">
          <SectionHeader title="For you" />
          {products.length === 0 ? (
            <EmptyState title="No products yet" action={{ label: "Browse shops", href: "/shop/discover" }} />
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {products.map(p => (
                  <ProductCard key={p.id} product={p} onAddToCart={async (id) => { await addToCart(id); }} />
                ))}
                {loadingMore && [0, 1].map(i => <Skeleton key={`sk${i}`} className="h-[276px] rounded-card" />)}
              </div>
              {hasMore && <div ref={sentinel} className="h-px" />}
            </>
          )}
        </section>
      </div>

      {sheetOpen && (
        <LocationSheet
          current={location}
          onClose={() => setSheetOpen(false)}
          onConfirm={(loc) => { saveLocation(loc); setSheetOpen(false); }}
        />
      )}
    </div>
  );
}
