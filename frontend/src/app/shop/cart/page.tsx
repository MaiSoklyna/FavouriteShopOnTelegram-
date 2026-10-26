"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /** The applied code and the one shop it belongs to */
  const [promo, setPromo] = useState<{ code: string; merchantId: number } | null>(null);
  /** Each shop is priced on its own — its own fee, area and order */
  const [quotes, setQuotes] = useState<Record<number, ShopPrice>>({});
  const [shops, setShops] = useState<Record<number, ShopBrief>>({});
  const priceReq = useRef(0);

  const merchantIds = useMemo(
    () => Array.from(new Set(items.map((i) => i.merchant_id).filter((id): id is number => id != null))),
    [items],
  );

  // Price from the backend — same computation as placing the order. With a
  // known location the fee is the real distance fee; without one the backend
  // returns its default, which we don't show (the pin is set at checkout).
  const priceShop = useCallback(async (merchantId: number, code: string | null): Promise<ShopPrice & { promo: CartQuote["promo"] }> => {
    const where = location ? { delivery_type: "delivery" as const, lat: location.lat, lng: location.lng } : undefined;
    try {
      const q = await fetchQuote(code, where, merchantId);
      return { quote: q.orders[0] ?? null, error: "", promo: q.promo };
    } catch (e) {
      // Out of this shop's delivery area: still price the items, flag delivery.
      const error = where && e instanceof Error ? e.message.replace(/^Delivery unavailable for this location\.\s*/, "") : "";
      try {
        const q = await fetchQuote(code, undefined, merchantId);
        return { quote: q.orders[0] ?? null, error, promo: q.promo };
      } catch {
        return { quote: null, error, promo: null };
      }
    }
  }, [location]);

  /** Re-price every shop; returns where the code applied, or why it didn't. */
  const refreshQuotes = useCallback(async (code: string | null) => {
    const req = ++priceReq.current;
    const results = await Promise.all(merchantIds.map((id) => priceShop(id, code).then((r) => [id, r] as const)));
    if (req !== priceReq.current) return null;
    setQuotes(Object.fromEntries(results.map(([id, r]) => [id, { quote: r.quote, error: r.error }])));
    const applied = results.find(([, r]) => r.promo?.applied);
    if (applied) return { merchantId: applied[0] as number | null, error: "" };
    // A shop's own reason ("Min. spend $20") beats the generic "not valid for the shops in your cart"
    const errors = results.map(([, r]) => r.promo?.error).filter((m): m is string => !!m);
    return { merchantId: null, error: errors.find((m) => !/^Promo code not valid for the shops/.test(m)) ?? errors[0] ?? "Invalid promo code" };
  }, [merchantIds, priceShop]);

  // Restore an applied code and re-price whenever the cart or location changes
  useEffect(() => {
    if (!user || merchantIds.length === 0 || !resolved) return;
    const saved = getSavedPromo();
    refreshQuotes(saved?.code ?? null).then((r) => {
      if (!r || !saved) return;
      if (r.merchantId != null) {
        setPromoCode(saved.code);
        setPromo({ code: saved.code, merchantId: r.merchantId });
        savePromo(saved.code, r.merchantId);
      } else {
        savePromo(null);
        setPromo(null);
        setPromoError(r.error);
      }
    });
  }, [user, items, merchantIds, resolved, refreshQuotes]);

  // Shop name + logo for each group header
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
    const r = await refreshQuotes(code);
    if (r?.merchantId != null) {
      savePromo(code, r.merchantId);
      setPromo({ code, merchantId: r.merchantId });
    } else if (r) {
      setPromoError(r.error);
      await refreshQuotes(null);
    }
    setPromoLoading(false);
  };

  const clearPromo = () => {
    savePromo(null);
    setPromo(null);
    setPromoCode("");
    setPromoError("");
    refreshQuotes(null);
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
  const itemCount = items.reduce((n, i) => n + i.quantity, 0);
  const promoShop = promo ? shops[promo.merchantId]?.name : undefined;
  const promoDiscount = promo ? Number(quotes[promo.merchantId]?.quote?.discount ?? 0) : 0;

  return (
    <div className="min-h-screen bg-surface">
      <div className="px-gutter pb-[120px] pt-6">
        <div className="flex items-baseline gap-2">
          <h1 className="text-display text-ink-900">Cart</h1>
          <span className="text-caption text-ink-500">
            {itemCount} {itemCount === 1 ? "item" : "items"}{groups.length > 1 ? ` · ${groups.length} shops` : ""}
          </span>
        </div>
        {groups.length > 1 && (
          <p className="mt-1 text-caption text-ink-500">Each shop is its own order with its own delivery. Check out one shop at a time.</p>
        )}

        <LocationBar location={location?.area ?? null} onChange={() => setLocOpen(true)} />
        {locOpen && (
          <LocationSheet current={location} onClose={() => setLocOpen(false)}
            onConfirm={(loc) => { saveLocation(loc); setLocOpen(false); }} />
        )}

        <div className="mt-3 flex flex-col gap-3">
          {groups.map(({ merchantId, lines }) => (
            <ShopGroup
              key={merchantId ?? "none"}
              shop={merchantId != null ? shops[merchantId] : undefined}
              fallbackName={lines[0]?.merchant_name}
              price={merchantId != null ? quotes[merchantId] : undefined}
              located={!!location}
              lines={lines}
              onQty={(line, q) => { lightHaptic(); updateQuantity(line.id, q); }}
              onRemove={(line) => { lightHaptic(); removeItem(line.id); }}
              onCheckout={merchantId != null ? () => router.push(`/shop/checkout?shop=${merchantId}`) : undefined}
            />
          ))}
        </div>

        {/* Promo — a code belongs to one shop and only lowers that shop's order */}
        {promo ? (
          <div className="mt-3 flex h-14 items-center gap-3 rounded-[18px] bg-tint-jade px-4">
            <Icon name="ticket" size={20} className="text-tone-jade" />
            <span className="flex-1 truncate text-[14px] font-bold text-tone-jade">
              {promo.code} · −{money(promoDiscount)}{promoShop && groups.length > 1 ? ` at ${promoShop}` : ""}
            </span>
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
    </div>
  );
}

interface ShopPrice { quote: ShopQuote | null; error: string }

function groupByShop(items: CartItem[]) {
  const map = new Map<number | undefined, CartItem[]>();
  for (const it of items) map.set(it.merchant_id, [...(map.get(it.merchant_id) ?? []), it]);
  return Array.from(map, ([merchantId, lines]) => ({ merchantId, lines }));
}

/** Where the orders go — every shop prices its own delivery to this place. */
function LocationBar({ location, onChange }: { location: string | null; onChange: () => void }) {
  return (
    <button type="button" onClick={onChange}
      className="fos-press mt-4 flex w-full items-center gap-3 rounded-card bg-card p-3 text-left shadow-fos-sm">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-tint-mango text-mango-500">
        <Icon name="pin" size={20} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-caption text-ink-500">Deliver to</span>
        <span className="block truncate text-[14px] font-extrabold text-ink-900">{location ?? "Set your delivery location"}</span>
      </span>
      <span className="shrink-0 rounded-full bg-surface px-3 py-1.5 text-[12px] font-extrabold text-navy-700">{location ? "Change" : "Set"}</span>
    </button>
  );
}

function ShopGroup({ shop, fallbackName, price, located, lines, onQty, onRemove, onCheckout }: {
  shop?: ShopBrief;
  fallbackName?: string;
  price?: ShopPrice;
  /** Delivery is only priced for real when we know where the customer is. */
  located: boolean;
  lines: CartItem[];
  onQty: (line: CartItem, quantity: number) => void;
  onRemove: (line: CartItem) => void;
  onCheckout?: () => void;
}) {
  const name = shop?.name ?? fallbackName ?? "Shop";
  const quote = price?.quote ?? null;
  const outOfArea = !!price?.error;
  const subtotal = quote ? Number(quote.subtotal) : lines.reduce((n, l) => n + Number(l.line_total ?? 0), 0);
  const discount = Number(quote?.discount ?? 0);
  const free = subtotal >= FREE_DELIVERY_OVER_USD;
  const priced = located && !outOfArea && !!quote;
  const fee = priced ? Number(quote!.delivery_fee) : null;
  const km = quote?.distance_km != null ? Number(quote.distance_km) : null;
  const total = priced ? Number(quote!.total) : subtotal - discount;
  const closed = !!quote && !quote.is_open;
  const minShort = quote?.min_order_amount ? Number(quote.min_order_amount) - subtotal : 0;

  let feePill = null;
  if (free) feePill = <Pill variant="jade">Free delivery</Pill>;
  else if (priced && fee != null) feePill = <Pill variant="jade">{money(fee)}{km != null ? ` · ${km.toFixed(1)} km` : ""}</Pill>;
  else if (outOfArea) feePill = <Pill variant="mango">Pickup only</Pill>;

  const cta = closed ? "Closed now" : minShort > 0 ? `Add ${money(minShort)} more` : `Checkout ${name}`;

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
      {closed && <div className="mb-1 mt-2"><Pill variant="mango">Closed now · order opens later</Pill></div>}
      {minShort > 0 && <div className="mb-1 mt-2"><Pill variant="mango">Min. order {money(quote!.min_order_amount)}</Pill></div>}
      {outOfArea && (
        <p className="mb-1 mt-2 rounded-md bg-tint-ruby px-2.5 py-2 text-[12px] font-semibold text-ruby-500">
          Doesn&apos;t deliver to your location{price?.error ? ` · ${price.error}` : ""}. Pickup still works.
        </p>
      )}
      <div className="divide-y divide-line">
        {lines.map((line) => <CartLine key={line.id} line={line} onQty={onQty} onRemove={onRemove} />)}
      </div>

      {/* This shop's own bill */}
      <div className="mt-1 border-t border-line pt-2.5 text-[13px] tabular-nums">
        <div className="flex justify-between py-0.5"><span className="text-ink-500">Subtotal</span><span className="font-bold text-ink-900">{money(subtotal)}</span></div>
        {discount > 0 && (
          <div className="flex justify-between py-0.5 font-bold text-tone-jade"><span>Promo</span><span>−{money(discount)}</span></div>
        )}
        <div className="flex justify-between py-0.5">
          <span className="text-ink-500">Delivery</span>
          <span className={`font-bold ${free || fee === 0 ? "text-tone-jade" : "text-ink-900"}`}>
            {free || fee === 0 ? "Free" : fee != null ? money(fee) : outOfArea ? "Pickup only" : "At checkout"}
          </span>
        </div>
        {!free && (
          <div className="mt-1.5">
            <div className="text-[11px] font-semibold text-ink-500">
              Add {money(FREE_DELIVERY_OVER_USD - subtotal)} more for <span className="text-tone-jade">free delivery</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
              <i className="block h-full rounded-full bg-jade-500 transition-[width] duration-300" style={{ width: `${Math.max(4, (subtotal / FREE_DELIVERY_OVER_USD) * 100)}%` }} />
            </div>
          </div>
        )}
      </div>

      <button
        type="button" onClick={onCheckout} disabled={!onCheckout || closed || minShort > 0}
        className="fos-press mt-3 flex h-[52px] w-full items-center gap-2 rounded-thumb bg-grad-cta px-4 text-white shadow-fos-cta disabled:opacity-50 disabled:shadow-none"
      >
        <span className="min-w-0 flex-1 truncate text-left text-[15px] font-bold">{cta}</span>
        <span className="shrink-0 text-right tabular-nums leading-tight">
          <span className="block text-[16px] font-extrabold">{price ? money(total) : "…"}</span>
          {price && <span className="block text-[10px] font-semibold text-white/75">{priced ? formatKhr(total) : "+ delivery"}</span>}
        </span>
      </button>
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
