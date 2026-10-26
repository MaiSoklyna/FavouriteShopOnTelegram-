"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { CategoryIcon, EmptyState, Pill, ProductCard, RatingPill, ShopCover, Skeleton } from "@/components/shop";
import { useCart } from "@/providers/CartProvider";
import { useAuth } from "@/providers/AuthProvider";
import { useHomeLocation } from "@/lib/useHomeLocation";
import { classifyShop } from "@/lib/shopTheme";
import { formatEta, formatKm } from "@/lib/mapbox";
import { money } from "@/lib/quote";
import type { Merchant, Product, Category } from "@/types";
import { Icon } from "@/components/shop/Icon";
import { PromoAppliedBanner } from "@/components/shop/PromoAppliedBanner";
import { ShopOffers } from "@/components/shop/ShopOffers";

/** This shop as seen from the customer's location (GET /merchants/nearby). */
interface NearbyInfo {
  id: number;
  distance_km: number;
  is_open: boolean;
  can_deliver: boolean;
  delivery_fee: string | null;
  eta_minutes: number | null;
  eta_max_minutes: number | null;
}

export default function MerchantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { addToCart } = useCart();
  const { user } = useAuth();
  const { location } = useHomeLocation(!!user);

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heroImages, setHeroImages] = useState<{ id: number; url: string }[]>([]);
  const [heroIdx, setHeroIdx] = useState(0);
  const [near, setNear] = useState<NearbyInfo | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const productsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<Merchant>(`/merchants/${id}`),
      api.get<Product[]>("/products", { params: { merchant_id: Number(id), page_size: 60 } }),
      api.get<Category[]>("/categories", { params: { merchant_id: Number(id) } }),
      api.get<{ id: number; url: string }[]>(`/merchants/${id}/hero-images`).catch(() => []),
    ])
      .then(([m, p, c, h]) => {
        if (!alive) return;
        setMerchant(m);
        setProducts(p);
        // Only categories this shop actually sells in
        const used = new Set(p.map((x) => x.category_id));
        setCategories(c.filter((cat) => used.has(cat.id)));
        setHeroImages(h || []);
      })
      .catch((err) => { if (alive) setError(err?.status === 404 ? "Shop not found" : "Could not load shop"); })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [id]);

  // Distance, delivery fee, ETA and open/closed — computed by the backend from the customer's location
  useEffect(() => {
    if (!location || !id) return;
    api.get<NearbyInfo[]>("/merchants/nearby", { params: { lat: location.lat, lng: location.lng, radius_km: 25, limit: 50 } })
      .then((rows) => setNear(rows.find((r) => r.id === Number(id)) ?? null))
      .catch(() => setNear(null));
  }, [location?.lat, location?.lng, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rotate hero photos
  useEffect(() => {
    if (heroImages.length <= 1) return;
    const t = setInterval(() => setHeroIdx((i) => (i + 1) % heroImages.length), 4500);
    return () => clearInterval(t);
  }, [heroImages.length]);

  // Rating = review-weighted average of this shop's products; null = no reviews yet
  const { rating, reviews } = useMemo(() => {
    let sum = 0, n = 0;
    for (const p of products) {
      const c = Number(p.review_count) || 0;
      if (c > 0) { sum += (Number(p.rating_avg) || 0) * c; n += c; }
    }
    return { rating: n ? sum / n : null, reviews: n };
  }, [products]);
  const theme = useMemo(
    () => classifyShop([merchant?.name || "", merchant?.name || "", merchant?.tagline || "", ...products.map((p) => p.name)]),
    [merchant?.name, merchant?.tagline, products],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <Skeleton className="h-[210px] rounded-none" />
        <div className="relative -mt-14 px-gutter">
          <Skeleton className="h-[220px] rounded-hero" />
          <div className="mt-5 grid grid-cols-2 gap-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[230px] rounded-card" />)}</div>
        </div>
      </div>
    );
  }

  if (error || !merchant) {
    return (
      <div className="min-h-screen bg-surface px-gutter pt-10">
        <EmptyState title={error || "Shop unavailable"} action={{ label: "Back to Home", href: "/shop" }} />
        <p className="text-center text-caption text-ink-500">This shop doesn&apos;t exist or is no longer active.</p>
      </div>
    );
  }

  const visible = activeCategory === "all" ? products : products.filter((p) => p.category_id === activeCategory);
  const productCount = products.length || merchant.product_count || 0;
  const fee = near?.delivery_fee != null ? Number(near.delivery_fee) : null;
  const hasPin = merchant.latitude != null && merchant.longitude != null;

  return (
    <div className="min-h-screen bg-surface pb-8">
      <PromoAppliedBanner merchantId={merchant.id} />
      {/* Cover */}
      <div className="relative h-[210px] overflow-hidden bg-tint-map">
        {heroImages.length > 0 ? (
          <div className="flex h-full transition-transform duration-500" style={{ width: `${heroImages.length * 100}%`, transform: `translateX(-${heroIdx * (100 / heroImages.length)}%)` }}>
            {heroImages.map((img) => (
              <img key={img.id} src={img.url} alt="" className="h-full object-cover" style={{ width: `${100 / heroImages.length}%` }} />
            ))}
          </div>
        ) : (
          <ShopCover theme={theme} />
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(8,29,60,.45)_0%,rgba(8,29,60,0)_40%)]" />
        <button type="button" onClick={() => router.back()} aria-label="Back"
          className="fos-press absolute left-gutter top-[max(14px,env(safe-area-inset-top))] grid h-10 w-10 place-items-center rounded-full bg-black/35 text-white backdrop-blur">
          <Icon name="back" size={20} strokeWidth={2} />
        </button>
        {heroImages.length > 1 && (
          <div className="absolute bottom-16 left-1/2 flex -translate-x-1/2 gap-1.5">
            {heroImages.map((_, i) => (
              <button key={i} type="button" onClick={() => setHeroIdx(i)} aria-label={`Photo ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${i === heroIdx ? "w-[18px] bg-white" : "w-1.5 bg-white/50"}`} />
            ))}
          </div>
        )}
      </div>

      {/* Identity card */}
      <section className="relative mx-gutter -mt-12 rounded-hero bg-card px-4 pb-4 shadow-fos-md">
        <div className="flex items-end gap-3">
          <span className="-mt-9 grid h-[76px] w-[76px] shrink-0 place-items-center overflow-hidden rounded-[22px] border-4 border-card bg-card shadow-fos-md">
            {merchant.logo_url
              ? <img src={merchant.logo_url} alt="" className="h-full w-full object-cover" />
              : <CategoryIcon icon={merchant.icon_emoji} size={34} fallback="shop" alt={merchant.name} />}
          </span>
          <div className="flex flex-1 justify-end gap-2 pt-3">
            {merchant.phone && <IconLink href={`tel:${merchant.phone}`} label={`Call ${merchant.name}`} icon="phone" />}
            {hasPin && (
              <IconLink href={`https://www.google.com/maps/dir/?api=1&destination=${merchant.latitude},${merchant.longitude}`} label="Directions" icon="map" external />
            )}
            {merchant.fb_page && <IconLink href={merchant.fb_page} label="Facebook" text="f" external />}
            {merchant.instagram && <IconLink href={merchant.instagram} label="Instagram" text="IG" external />}
          </div>
        </div>

        <p className="mt-3 text-[11px] font-extrabold uppercase tracking-wide text-tone-mango">Shop</p>
        <h1 className="text-[24px] font-extrabold leading-7 text-ink-900">{merchant.name}</h1>
        {merchant.tagline && <p className="mt-1 text-[13px] text-ink-500">{merchant.tagline}</p>}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {rating != null ? <RatingPill rating={rating} /> : <Pill variant="neutral"><Icon name="star" size={12} />New shop</Pill>}
          {near && (near.is_open ? <Pill variant="jade">Open now</Pill> : <Pill variant="neutral" className="!text-ruby-500">Closed</Pill>)}
          {near && <Pill variant="neutral"><Icon name="pin" size={12} />{formatKm(near.distance_km)}{near.eta_minutes != null && near.eta_max_minutes != null ? ` · ${formatEta(near.eta_minutes, near.eta_max_minutes)}` : ""}</Pill>}
          {near && (near.can_deliver
            ? <Pill variant={fee === 0 ? "jade" : "neutral"}><Icon name="truck" size={12} />{fee === 0 ? "Free delivery" : fee != null ? `${money(fee)} delivery` : "Delivers"}</Pill>
            : <Pill variant="mango">Pickup only</Pill>)}
        </div>

        <div className="mt-4 grid grid-cols-3 divide-x divide-line rounded-thumb bg-surface py-3 text-center">
          <Stat value={productCount} label="Products" />
          <Stat value={merchant.order_count ?? 0} label="Orders" />
          <Stat value={rating != null ? rating.toFixed(1) : "—"} label={reviews ? `${reviews} review${reviews === 1 ? "" : "s"}` : "Rating"} />
        </div>

        {merchant.address && (
          <p className="mt-3 flex items-start gap-1.5 text-caption text-ink-500">
            <Icon name="pin" size={14} className="mt-px" /><span className="line-clamp-2">{merchant.address}</span>
          </p>
        )}
        {merchant.description && (
          <button type="button" onClick={() => setAboutOpen((o) => !o)} className="mt-2 block w-full text-left">
            <span className={`block text-[13px] leading-5 text-ink-900 ${aboutOpen ? "" : "line-clamp-2"}`}>{merchant.description}</span>
            <span className="text-[12px] font-extrabold text-navy-700">{aboutOpen ? "Show less" : "More about this shop"}</span>
          </button>
        )}
      </section>

      <ShopOffers merchantId={merchant.id} />

      {/* This shop's products */}
      <div ref={productsRef} className="sticky top-0 z-10 mt-5 bg-surface/95 pb-2 pt-3 backdrop-blur">
        <div className="flex items-baseline justify-between px-gutter">
          <h2 className="truncate text-section text-ink-900">Products from {merchant.name}</h2>
          <span className="shrink-0 pl-2 text-caption text-ink-500">{visible.length}</span>
        </div>
        {categories.length > 0 && (
          <div className="fos-no-scrollbar mt-2.5 flex gap-2 overflow-x-auto px-gutter" role="tablist" aria-label="Filter this shop's products">
            <Chip on={activeCategory === "all"} onClick={() => setActiveCategory("all")}>All</Chip>
            {categories.map((cat) => (
              <Chip key={cat.id} on={activeCategory === cat.id} onClick={() => { setActiveCategory(cat.id); productsRef.current?.scrollIntoView({ behavior: "smooth" }); }}>
                <CategoryIcon icon={cat.icon_emoji} size={14} alt="" />{cat.name}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="px-gutter pt-2">
        {visible.length === 0 ? (
          <div className="py-12 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-card text-ink-500 shadow-fos-sm"><Icon name="bag" size={26} /></span>
            <p className="mt-3 text-[14px] font-extrabold text-ink-900">No products here yet</p>
            <p className="text-caption text-ink-500">{merchant.name} hasn&apos;t added any in this section</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {visible.map((p) => <ProductCard key={p.id} product={p} onAddToCart={addToCart} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="px-1">
      <div className="text-[18px] font-extrabold tabular-nums leading-6 text-ink-900">{value}</div>
      <div className="truncate text-[11px] font-semibold text-ink-500">{label}</div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={on} onClick={onClick}
      className={`fos-press inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-extrabold ${on ? "bg-navy-700 text-white" : "bg-card text-ink-900 shadow-fos-sm"}`}>
      {children}
    </button>
  );
}

function IconLink({ href, label, icon, text, external }: { href: string; label: string; icon?: "phone" | "map"; text?: string; external?: boolean }) {
  return (
    <a href={href} aria-label={label} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="fos-press grid h-10 w-10 place-items-center rounded-full bg-surface text-[12px] font-black text-navy-700">
      {icon ? <Icon name={icon} size={18} /> : text}
    </a>
  );
}
