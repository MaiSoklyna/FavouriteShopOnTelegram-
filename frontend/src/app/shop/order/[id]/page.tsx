"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { LoginGate } from "@/components/shop/LoginGate";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { Order } from "@/types";
import { KhqrPayPanel } from "@/components/shop/KhqrPayPanel";
import { Icon } from "@/components/shop/Icon";
import { EmptyState, OrderStatusHero, OrderTimeline, Pill, Skeleton } from "@/components/shop";
import { awaitingPayment, isPickup, statusLabel } from "@/lib/orderStatus";
import { formatKm, staticMapUrl, type LatLng } from "@/lib/mapbox";
import { formatKhr } from "@/lib/currency";

interface ShopInfo {
  id: number;
  name: string;
  logo_url?: string | null;
  icon_emoji?: string | null;
  address?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

const money = (n: number | string | null | undefined) => `$${Number(n || 0).toFixed(2)}`;

export default function OrderDetailPage() {
  return <Suspense><OrderDetailContent /></Suspense>;
}

function OrderDetailContent() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const placed = searchParams.get("placed") === "true";
  // Wait for auth to resolve before fetching. The bot's "View Order" deep link
  // opens this page with a fresh ?auth= token that AuthProvider consumes on
  // mount, so fetching too early would 401 and show a blank screen.
  const { user, loading: authLoading } = useAuth();

  const [order, setOrder] = useState<Order | null>(null);
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [images, setImages] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showSuccess, setShowSuccess] = useState(placed);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);

  const fetchOrder = useCallback(async () => {
    try { setOrder(await api.get<Order>(`/orders/${id}`)); setNotFound(false); }
    catch { setNotFound(true); }
    finally { setLoading(false); }
  }, [id]);

  // Only fetch once auth has resolved and we have a session.
  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    fetchOrder();
  }, [authLoading, user, fetchOrder]);
  useAutoRefresh(fetchOrder, { interval: 10000 });

  // Shop (name, logo, location, phone) and item photos — once per order, not on every refresh
  const merchantId = order?.merchant_id;
  const productKey = (order?.items ?? []).map((i) => i.product_id).filter(Boolean).join(",");
  useEffect(() => {
    if (!merchantId) return;
    api.get<ShopInfo>(`/merchants/${merchantId}`).then(setShop).catch(() => setShop(null));
  }, [merchantId]);
  useEffect(() => {
    if (!productKey) return;
    const ids = Array.from(new Set(productKey.split(",").map(Number))).slice(0, 8);
    Promise.all(ids.map((pid) =>
      api.get<{ primary_image?: string | null }>(`/products/${pid}`).then((p) => [pid, p.primary_image] as const).catch(() => [pid, null] as const),
    )).then((rows) => setImages(Object.fromEntries(rows.filter(([, url]) => url)) as Record<number, string>));
  }, [productKey]);

  useEffect(() => { if (showSuccess) { const t = setTimeout(() => setShowSuccess(false), 4000); return () => clearTimeout(t); } }, [showSuccess]);

  async function handleCancel() {
    if (!confirm("Cancel this order?")) return;
    setCancelling(true);
    try { await api.post(`/orders/${id}/cancel`); setOrder(o => o ? { ...o, status: "cancelled" } : o); }
    catch (e: any) { alert(e.detail || "Cannot cancel"); }
    finally { setCancelling(false); }
  }

  const [reviewProductId, setReviewProductId] = useState<number | null>(null);

  function openReview(productId?: number) {
    const pid = productId || order?.items?.[0]?.product_id;
    if (!pid) { alert("No product found to review"); return; }
    setReviewProductId(pid);
    setReviewRating(5);
    setReviewComment("");
    setShowReview(true);
  }

  async function handleReview() {
    if (!reviewProductId) { alert("No product selected"); return; }
    setSubmittingReview(true);
    try {
      await api.post("/reviews", { product_id: reviewProductId, order_id: order!.id, rating: reviewRating, comment: reviewComment });
      setShowReview(false);
      alert("Review submitted! It will appear after admin approval.");
    } catch (e: any) { alert(e.detail || "Failed to submit review"); }
    finally { setSubmittingReview(false); }
  }

  // Not logged in (e.g. opened in a plain browser without a token) — show the
  // Telegram login prompt rather than a blank screen.
  if (!authLoading && !user) {
    return <div className="min-h-screen bg-surface"><LoginGate><div /></LoginGate></div>;
  }

  if (authLoading || loading) return (
    <div className="min-h-screen bg-surface">
      <TopBar title="Order" />
      <div className="flex flex-col gap-3 px-gutter pt-2">
        <Skeleton className="h-[112px] rounded-hero" />
        <Skeleton className="h-[200px] rounded-hero" />
        <Skeleton className="h-[260px] rounded-hero" />
      </div>
    </div>
  );

  // Couldn't load the order (bad id, not yours, network) — explain instead of
  // silently bouncing to a blank page.
  if (notFound || !order) return (
    <div className="min-h-screen bg-surface">
      <TopBar title="Order" />
      <EmptyState className="mt-6 px-gutter" title="Order not found"
        action={{ label: "View my orders", onClick: () => router.push("/shop/orders") }} />
      <p className="-mt-2 px-8 text-center text-caption text-ink-500">
        It may have been removed, or you may need to reopen it from Telegram.
      </p>
    </div>
  );

  const shopName = shop?.name || order.merchant_name || "Shop";
  const track = { ...order, merchant_name: shopName };
  const pickup = isPickup(order);
  const cancelled = order.status === "cancelled";
  const unpaid = awaitingPayment(order);
  const you: LatLng | null = order.delivery_latitude != null && order.delivery_longitude != null
    ? { lat: Number(order.delivery_latitude), lng: Number(order.delivery_longitude) } : null;
  const shopPoint: LatLng | null = shop?.latitude != null && shop?.longitude != null ? { lat: shop.latitude, lng: shop.longitude } : null;
  const deliveryFee = Number(order.delivery_fee || 0);
  const discount = Number(order.discount_amount || 0);
  const itemCount = (order.items ?? []).reduce((n, i) => n + i.quantity, 0);

  return (
    <div className="min-h-screen bg-surface pb-10">
      <TopBar title="Order" code={order.order_code} pill={
        <Pill variant={cancelled ? "neutral" : order.status === "delivered" ? "jade" : "mango"} className={cancelled ? "!bg-tint-ruby !text-ruby-500" : ""}>
          {statusLabel(order)}
        </Pill>
      } />

      <div className="flex flex-col gap-3 px-gutter pt-2">
        {showSuccess && !unpaid && (
          <div className="shop-fade-up flex items-center gap-3 rounded-card bg-tint-jade p-3.5" role="status">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-jade-500 text-white"><Icon name="check" size={20} strokeWidth={3} /></span>
            <div className="min-w-0">
              <div className="text-[14px] font-extrabold text-tone-jade">Order placed!</div>
              <div className="text-caption text-ink-500">We&apos;ll message you in Telegram as it moves</div>
            </div>
          </div>
        )}

        {unpaid && <KhqrPayPanel orderId={order.id} total={Number(order.total)} onPaid={fetchOrder} />}

        <OrderStatusHero order={track} />

        {/* Where it's going (delivery) or where to collect it (pickup) */}
        <PlaceCard pickup={pickup} you={you} shopPoint={shopPoint} shop={shop} shopName={shopName}
          address={order.delivery_address} name={order.delivery_name || order.customer_name}
          phone={order.delivery_phone || order.customer_phone} distanceKm={order.distance_km} />

        {!cancelled && <OrderTimeline order={track} />}

        {/* Shop + items */}
        <section className="rounded-hero bg-card p-4 shadow-fos-sm">
          <header className="mb-1 flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-surface text-[15px]">
              {shop?.logo_url
                ? <img src={shop.logo_url} alt="" className="h-full w-full object-cover" />
                : shop?.icon_emoji || <span className="text-[13px] font-extrabold text-navy-700">{shopName[0]?.toUpperCase()}</span>}
            </span>
            <button type="button" onClick={() => router.push(`/shop/merchant/${order.merchant_id}`)}
              className="flex min-w-0 flex-1 items-center gap-1 text-left">
              <span className="truncate text-[15px] font-extrabold text-ink-900">{shopName}</span>
              <Icon name="chevron" size={16} className="shrink-0 text-ink-500" />
            </button>
            <span className="shrink-0 text-caption text-ink-500">{itemCount} {itemCount === 1 ? "item" : "items"}</span>
          </header>
          <ul>
            {order.items?.map((item) => {
              const img = item.product_id ? images[item.product_id] : undefined;
              return (
                <li key={item.id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
                  <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-surface text-ink-500">
                    {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <Icon name="box" size={20} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold text-ink-900">{item.product_name}</div>
                    <div className="text-caption tabular-nums text-ink-500">{item.quantity} × {money(item.unit_price)}</div>
                  </div>
                  <span className="shrink-0 text-[14px] font-extrabold tabular-nums text-ink-900">{money(item.subtotal)}</span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Price + payment */}
        <section className="rounded-hero bg-card p-4 text-[14px] shadow-fos-sm">
          <Row label="Items" value={money(order.subtotal || order.total)} />
          <Row label={pickup ? "Pickup" : `Delivery${order.distance_km != null ? ` · ${formatKm(Number(order.distance_km))}` : ""}`}
            value={deliveryFee > 0 ? money(deliveryFee) : "Free"} tone={deliveryFee > 0 ? undefined : "jade"} />
          {discount > 0 && <Row label="Discount" value={`−${money(discount)}`} tone="jade" />}
          <div className="mt-2 flex items-end justify-between border-t border-line pt-3">
            <span className="text-[15px] font-extrabold text-ink-900">Total</span>
            <span className="text-right">
              <span className="block text-[20px] font-extrabold tabular-nums text-ink-900">{money(order.total)}</span>
              <span className="block text-caption tabular-nums text-ink-500">{formatKhr(Number(order.total))}</span>
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2.5 rounded-thumb bg-surface p-2.5">
            {order.payment_method === "khqr"
              ? <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#E1232E] text-[8px] font-black text-white">KHQR</span>
              : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-jade-500 text-[14px] font-black text-white">$</span>}
            <span className="min-w-0 flex-1 text-[13px] font-bold text-ink-900">
              {order.payment_method === "khqr" ? "ABA KHQR" : pickup ? "Cash at the shop" : "Cash on delivery"}
            </span>
            {order.payment_method === "khqr" && (
              order.payment_status === "paid" ? <Pill variant="jade">Paid</Pill> : !cancelled && <Pill variant="mango">Unpaid</Pill>
            )}
          </div>
          {order.customer_note && (
            <p className="mt-3 rounded-thumb bg-tint-gold p-2.5 text-[13px] text-ink-900">
              <span className="font-bold">Note: </span>{order.customer_note}
            </p>
          )}
        </section>

        {/* Actions */}
        <div className="flex flex-col gap-2.5">
          {order.status === "delivered" && (
            (order.items?.length || 0) <= 1 ? (
              <button type="button" onClick={() => openReview()}
                className="fos-press flex h-[52px] items-center justify-center gap-2 rounded-thumb bg-grad-cta text-[15px] font-extrabold text-white shadow-fos-cta">
                <Icon name="star" size={18} filled />Rate your order
              </button>
            ) : (
              <section className="rounded-hero bg-card p-4 shadow-fos-sm">
                <h3 className="mb-2 text-[14px] font-extrabold text-ink-900">Rate your items</h3>
                <div className="flex flex-col gap-2">
                  {order.items?.map(item => (
                    <button key={item.id} type="button" onClick={() => openReview(item.product_id)}
                      className="fos-press flex h-11 items-center gap-2 rounded-thumb bg-surface px-3 text-left text-[13px] font-bold text-navy-700">
                      <Icon name="star" size={16} className="text-gold-700" />
                      <span className="truncate">{item.product_name}</span>
                    </button>
                  ))}
                </div>
              </section>
            )
          )}
          <div className="flex gap-2.5">
            <button type="button" onClick={() => router.push("/shop/support")}
              className="fos-press flex h-12 flex-1 items-center justify-center gap-2 rounded-thumb bg-card text-[14px] font-extrabold text-navy-700 shadow-fos-sm">
              <Icon name="chat" size={18} />Need help?
            </button>
            {order.status === "pending" && (
              <button type="button" onClick={handleCancel} disabled={cancelling}
                className="fos-press h-12 flex-1 rounded-thumb bg-card text-[14px] font-extrabold text-ruby-500 shadow-fos-sm disabled:opacity-50">
                {cancelling ? "Cancelling…" : "Cancel order"}
              </button>
            )}
          </div>
          <p className="text-center text-caption text-ink-500">Updates every few seconds · you&apos;ll also get Telegram messages</p>
        </div>
      </div>

      {/* Review sheet */}
      {showReview && (
        <div className="fixed inset-0 z-50 flex items-end bg-navy-900/40" onClick={() => setShowReview(false)}>
          <div className="w-full rounded-t-sheet bg-card p-5 pb-[max(20px,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <span className="mx-auto mb-4 block h-1 w-10 rounded-full bg-line" aria-hidden />
            <h3 className="text-title text-ink-900">How was it?</h3>
            <div className="my-4 flex justify-center gap-2" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map(s => (
                <button key={s} type="button" role="radio" aria-checked={s === reviewRating} aria-label={`${s} star${s > 1 ? "s" : ""}`}
                  onClick={() => setReviewRating(s)}
                  className={`fos-press grid h-12 w-12 place-items-center rounded-full ${s <= reviewRating ? "bg-tint-gold text-[#F59E0B]" : "bg-surface text-line"}`}>
                  <Icon name="star" size={26} filled />
                </button>
              ))}
            </div>
            <textarea value={reviewComment} onChange={e => setReviewComment(e.target.value)} rows={4}
              placeholder="Share your experience…"
              className="w-full resize-none rounded-thumb border border-line bg-surface p-3 text-[14px] text-ink-900 outline-none focus:border-navy-500" />
            <button type="button" onClick={handleReview} disabled={submittingReview}
              className="fos-press mt-3 h-[52px] w-full rounded-thumb bg-grad-cta text-[15px] font-extrabold text-white shadow-fos-cta disabled:opacity-50">
              {submittingReview ? "Submitting…" : "Submit review"}
            </button>
            <button type="button" onClick={() => setShowReview(false)} className="mt-1 h-11 w-full text-[13px] font-bold text-ink-500">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TopBar({ title, code, pill }: { title: string; code?: string; pill?: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 bg-surface/90 px-gutter pb-3 pt-5 backdrop-blur">
      <button type="button" onClick={() => router.back()} aria-label="Back"
        className="fos-press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-card text-ink-900 shadow-fos-sm">
        <Icon name="back" size={20} strokeWidth={2} />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[20px] font-extrabold leading-6 text-ink-900">{title}</h1>
        {code && <p className="truncate font-mono text-[12px] font-semibold text-ink-500">{code}</p>}
      </div>
      {pill}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "jade" }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-ink-500">{label}</span>
      <span className={`font-bold tabular-nums ${tone === "jade" ? "text-tone-jade" : "text-ink-900"}`}>{value}</span>
    </div>
  );
}

/** Map thumbnail + address: the drop-off pin (with the shop) for delivery, the shop for pickup. */
function PlaceCard({ pickup, you, shopPoint, shop, shopName, address, name, phone, distanceKm }: {
  pickup: boolean; you: LatLng | null; shopPoint: LatLng | null; shop: ShopInfo | null; shopName: string;
  address?: string | null; name?: string | null; phone?: string | null; distanceKm?: number | null;
}) {
  const focus = pickup ? shopPoint : you;
  const src = focus ? staticMapUrl(focus, pickup ? null : shopPoint, "686x260") : null;
  return (
    <section className="overflow-hidden rounded-hero bg-card shadow-fos-sm">
      {focus && (
        <div className="relative h-[130px] bg-tint-map">
          {src && <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          {(pickup || !shopPoint) && (
            <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full drop-shadow" width="34" height="34" viewBox="0 0 24 24" aria-hidden>
              <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" fill={pickup ? "#103562" : "#FF7A1A"} /><circle cx="12" cy="9" r="2.6" fill="#fff" />
            </svg>
          )}
          {!pickup && distanceKm != null && (
            <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-[12px] font-extrabold text-ink-900 shadow-fos-sm">
              <Icon name="truck" size={13} strokeWidth={2.2} />{formatKm(Number(distanceKm))} from {shopName}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-3 p-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-surface text-navy-700">
          <Icon name={pickup ? "store" : "pin"} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-extrabold text-ink-900">{pickup ? `Pick up at ${shopName}` : name || "Delivery"}</div>
          <div className="line-clamp-2 text-caption text-ink-500">
            {pickup ? shop?.address || "Shop address not set" : address || "No address"}
            {!pickup && phone ? ` · ${phone}` : ""}
          </div>
        </div>
        {pickup && shop?.phone && (
          <a href={`tel:${shop.phone}`} aria-label={`Call ${shopName}`}
            className="fos-press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-tint-jade text-tone-jade">
            <Icon name="phone" size={18} />
          </a>
        )}
      </div>
    </section>
  );
}
