"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { fetchNearbyShops } from "@/lib/addresses";
import { FREE_DELIVERY_OVER_USD } from "@/lib/currency";
import { useHomeLocation } from "@/lib/useHomeLocation";
import { useAuth } from "@/providers/AuthProvider";
import { useCart } from "@/providers/CartProvider";
import {
  CategoryPhotoIcon, Countdown, EmptyState, FlashCard, HeroCarousel, HomeTopBar, LocationSheet,
  ProductCard, SearchBar, SectionHeader, ShopCard, ShopCardSkeleton, Skeleton,
  type HeroSlide, type ShopCardData,
} from "@/components/shop";
import type { Product, Category, CategoryBanner, Merchant, PromoCode, Notification } from "@/types";

const PAGE_SIZE = 20;

export default function ShopHomePage() {
  const { user } = useAuth();
  const { addToCart } = useCart();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [banners, setBanners] = useState<CategoryBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [copiedPromo, setCopiedPromo] = useState("");
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

  // Shops sorted by distance from the customer's location
  useEffect(() => {
    if (!location) { setNearby(null); return; }
    let cancelled = false;
    setNearbyLoading(true);
    fetchNearbyShops(location.lat, location.lng)
      .then((rows) => {
        if (cancelled) return;
        setNearby(rows.map((s) => ({
          id: s.id, name: s.name, logo_url: s.logo_url, icon_emoji: s.icon_emoji,
          distance_km: s.distance_km, can_deliver: s.can_deliver, delivery_fee: s.delivery_fee,
          is_open: (s as { is_open?: boolean }).is_open,
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
        const bannerData = await api.get<CategoryBanner[]>("/category-banners", { params: { placement: "home" } });
        setBanners(bannerData);
      } catch { /* banners table may not exist yet */ }
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

  function copyPromo(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedPromo(code);
      setTimeout(() => setCopiedPromo(""), 2000);
    });
  }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Error ──
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
      <div className="min-h-screen bg-surface">
        <div className="flex h-14 items-center justify-between px-4"><Skeleton className="h-8 w-40 rounded-md" /><Skeleton className="h-10 w-10 rounded-[14px]" /></div>
        <div className="px-4">
          <Skeleton className="h-12 w-full rounded-thumb" />
          <Skeleton className="mt-3.5 h-[176px] w-full rounded-hero" />
          <div className="mt-[18px] grid grid-cols-4 gap-x-2 gap-y-3.5">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5"><Skeleton className="h-16 w-16 rounded-cat" /><Skeleton className="h-2.5 w-10 rounded" /></div>
            ))}
          </div>
          <Skeleton className="mt-[22px] h-[30px] w-40 rounded-md" />
          <div className="mt-3 flex gap-2.5 overflow-hidden">
            {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[196px] w-[128px] shrink-0 rounded-thumb" />)}
          </div>
          <div className="mt-6 flex gap-2.5 overflow-hidden"><ShopCardSkeleton /></div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[276px] rounded-card" />)}
          </div>
        </div>
      </div>
    );
  }

  const topCategories = [...categories]
    .sort((a, b) => (b.product_count ?? 0) - (a.product_count ?? 0) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .slice(0, 8);

  const explicitlyFeatured = merchants.filter(m => m.is_featured);
  const featuredShops = explicitlyFeatured.length > 0
    ? explicitlyFeatured
    : [...merchants].sort((a, b) => (b.product_count ?? 0) - (a.product_count ?? 0)).slice(0, 3);

  const flashDeals = products.filter(p => p.compare_price && p.compare_price > p.base_price);

  // Hero: admin banners first; the old generated slides are the fallback when none are uploaded
  const withImage = banners.filter(b => b.image_url);
  const heroSlides: HeroSlide[] = withImage.length > 0
    ? withImage.map(b => ({ key: b.id, label: b.subtitle, title: b.title, image: b.image_url, cta: "Shop now", href: `/shop/category/${b.category_id}` }))
    : [
        { key: "new", label: "New arrivals", title: `${products.length}+ products`, cta: "Shop now", onClick: () => scrollTo("for-you") },
        { key: "shops", label: "Featured shops", title: `${featuredShops.length} ${featuredShops.length === 1 ? "shop" : "shops"}`, cta: "Browse", onClick: () => scrollTo("shops-section") },
        promos.length > 0
          ? { key: "promo", label: "Hot deals", title: `${promos.length} promo${promos.length === 1 ? "" : "s"}`, cta: "See promos", onClick: () => scrollTo("promo-strip") }
          : { key: "deals", label: "Hot deals", title: "New every week", cta: "Browse", onClick: () => scrollTo("for-you") },
      ];

  // Shops rail: by distance once there is a location, otherwise the featured shops (no distance known)
  const shopCards: ShopCardData[] = nearby ?? featuredShops.map(m => ({ id: m.id, name: m.name, logo_url: m.logo_url, icon_emoji: m.icon_emoji }));
  const promo = promos[0];

  return (
    <div className="min-h-screen bg-surface font-sans">
      <HomeTopBar area={location?.area ?? null} unread={unreadCount} onLocationClick={() => setSheetOpen(true)} />
      <SearchBar />

      <div className="px-4">
        {/* 3 · Hero */}
        <div className="mt-3.5"><HeroCarousel slides={heroSlides} /></div>

        {/* 4 · Categories */}
        {topCategories.length > 0 && (
          <section className="mt-[18px] grid grid-cols-4 gap-x-2 gap-y-3.5">
            {topCategories.map(c => (
              <CategoryPhotoIcon key={c.id} href={`/shop/category/${c.id}`} label={c.name} imageUrl={c.image_url} emoji={c.icon_emoji} />
            ))}
          </section>
        )}

        {/* 5–6 · Flash deals */}
        {flashDeals.length > 0 && (
          <section className="mt-[22px]">
            <SectionHeader title="⚡ Flash" extra={<Countdown />} href="/shop/search" />
            <div className="fos-no-scrollbar -mx-4 mt-3 flex gap-2.5 overflow-x-auto px-4 pb-1">
              {flashDeals.slice(0, 8).map(p => <FlashCard key={p.id} product={p} />)}
            </div>
          </section>
        )}

        {/* 7 · Shops near you */}
        {(shopCards.length > 0 || nearbyLoading) && (
          <section id="shops-section" className="mt-6 scroll-mt-4">
            <SectionHeader title={location ? "Shops near you" : "Featured shops"} />
            <div className="fos-no-scrollbar -mx-4 mt-3 flex gap-2.5 overflow-x-auto px-4 pb-1">
              {nearbyLoading
                ? [0, 1].map(i => <ShopCardSkeleton key={i} />)
                : shopCards.map(s => <ShopCard key={s.id} shop={s} />)}
            </div>
            {!location && locationResolved && (
              <button type="button" onClick={() => setSheetOpen(true)} className="fos-press mt-2 flex min-h-[44px] items-center gap-2 text-[13px] font-bold text-navy-700">
                📍 Set location to sort by distance
              </button>
            )}
          </section>
        )}

        {/* 8 · Promo strip */}
        <section id="promo-strip" className="mt-6 scroll-mt-4">
          {promo ? (
            <button
              type="button"
              onClick={() => copyPromo(promo.code)}
              className="fos-press flex h-24 w-full items-center gap-3.5 rounded-hero bg-grad-promo px-5 text-left text-white shadow-fos-md"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-thumb bg-white/25 text-2xl">🎟️</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[20px] font-extrabold leading-6">
                  {promo.type === "percent" ? `${promo.value}% off` : `$${promo.value} off`}
                </span>
                <span className="block truncate text-[13px] font-bold opacity-90">
                  {copiedPromo === promo.code ? "Copied!" : promo.code}
                </span>
              </span>
            </button>
          ) : (
            <div className="flex h-24 items-center gap-3.5 rounded-hero bg-grad-promo px-5 text-white shadow-fos-md">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-thumb bg-white/25 text-2xl">🚚</span>
              <span className="text-[20px] font-extrabold leading-6">Free delivery over ${FREE_DELIVERY_OVER_USD}</span>
            </div>
          )}
        </section>

        {/* 9 · For you */}
        <section id="for-you" className="mt-6 scroll-mt-4">
          <SectionHeader title="For you" />
          {products.length === 0 ? (
            <EmptyState title="No products yet" action={{ label: "Browse shops", href: "/shop/categories" }} />
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
