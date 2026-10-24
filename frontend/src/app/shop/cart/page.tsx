"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { useCart } from "@/providers/CartProvider";
import { LoginGate } from "@/components/shop/LoginGate";
import { EmptyState, LocationSheet, Pill, Skeleton } from "@/components/shop";
import { api } from "@/lib/api";
import { fetchQuote, getSavedPromo, money, savePromo, type CartQuote, type ShopQuote } from "@/lib/quote";
import { FREE_DELIVERY_OVER_USD, formatKhr } from "@/lib/currency";
import { useHomeLocation } from "@/lib/useHomeLocation";
import { lightHaptic } from "@/lib/haptics";
import type { CartItem } from "@/types";
import { Icon } from "@/components/shop/Icon";

interface ShopBrief { id: number; name: string; logo_url?: string | null; icon_emoji?: string | null }

const ICON = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export default function CartPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { items, loading, updateQuantity, removeItem } = useCart();
  const { location, resolved, save: saveLocation } = useHomeLocation(!!user);
  const [locOpen, setLocOpen] = useState(false);

  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState("");
  const [promoSuccess, setPromoSuccess] = useState(false);
  const [quote, setQuote] = useState<CartQuote | null>(null);
  /** Set when a shop in the cart can't deliver to the customer's location. */
  const [deliveryError, setDeliveryError] = useState("");
  const [shops, setShops] = useState<Record<number, ShopBrief>>({});

  // Price from the backend — same computation as placing the order. With a
  // known location the fee is the real distance fee; without one the backend
  // returns its default, which we don't show (the pin is set at checkout).
  const refreshQuote = useCallback(async (code: string | null) => {
    const where = location ? { delivery_type: "delivery" as const, lat: location.lat, lng: location.lng } : undefined;
    try {
      const q = await fetchQuote(code, where);
      setQuote(q);
      setDeliveryError("");
      return q;
    } catch (e) {
      if (where) {
        // Out of a shop's delivery area: still price the items, flag delivery.
        setDeliveryError(e instanceof Error ? e.message.replace(/^Delivery unavailable for this location\.\s*/, "") : "");
        try {
          const q = await fetchQuote(code);
          setQuote(q);
          return q;
        } catch { /* fall through */ }
      }
      setQuote(null);
      return null;
    }
  }, [location]);

  // Restore an applied code and re-price whenever the cart or location changes
  useEffect(() => {
    if (!user || items.length === 0 || !resolved) return;
    const saved = getSavedPromo();
    refreshQuote(saved).then((q) => {
      if (saved && q?.promo?.applied) {
        setPromoCode(saved);
        setPromoSuccess(true);
      } else if (saved) {
        savePromo(null);
        setPromoSuccess(false);
        if (q?.promo?.error) setPromoError(q.promo.error);
      }
    });
  }, [user, items, resolved, refreshQuote]);

  // Shop name + logo for each group header
  const merchantIds = useMemo(
    () => Array.from(new Set(items.map((i) => i.merchant_id).filter((id): id is number => id != null))),
    [items],
  );
  useEffect(() => {
    merchantIds.filter((id) => !shops[id]).forEach((id) => {
      api.get<ShopBrief>(`/merchants/${id}`)
        .then((m) => setShops((s) => ({ ...s, [id]: { id, name: m.name, logo_url: m.logo_url, icon_emoji: m.icon_emoji } })))
        .catch(() => {});
    });
  }, [merchantIds, shops]);

  const handleApplyPromo = async () => {
    const code = promoCode.trim();
    if (!code) return;
    setPromoLoading(true);
    setPromoError("");
    const q = await refreshQuote(code);
    if (q?.promo?.applied) {
      savePromo(code);
      setPromoSuccess(true);
    } else {
      setPromoError(q?.promo?.error || "Invalid promo code");
      await refreshQuote(null);
    }
    setPromoLoading(false);
  };

  const clearPromo = () => {
    savePromo(null);
    setPromoSuccess(false);
    setPromoCode("");
    setPromoError("");
    refreshQuote(null);
  };

  if (authLoading) return <LoadingPage />;
  if (!user) return <LoginGate><div /></LoginGate>;
  if (loading) return <LoadingPage />;
  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-surface px-gutter pt-6">
        <h1 className="text-display text-ink-900">Cart</h1>
        <EmptyState className="mt-10" title="Your cart is empty" action={{ label: "Start shopping", href: "/shop" }} />
      </div>
    );
  }

  const groups = groupByShop(items);
  const quoteFor = (merchantId: number | undefined) => quote?.orders.find((o) => o.merchant_id === merchantId);
  // Delivery is only priced for real when we know where the customer is.
  const priced = !!location && !deliveryError;
  const t = quote?.totals;
  const discount = Number(t?.discount ?? 0);
  const total = t ? (priced ? Number(t.total) : Number(t.subtotal) - discount) : null;
  const itemCount = items.reduce((n, i) => n + i.quantity, 0);

  return (
    <div className="min-h-screen bg-surface">
      <div className="px-gutter pb-[120px] pt-6">
        <div className="flex items-baseline gap-2">
          <h1 className="text-display text-ink-900">Cart</h1>
          <span className="text-caption text-ink-500">{itemCount} {itemCount === 1 ? "item" : "items"}</span>
        </div>

        <DeliveryBar
          location={location?.area ?? null}
          error={deliveryError}
          orders={quote?.orders ?? []}
          shopName={(id) => shops[id]?.name}
          onChangeLocation={() => setLocOpen(true)}
        />
        {locOpen && (
          <LocationSheet current={location} onClose={() => setLocOpen(false)}
            onConfirm={(loc) => { saveLocation(loc); setLocOpen(false); }} />
        )}

        <div className="mt-4 flex flex-col gap-3">
          {groups.map(({ merchantId, lines }) => (
            <ShopGroup
              key={merchantId ?? "none"}
              shop={merchantId != null ? shops[merchantId] : undefined}
              fallbackName={lines[0]?.merchant_name}
              quote={quoteFor(merchantId)}
              priced={priced}
              lines={lines}
              onQty={(line, q) => { lightHaptic(); updateQuantity(line.id, q); }}
              onRemove={(line) => { lightHaptic(); removeItem(line.id); }}
            />
          ))}
        </div>

        {/* Promo */}
        {promoSuccess ? (
          <div className="mt-3 flex h-14 items-center gap-3 rounded-[18px] bg-tint-jade px-4">
            <Icon name="ticket" size={20} className="text-tone-jade" />
            <span className="flex-1 truncate text-[14px] font-bold text-tone-jade">{quote?.promo?.code ?? promoCode} · −{money(discount)}</span>
            <button type="button" onClick={clearPromo} className="fos-press h-11 px-2 text-[13px] font-bold text-ruby-500">Remove</button>
          </div>
        ) : promoOpen ? (
          <div className="mt-3 rounded-[18px] border border-dashed border-gold-400 bg-card p-2">
            <div className="flex gap-2">
              <input
                autoFocus value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") handleApplyPromo(); }}
                placeholder="Promo code" aria-label="Promo code"
                className="h-11 min-w-0 flex-1 rounded-md bg-surface px-3 text-[15px] font-semibold uppercase tracking-wide text-ink-900 outline-none placeholder:normal-case placeholder:font-medium placeholder:tracking-normal placeholder:text-ink-500"
              />
              <button
                type="button" onClick={handleApplyPromo} disabled={promoLoading || !promoCode.trim()}
                className="fos-press h-11 rounded-md bg-navy-700 px-4 text-[14px] font-bold text-white disabled:opacity-40"
              >{promoLoading ? "…" : "Apply"}</button>
            </div>
            {promoError && <p className="px-1 pt-1.5 text-caption text-ruby-500">{promoError}</p>}
          </div>
        ) : (
          <button
            type="button" onClick={() => setPromoOpen(true)}
            className="fos-press mt-3 flex h-14 w-full items-center gap-3 rounded-[18px] border border-dashed border-gold-400 bg-card px-4 text-left"
          >
            <Icon name="ticket" size={20} className="text-gold-700" />
            <span className="flex-1 text-[14px] font-bold text-ink-900">Promo code</span>
            <span className="text-ink-500" aria-hidden>→</span>
          </button>
        )}
      </div>

      {/* Summary bar — sits above the tab bar */}
      <div
        className="fixed inset-x-0 z-[90] rounded-t-hero bg-card shadow-fos-lg"
        style={{ bottom: "calc(84px + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto flex max-w-[640px] items-center gap-3 px-gutter py-3">
          <div className="min-w-0 flex-1 tabular-nums">
            <div className="truncate text-caption text-ink-500">
              {total == null ? "Total" : priced ? `Total · ${formatKhr(total)}` : "Items · delivery at checkout"}
            </div>
            <div className="text-[24px] font-extrabold leading-7 text-ink-900">{total == null ? "…" : money(total)}</div>
          </div>
          <button
            type="button" onClick={() => router.push("/shop/checkout")}
            className="fos-press h-[52px] shrink-0 rounded-thumb bg-grad-cta px-6 text-[15px] font-bold text-white shadow-fos-cta"
          >
            Checkout →
          </button>
        </div>
      </div>
    </div>
  );
}

function groupByShop(items: CartItem[]) {
  const map = new Map<number | undefined, CartItem[]>();
  for (const it of items) map.set(it.merchant_id, [...(map.get(it.merchant_id) ?? []), it]);
  return Array.from(map, ([merchantId, lines]) => ({ merchantId, lines }));
}

/** Where the order goes + how far each shop is from free delivery. */
function DeliveryBar({ location, error, orders, shopName, onChangeLocation }: {
  location: string | null;
  error: string;
  orders: ShopQuote[];
  shopName: (id: number) => string | undefined;
  onChangeLocation: () => void;
}) {
  const truck = (
    <svg width="22" height="22" viewBox="0 0 24 24" {...ICON} aria-hidden>
      <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" />
    </svg>
  );

  if (error) {
    return (
      <div className="mt-4 flex items-center gap-3 rounded-card bg-tint-ruby p-3.5">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-card text-ruby-500">{truck}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-extrabold text-ink-900">Can&apos;t deliver to {location ?? "your location"}</div>
          <div className="truncate text-caption text-ink-500">{error} · pickup available</div>
        </div>
        <button type="button" onClick={onChangeLocation} className="fos-press shrink-0 rounded-full bg-card px-3 py-1.5 text-[12px] font-extrabold text-navy-700">Change</button>
      </div>
    );
  }

  // Closest shop to the free-delivery threshold that hasn't reached it yet
  const pending = orders
    .map((o) => ({ id: o.merchant_id, left: FREE_DELIVERY_OVER_USD - Number(o.subtotal) }))
    .filter((o) => o.left > 0)
    .sort((a, b) => a.left - b.left)[0];
  const unlocked = orders.length > 0 && !pending;
  const progress = pending ? Math.max(0.04, 1 - pending.left / FREE_DELIVERY_OVER_USD) : 1;
  const name = pending && orders.length > 1 ? shopName(pending.id) : undefined;

  return (
    <div className="mt-4 flex items-center gap-3 rounded-card bg-tint-jade p-3.5">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-card text-tone-jade">{truck}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-extrabold text-ink-900">
          {unlocked
            ? <span className="text-tone-jade">Free delivery unlocked</span>
            : pending
              ? <>+{money(pending.left)}{name ? ` at ${name}` : ""} → <span className="text-tone-jade">Free delivery</span></>
              : "Delivery"}
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-card">
          <i className="block h-full rounded-full bg-jade-500 transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
        </div>
        <button type="button" onClick={onChangeLocation} className="mt-1 flex max-w-full items-center gap-1 text-[11px] font-semibold text-ink-500">
          <Icon name="pin" size={12} strokeWidth={2.2} /><span className="truncate">{location ? `To ${location}` : "Set your delivery location"}</span>
          <span className="shrink-0 font-extrabold text-navy-700">· Change</span>
        </button>
      </div>
    </div>
  );
}

function ShopGroup({ shop, fallbackName, quote, priced, lines, onQty, onRemove }: {
  shop?: ShopBrief;
  fallbackName?: string;
  quote?: ShopQuote;
  priced: boolean;
  lines: CartItem[];
  onQty: (line: CartItem, quantity: number) => void;
  onRemove: (line: CartItem) => void;
}) {
  const name = shop?.name ?? fallbackName ?? "Shop";
  const fee = quote ? Number(quote.delivery_fee) : null;
  const km = quote?.distance_km != null ? Number(quote.distance_km) : null;

  let feePill = null;
  if (quote && Number(quote.subtotal) >= FREE_DELIVERY_OVER_USD) feePill = <Pill variant="jade">Free delivery</Pill>;
  else if (priced && fee != null) feePill = <Pill variant="jade">{money(fee)}{km != null ? ` · ${km.toFixed(1)} km` : ""}</Pill>;
  else if (quote) feePill = <Pill variant="neutral">Fee at checkout</Pill>;

  return (
    <section className="rounded-hero bg-card p-3.5 shadow-fos-sm">
      <header className="mb-1 flex items-center gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-[9px] bg-surface text-[14px]">
          {shop?.logo_url
            ? <img src={shop.logo_url} alt="" className="h-full w-full object-cover" />
            : shop?.icon_emoji || <span className="text-[12px] font-extrabold text-navy-700">{name[0]?.toUpperCase()}</span>}
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-extrabold text-ink-900">{name}</span>
        {feePill}
      </header>
      {quote && !quote.is_open && (
        <div className="mb-1 mt-2"><Pill variant="mango">Closed now · order opens later</Pill></div>
      )}
      {quote?.min_order_amount && Number(quote.subtotal) < Number(quote.min_order_amount) && (
        <div className="mb-1 mt-2"><Pill variant="mango">Min. order {money(quote.min_order_amount)}</Pill></div>
      )}
      <div className="divide-y divide-line">
        {lines.map((line) => <CartLine key={line.id} line={line} onQty={onQty} onRemove={onRemove} />)}
      </div>
    </section>
  );
}

function CartLine({ line, onQty, onRemove }: {
  line: CartItem;
  onQty: (line: CartItem, quantity: number) => void;
  onRemove: (line: CartItem) => void;
}) {
  const variants = Array.isArray(line.selected_variants)
    ? (line.selected_variants as Array<{ label?: string }>).map((v) => v.label).filter(Boolean).join(" · ")
    : "";
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-thumb bg-surface">
        {line.primary_image
          ? <img src={line.primary_image} alt={line.product_name ?? ""} className="h-full w-full object-cover" />
          : <div className="grid h-full w-full place-items-center text-[24px] font-extrabold text-ink-500">{line.icon_emoji || line.product_name?.[0]?.toUpperCase() || "?"}</div>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="truncate text-[14px] font-bold text-ink-900">{line.product_name}</div>
        {variants && <span className="inline-flex h-5 max-w-full self-start truncate rounded-sm bg-surface px-1.5 text-[11px] font-semibold leading-5 text-ink-500">{variants}</span>}
        <div className="text-[16px] font-extrabold tabular-nums text-ink-900">{money(line.line_total)}</div>
      </div>
      <div className="flex h-8 w-24 shrink-0 items-center justify-between rounded-md bg-surface">
        <button
          type="button"
          onClick={() => (line.quantity <= 1 ? onRemove(line) : onQty(line, line.quantity - 1))}
          aria-label={line.quantity <= 1 ? "Remove" : "Decrease"}
          className={`fos-press grid h-8 w-8 place-items-center ${line.quantity <= 1 ? "text-ruby-500" : "text-ink-900"}`}
        >
          {line.quantity <= 1
            ? <svg width="16" height="16" viewBox="0 0 24 24" {...ICON} aria-hidden><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
            : <span className="text-[18px] font-bold leading-none">−</span>}
        </button>
        <span className="text-[14px] font-extrabold tabular-nums text-ink-900">{line.quantity}</span>
        <button
          type="button" onClick={() => onQty(line, line.quantity + 1)} aria-label="Increase"
          className="fos-press grid h-8 w-8 place-items-center text-[18px] font-bold leading-none text-navy-700"
        >+</button>
      </div>
    </div>
  );
}

function LoadingPage() {
  return (
    <div className="min-h-screen bg-surface px-gutter pt-6">
      <h1 className="text-display text-ink-900">Cart</h1>
      <Skeleton className="mt-4 h-[72px] rounded-card" />
      {[1, 2].map((i) => <Skeleton key={i} className="mt-3 h-[140px] rounded-hero" />)}
    </div>
  );
}
