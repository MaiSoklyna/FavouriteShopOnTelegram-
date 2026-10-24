"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useCart } from "@/providers/CartProvider";
import { useAuth } from "@/providers/AuthProvider";
import { EmptyState, Pill, ProductCard, Skeleton } from "@/components/shop";
import { formatKhr, formatUsd } from "@/lib/currency";
import { lightHaptic } from "@/lib/haptics";
import { useHomeLocation } from "@/lib/useHomeLocation";
import { useWishlist } from "@/lib/useWishlist";
import { distanceKm, formatEta, formatKm } from "@/lib/mapbox";
import type { Merchant, Product, VariantGroup } from "@/types";
import { Icon } from "@/components/shop/Icon";

interface Review { id: number; user_name?: string; rating: number; comment?: string; created_at?: string }

const ICON = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

// Mirrors backend constants (ETA_PREP_MINUTES, ETA_MINUTES_PER_KM, ETA_WINDOW_MINUTES,
// DEFAULT_DELIVERY_RADIUS_KM) so the tile matches what checkout will quote.
const ETA_PREP = 10, ETA_PER_KM = 3, ETA_WINDOW = 10, DEFAULT_RADIUS_KM = 5;

export default function ProductDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { addToCart, count } = useCart();
  const wish = useWishlist();
  const { location } = useHomeLocation(!!user);

  const [product, setProduct] = useState<Product | null>(null);
  const [shop, setShop] = useState<Merchant | null>(null);
  const [more, setMore] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [imgIdx, setImgIdx] = useState(0);
  const [popKey, setPopKey] = useState(0);
  // variant_id -> option_id
  const [selectedOptions, setSelectedOptions] = useState<Record<number, number>>({});
  // Set when the shopper tries to add without picking every option; marks the missing pickers in red.
  const [showMissing, setShowMissing] = useState(false);
  const galleryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setSelectedOptions({});
    setShowMissing(false);
    setQty(1);
    setImgIdx(0);
    galleryRef.current?.scrollTo({ left: 0 });
    api.get<Product>(`/products/${id}`)
      .then(setProduct)
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));
  }, [id]);

  // Shop strip + "More from this shop"
  useEffect(() => {
    if (!product) return;
    api.get<Merchant>(`/merchants/${product.merchant_id}`).then(setShop).catch(() => setShop(null));
    api.get<Product[]>("/products", { params: { merchant_id: product.merchant_id, page_size: 12 } })
      .then((rows) => setMore(rows.filter((p) => p.id !== product.id)))
      .catch(() => setMore([]));
  }, [product]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  if (loading) return <LoadingPage />;
  if (!product) {
    return (
      <div className="min-h-screen bg-surface px-gutter pt-16">
        <EmptyState title="Product not found" action={{ label: "Go back", onClick: () => router.back() }} />
      </div>
    );
  }

  const images = (product.images || []).map((img) => (typeof img === "string" ? img : img.url)).filter(Boolean) as string[];
  if (!images.length && product.primary_image) images.push(product.primary_image);
  const variantGroups = product.variants || [];
  const priceAdjust = variantGroups.reduce((sum, g) => sum + (g.options.find((o) => o.id === selectedOptions[g.id])?.price_adjust || 0), 0);
  const price = Number(product.base_price) + Number(priceAdjust);
  const comparePrice = Number(product.compare_price) || 0;
  const discountPct = comparePrice > price ? Math.round(((comparePrice - price) / comparePrice) * 100) : 0;
  const allVariantsChosen = variantGroups.every((g) => selectedOptions[g.id]);
  // With every option chosen, stock is the lowest chosen option's stock; otherwise product-level
  const stock = variantGroups.length > 0 && allVariantsChosen
    ? Math.min(...variantGroups.map((g) => g.options.find((o) => o.id === selectedOptions[g.id])?.stock_adjust ?? Infinity))
    : Number(product.stock);
  const inStock = stock > 0;
  const hearted = wish.has(product.id);

  // Distance from the customer's location to the shop pin (straight line, like the backend)
  const shopPin = shop?.latitude != null && shop?.longitude != null ? { lat: Number(shop.latitude), lng: Number(shop.longitude) } : null;
  const km = location && shopPin ? distanceKm(location, shopPin) : null;
  const radius = Number(shop?.delivery_radius_km) || DEFAULT_RADIUS_KM;
  const delivers = km == null || km <= radius;
  const etaMin = km != null ? Math.round(ETA_PREP + ETA_PER_KM * km) : null;

  async function handleAddToCart(): Promise<boolean> {
    if (!product) return false;
    if (!user) { setNotice({ text: "Open the shop from Telegram to add items", tone: "error" }); return false; }
    const missing = variantGroups.filter((g) => !selectedOptions[g.id]);
    if (missing.length) {
      setShowMissing(true);
      setNotice({ text: `Please choose ${missing.map((g) => g.group_name.toLowerCase()).join(" & ")} to add to cart`, tone: "error" });
      document.getElementById(`variant-${missing[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    const variantsPayload = variantGroups.map((g) => {
      const optId = selectedOptions[g.id];
      const opt = g.options.find((o) => o.id === optId)!;
      return { variant_id: g.id, option_id: optId, group_name: g.group_name, label: opt.label };
    });
    setAdding(true);
    try {
      await addToCart(product.id, qty, variantsPayload);
      lightHaptic();
      setAdded(true);
      setNotice({ text: "Added to cart", tone: "ok" });
      return true;
    } catch (e) {
      setNotice({ text: (e instanceof Error && e.message) || "Could not add to cart", tone: "error" });
      return false;
    } finally {
      setAdding(false);
    }
  }

  function share() {
    const url = window.location.href;
    if (navigator.share) navigator.share({ title: product!.name, url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => setNotice({ text: "Link copied", tone: "ok" })).catch(() => {});
  }

  function onGalleryScroll() {
    const el = galleryRef.current;
    if (el) setImgIdx(Math.round(el.scrollLeft / el.clientWidth));
  }

  function goToImage(i: number) {
    const el = galleryRef.current;
    el?.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  const pick = (groupId: number, optionId: number) => {
    lightHaptic();
    setAdded(false);
    setSelectedOptions((s) => ({ ...s, [groupId]: optionId }));
  };

  return (
    <div className="min-h-screen bg-white pb-[120px]">
      {/* Gallery */}
      <div className="relative h-[420px] bg-surface">
        <div ref={galleryRef} onScroll={onGalleryScroll} className="fos-no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto">
          {images.length > 0 ? images.map((src, i) => (
            <img key={src + i} src={src} alt={i === 0 ? product.name : ""} loading={i === 0 ? "eager" : "lazy"}
              className="h-full w-full shrink-0 snap-center object-cover" />
          )) : (
            <div className="grid h-full w-full place-items-center text-[72px] font-extrabold text-ink-500">
              {product.icon_emoji || product.name[0]?.toUpperCase()}
            </div>
          )}
        </div>

        {!inStock && (
          <div className="absolute inset-0 grid place-items-center bg-navy-900/45">
            <Pill variant="neutral" className="h-8 px-4 text-[13px]">Out of stock</Pill>
          </div>
        )}

        <div className="absolute inset-x-gutter top-12 flex justify-between">
          <GlassButton label="Back" onClick={() => router.back()}>
            <svg width="20" height="20" viewBox="0 0 24 24" {...ICON} strokeWidth={2} aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
          </GlassButton>
          <div className="flex gap-2">
            <GlassButton label={hearted ? "Remove from wishlist" : "Add to wishlist"} onClick={() => { lightHaptic(); wish.toggle(product.id); setPopKey((k) => k + 1); }}>
              <svg key={popKey} className={popKey ? "fos-pop" : ""} width="18" height="18" viewBox="0 0 24 24" fill={hearted ? "#E5484D" : "none"} stroke={hearted ? "#E5484D" : "currentColor"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
              </svg>
            </GlassButton>
            <GlassButton label="Share" onClick={share}>
              <svg width="18" height="18" viewBox="0 0 24 24" {...ICON} strokeWidth={2} aria-hidden><path d="M4 12v8h16v-8M12 3v13M7 8l5-5 5 5" /></svg>
            </GlassButton>
          </div>
        </div>

        {images.length > 1 && (
          <div className="absolute bottom-10 left-gutter flex gap-1.5">
            {images.slice(0, 4).map((src, i) => {
              const extra = i === 3 && images.length > 4 ? images.length - 3 : 0;
              return (
                <button key={src + i} type="button" onClick={() => goToImage(i)} aria-label={`Photo ${i + 1}`}
                  className={`fos-press relative h-11 w-11 overflow-hidden rounded-md border-2 ${imgIdx === i ? "border-white shadow-fos-md" : "border-transparent opacity-80"}`}>
                  <img src={src} alt="" className="h-full w-full object-cover" />
                  {extra > 0 && <span className="absolute inset-0 grid place-items-center bg-navy-900/60 text-[13px] font-extrabold text-white">+{extra}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Info sheet */}
      <div className="relative -mt-5 rounded-t-sheet bg-white px-gutter pt-[18px]">
        <div className="flex items-center gap-2 tabular-nums">
          <span className="text-[30px] font-extrabold leading-9 text-ink-900">{formatUsd(price)}</span>
          {discountPct > 0 && <span className="text-[14px] font-medium text-ink-500 line-through">{formatUsd(comparePrice)}</span>}
          {discountPct > 0 && <Pill variant="solid-mango">−{discountPct}%</Pill>}
        </div>
        <div className="text-caption text-ink-500">{formatKhr(price)}</div>
        <h1 className="mt-2 line-clamp-2 text-[17px] font-extrabold leading-6 text-ink-900">{product.name}</h1>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {(product.review_count ?? 0) > 0
            ? <Pill variant="gold"><Icon name="star" size={12} filled />{Number(product.rating_avg || 0).toFixed(1)} · {product.review_count}</Pill>
            : <Pill variant="neutral"><Icon name="star" size={12} />New</Pill>}
          {inStock
            ? <Pill variant="jade">{stock <= 5 ? `Only ${stock} left` : "In stock"}</Pill>
            : <Pill variant="mango">Out of stock</Pill>}
          {product.category_name && <Pill variant="neutral">{product.category_name}</Pill>}
        </div>

        {variantGroups.map((g) => (
          <VariantPicker key={g.id} group={g} selected={selectedOptions[g.id]} missing={showMissing && !selectedOptions[g.id]} onPick={(opt) => pick(g.id, opt)} />
        ))}

        {/* Shop strip */}
        <Link href={`/shop/merchant/${product.merchant_id}`} className="fos-press mt-4 flex h-[60px] items-center gap-3 rounded-[18px] bg-surface px-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md bg-white text-[18px]">
            {shop?.logo_url || product.merchant_logo_url
              ? <img src={(shop?.logo_url || product.merchant_logo_url)!} alt="" className="h-full w-full object-cover" />
              : shop?.icon_emoji || product.merchant_icon || <span className="text-[15px] font-extrabold text-navy-700">{(product.merchant_name || "S")[0]}</span>}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-extrabold text-ink-900">{shop?.name || product.merchant_name || "Shop"}</div>
            <div className="mt-0.5 flex gap-1.5">
              {km != null && <Pill variant="neutral" className="h-5">{formatKm(km)}</Pill>}
              {shop?.product_count ? <Pill variant="neutral" className="h-5">{shop.product_count} items</Pill> : null}
            </div>
          </div>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white text-ink-900 shadow-fos-sm" aria-hidden>→</span>
        </Link>

        {/* Trust tiles */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <TrustTile tone={delivers ? "default" : "warn"} icon={<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7M7 18a2 2 0 1 0 0 .01M17 18a2 2 0 1 0 0 .01" />}>
            {!delivers ? "Pickup only" : etaMin != null ? formatEta(etaMin, etaMin + ETA_WINDOW) : "Local delivery"}
          </TrustTile>
          <TrustTile icon={<><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>}>KHQR safe</TrustTile>
          <TrustTile icon={<><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20M6 15h4" /></>}>Cash on delivery</TrustTile>
        </div>

        {product.description && <Description text={product.description} />}

        <Reviews productId={product.id} signedIn={!!user} />

        {more.length > 0 && (
          <section className="mt-6">
            <h2 className="text-section text-ink-900">More from this shop</h2>
            <div className="fos-no-scrollbar -mx-gutter mt-3 flex gap-2.5 overflow-x-auto px-gutter pb-2">
              {more.map((p) => (
                <div key={p.id} className="w-[148px] shrink-0">
                  <ProductCard product={p} onAddToCart={async (pid) => { await addToCart(pid); }} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Toast */}
      {notice && (
        <div role="status" className={`fos-pop fixed left-4 right-4 z-[120] mx-auto flex max-w-sm items-center gap-2 rounded-card px-4 py-3 text-[13px] font-bold text-white shadow-fos-lg ${notice.tone === "ok" ? "bg-navy-700" : "bg-ruby-500"}`}
          style={{ bottom: "calc(84px + env(safe-area-inset-bottom, 0px))" }}>
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" {...ICON} strokeWidth={2.2} aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            {notice.tone === "ok" ? <path d="m8 12.5 2.5 2.5L16 9.5" /> : <path d="M12 7.5v5M12 16h.01" />}
          </svg>
          <span>{notice.text}</span>
        </div>
      )}

      {/* Sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-[90] border-t border-line bg-white/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="mx-auto flex max-w-[640px] items-center gap-2.5 px-gutter py-[21px]">
          {inStock ? (
            <>
              <div className="flex h-[52px] w-[100px] shrink-0 items-center justify-between rounded-thumb bg-surface">
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="Decrease"
                  className="fos-press grid h-[52px] w-9 place-items-center text-[20px] font-bold text-ink-900 disabled:text-line">−</button>
                <span className="text-[16px] font-extrabold tabular-nums text-ink-900">{qty}</span>
                <button type="button" onClick={() => setQty((q) => Math.min(stock, q + 1))} disabled={qty >= stock} aria-label="Increase"
                  className="fos-press grid h-[52px] w-9 place-items-center text-[20px] font-bold text-navy-700 disabled:text-line">+</button>
              </div>
              {added ? (
                <Link href="/shop/cart" className="fos-press flex h-[52px] flex-1 items-center justify-center gap-2 rounded-thumb bg-jade-500 text-[15px] font-bold text-white">
                  <Icon name="check" size={18} strokeWidth={2.6} />View cart{count ? ` · ${count}` : ""}
                </Link>
              ) : (
                <button type="button" onClick={handleAddToCart} disabled={adding}
                  className={`fos-press h-[52px] flex-1 rounded-thumb text-[15px] font-bold text-white shadow-fos-cta disabled:opacity-60 ${allVariantsChosen ? "bg-grad-cta" : "bg-navy-500"}`}>
                  {adding ? "Adding…" : allVariantsChosen ? `Add to cart · ${formatUsd(price * qty)}` : "Choose options"}
                </button>
              )}
            </>
          ) : (
            <button type="button" onClick={() => router.push(`/shop/merchant/${product.merchant_id}`)}
              className="fos-press h-[52px] flex-1 rounded-thumb bg-surface text-[15px] font-bold text-ink-900">
              Out of stock · see similar in shop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GlassButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick}
      className="fos-press grid h-10 w-10 place-items-center rounded-full bg-white/80 text-ink-900 shadow-fos-sm backdrop-blur-[10px]">
      {children}
    </button>
  );
}

function VariantPicker({ group, selected, missing, onPick }: { group: VariantGroup; selected?: number; missing?: boolean; onPick: (optionId: number) => void }) {
  const isColor = group.type === "color";
  const chosen = group.options.find((o) => o.id === selected);
  return (
    <div id={`variant-${group.id}`} className={`mt-4 rounded-thumb transition-colors ${missing ? "-mx-2 bg-[#FDECEC] p-2 ring-1 ring-ruby-500" : ""}`}>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[13px] font-extrabold text-ink-900">{group.group_name}</span>
        {missing
          ? <span className="truncate text-caption font-bold text-ruby-500">Please choose a {group.group_name.toLowerCase()}</span>
          : <span className="truncate text-caption text-ink-500">{chosen?.label ?? "Choose one"}</span>}
      </div>
      <div className={`flex flex-wrap ${isColor ? "gap-2.5" : "gap-2"}`}>
        {group.options.map((opt) => {
          const on = selected === opt.id;
          const oos = (opt.stock_adjust || 0) <= 0;
          if (isColor) {
            return (
              <button key={opt.id} type="button" disabled={oos} onClick={() => onPick(opt.id)}
                aria-label={`${opt.label}${oos ? " (out of stock)" : ""}`} aria-pressed={on}
                className={`fos-press relative h-9 w-9 rounded-full border border-line ${on ? "ring-2 ring-navy-700 ring-offset-2" : ""} ${oos ? "opacity-35" : ""}`}
                style={{ background: opt.hex_color || "#ccc" }}>
                {oos && <span className="absolute left-1/2 top-1/2 h-px w-8 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-ink-500" />}
              </button>
            );
          }
          return (
            <button key={opt.id} type="button" disabled={oos} onClick={() => onPick(opt.id)} aria-pressed={on}
              className={`fos-press h-[38px] min-w-[46px] rounded-md border-[1.5px] px-3 text-[13px] ${on ? "border-navy-700 bg-navy-700 font-extrabold text-white" : "border-line bg-white font-semibold text-ink-900"} ${oos ? "text-ink-500 line-through opacity-50" : ""}`}>
              {opt.label}
              {opt.price_adjust > 0 && <span className="ml-1 text-[10px] opacity-75">+${opt.price_adjust}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TrustTile({ icon, tone = "default", children }: { icon: React.ReactNode; tone?: "default" | "warn"; children: React.ReactNode }) {
  return (
    <div className={`flex h-16 flex-col items-center justify-center gap-1 rounded-thumb px-1 text-center ${tone === "warn" ? "bg-[#FFF1E6] text-[#B54708]" : "bg-surface text-ink-900"}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" {...ICON} className={tone === "warn" ? "" : "text-navy-700"} aria-hidden>{icon}</svg>
      <span className="w-full truncate text-[11px] font-bold">{children}</span>
    </div>
  );
}

function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const body = text.trim();
  const long = body.length > 120 || body.split("\n").length > 2;
  // Collapsed: blank lines squeezed out so the two visible lines carry text
  const shown = open || !long ? body : body.replace(/\n\s*\n+/g, "\n");
  return (
    <section className="mt-5">
      <h2 className="text-section text-ink-900">About</h2>
      <p className={`mt-1.5 whitespace-pre-wrap text-[14px] leading-[22px] text-ink-500 ${open || !long ? "" : "line-clamp-2"}`}>{shown}</p>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 h-8 text-[13px] font-bold text-navy-700">
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </section>
  );
}

function Reviews({ productId, signedIn }: { productId: number; signedIn: boolean }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [writing, setWriting] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.get<Review[]>("/reviews", { params: { product_id: productId } }).then(setReviews).catch(() => setReviews([]));
  }, [productId]);

  async function submit() {
    setBusy(true);
    setMsg("");
    try {
      await api.post("/reviews", { product_id: productId, rating, comment });
      setComment("");
      setRating(5);
      setWriting(false);
      setMsg("Thanks! Your review appears after approval.");
    } catch (e) {
      setMsg((e instanceof Error && e.message) || "Could not send review");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6">
      <div className="flex items-center">
        <h2 className="flex-1 text-section text-ink-900">Reviews{reviews.length ? ` · ${reviews.length}` : ""}</h2>
        {signedIn && !writing && (
          <button type="button" onClick={() => setWriting(true)} className="fos-press h-9 rounded-full bg-surface px-3.5 text-[13px] font-bold text-navy-700">Write</button>
        )}
      </div>
      {msg && <p className="mt-2 text-caption text-ink-500">{msg}</p>}

      {writing && (
        <div className="mt-3 rounded-card bg-surface p-3">
          <div className="flex gap-1" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((s) => (
              <button key={s} type="button" role="radio" aria-checked={s === rating} aria-label={`${s} stars`} onClick={() => setRating(s)}
                className={`grid h-11 w-11 place-items-center ${s <= rating ? "text-gold-400" : "text-line"}`}><Icon name="star" size={28} filled /></button>
            ))}
          </div>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="How was it?"
            className="mt-2 w-full resize-none rounded-md border border-line bg-white p-3 text-[14px] text-ink-900 outline-none focus:border-navy-500" />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setWriting(false)} className="fos-press h-11 flex-1 rounded-md bg-white text-[14px] font-bold text-ink-500">Cancel</button>
            <button type="button" onClick={submit} disabled={busy} className="fos-press h-11 flex-[2] rounded-md bg-navy-700 text-[14px] font-bold text-white disabled:opacity-50">
              {busy ? "Sending…" : "Send review"}
            </button>
          </div>
        </div>
      )}

      {reviews.length === 0 && !writing ? (
        <p className="mt-2 text-[14px] text-ink-500">No reviews yet</p>
      ) : (
        <div className="mt-2 divide-y divide-line">
          {reviews.slice(0, 5).map((r) => (
            <div key={r.id} className="py-3">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-surface text-[12px] font-extrabold text-navy-700">{(r.user_name || "A")[0].toUpperCase()}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink-900">{r.user_name || "Anonymous"}</span>
                <span className="flex" aria-label={`${r.rating} stars`}>{[1, 2, 3, 4, 5].map((s) => <Icon key={s} name="star" size={12} filled className={s <= r.rating ? "text-gold-400" : "text-line"} />)}</span>
              </div>
              {r.comment && <p className="mt-1.5 text-[14px] leading-5 text-ink-500">{r.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LoadingPage() {
  return (
    <div className="min-h-screen bg-white">
      <Skeleton className="h-[420px] w-full" />
      <div className="relative -mt-5 rounded-t-sheet bg-white px-gutter pt-[18px]">
        <Skeleton className="h-9 w-36 rounded-md" />
        <Skeleton className="mt-3 h-5 w-3/4 rounded-md" />
        <div className="mt-3 flex gap-1.5">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-16 rounded-full" />)}</div>
        <Skeleton className="mt-5 h-[60px] rounded-[18px]" />
        <div className="mt-3 grid grid-cols-3 gap-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-thumb" />)}</div>
      </div>
    </div>
  );
}
