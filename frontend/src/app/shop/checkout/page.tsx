"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useCart } from "@/providers/CartProvider";
import { EmptyState, KhqrCard, PaidSuccess, Pill, Skeleton } from "@/components/shop";
import type { KhqrData } from "@/components/shop/Khqr";
import { fetchQuote, money, savePromo, savedPromoFor, type CartQuote, type DeliveryChoice } from "@/lib/quote";
import { deleteAddress, listAddresses, saveAddress, type SavedAddress } from "@/lib/addresses";
import { distanceKm, staticMapUrl, formatEta, formatKm, getCurrentPosition, type LatLng } from "@/lib/mapbox";
import { describePoint, placeLabel } from "@/lib/places";
import type { PickedLocation, Zone } from "@/components/map/LocationPicker";
import { Icon, type IconName } from "@/components/shop/Icon";
import { formatKhr } from "@/lib/currency";
import { areaName, useHomeLocation } from "@/lib/useHomeLocation";
import { haptic, useMainButton } from "@/lib/telegram";

// Same look as the map's own loading state, so there is no flash of an empty box
// Full-screen picker (search places or move the map); nothing to show until it opens
const LocationPicker = dynamic(() => import("@/components/map/LocationPicker"), { ssr: false });

interface ShopInfo {
  id: number;
  name: string;
  logo_url?: string | null;
  icon_emoji?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  delivery_radius_km?: number | null;
}

const ICON = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ADDRESS_LABELS: { label: string; icon: IconName }[] = [
  { label: "Home", icon: "home" },
  { label: "Work", icon: "work" },
  { label: "Room", icon: "room" },
  { label: "Other", icon: "pin" },
];

function labelIcon(label: string): IconName {
  return ADDRESS_LABELS.find((l) => l.label.toLowerCase() === label.trim().toLowerCase())?.icon ?? "pin";
}

export default function CheckoutPage() {
  return <Suspense><CheckoutContent /></Suspense>;
}

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { items, loading: cartLoading, fetchCart } = useCart();

  // One shop per checkout (?shop=id): only its items, its own delivery fee and its own order.
  // Without the param a single-shop cart checks out that shop; several shops go back to the cart to pick one.
  const cartShopIds = Array.from(new Set(items.map((i) => i.merchant_id).filter((id): id is number => id != null)));
  const asked = Number(searchParams.get("shop")) || null;
  const merchantId = asked ?? (cartShopIds.length === 1 ? cartShopIds[0] : null);
  const shopItems = merchantId == null ? [] : items.filter((i) => i.merchant_id === merchantId);
  const itemsTotal = shopItems.reduce((n, i) => n + Number(i.line_total ?? 0), 0);
  useEffect(() => {
    if (!asked && !cartLoading && cartShopIds.length > 1) router.replace("/shop/cart");
  }, [asked, cartLoading, cartShopIds.length, router]);
  const home = useHomeLocation(!!user);

  const [paying, setPaying] = useState(false); // KHQR screen
  const [paid, setPaid] = useState(false); // every QR order paid: the success moment before the order page
  const [paidSummary, setPaidSummary] = useState<{ amount: number | null; eta: string | null }>({ amount: null, eta: null });
  const [form, setForm] = useState({ name: "", phone: "", address: "", note: "" });
  const [payment, setPayment] = useState<"cod" | "khqr">("cod");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [khqrData, setKhqrData] = useState<KhqrData | null>(null);
  const [khqrTimer, setKhqrTimer] = useState(900);
  const [qrOrderIds, setQrOrderIds] = useState<number[]>([]);
  const [qrIndex, setQrIndex] = useState(0);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState("");
  const orderId = qrOrderIds[qrIndex] ?? null;
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [deliveryType, setDeliveryType] = useState<"delivery" | "pickup">("delivery");
  const [pin, setPin] = useState<LatLng | null>(null);
  /** The place under the pin, for the preview card: "AEON Mall 1" + its address */
  const [place, setPlace] = useState<{ name: string; address: string } | null>(null);
  /** House no., floor, gate — added in front of the place in delivery_address */
  const [details, setDetails] = useState("");
  const [saved, setSaved] = useState<SavedAddress[]>([]);
  // "Save address" panel: pick a label, then save the current pin right away
  const [newOpen, setNewOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("Home");
  const [customLabel, setCustomLabel] = useState("");
  const [savingAddr, setSavingAddr] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [mapOpen, setMapOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const initialPinSet = useRef(false);
  const quoteReq = useRef(0);
  const contactRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLDivElement>(null);

  // The shop being checked out: its name, pickup address and map pin
  useEffect(() => {
    if (merchantId == null) { setShop(null); return; }
    api.get<ShopInfo>(`/merchants/${merchantId}`).then(setShop).catch(() => setShop(null));
  }, [merchantId]);
  const shopPoint: LatLng | null = shop?.latitude != null && shop?.longitude != null ? { lat: Number(shop.latitude), lng: Number(shop.longitude) } : null;

  const choice: DeliveryChoice = deliveryType === "pickup"
    ? { delivery_type: "pickup" }
    : { delivery_type: "delivery", lat: pin?.lat, lng: pin?.lng };

  // Backend price for this shop's cart — identical to what placing the order charges
  useEffect(() => {
    if (!user || merchantId == null || shopItems.length === 0 || paying) return;
    const code = savedPromoFor(merchantId);
    // Only the latest request may update the page — an older one (e.g. priced
    // before the pin was set) can come back last on a slow connection.
    const req = ++quoteReq.current;
    // Drop the old price at once: until the new quote lands the total shows "…" and Place order waits
    setQuote(null);
    setQuoteError("");
    fetchQuote(code, choice, merchantId)
      .then((q) => {
        if (req !== quoteReq.current) return;
        setQuote(q);
        setQuoteError(q.promo && !q.promo.applied ? (q.promo.error || "Promo code not valid") : "");
        if (q.promo && !q.promo.applied) savePromo(null);
      })
      .catch((err: unknown) => {
        if (req !== quoteReq.current) return;
        setQuote(null);
        const msg = (err instanceof Error && err.message) || "Could not calculate the total. Please go back and try again.";
        setQuoteError(msg.replace(/^Delivery unavailable for this location\.\s*/, ""));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, items, merchantId, paying, deliveryType, pin?.lat, pin?.lng]);

  useEffect(() => {
    if (!user) return;
    listAddresses().then(setSaved).catch(() => {});
  }, [user]);

  // Start from the same place the cart priced: the Home location, else the default saved address
  useEffect(() => {
    if (initialPinSet.current || !home.resolved) return;
    initialPinSet.current = true;
    const loc = home.location;
    if (!loc) return;
    setPin({ lat: loc.lat, lng: loc.lng });
    const match = saved.find((a) => a.latitude === loc.lat && a.longitude === loc.lng);
    if (match) setPlace({ name: match.label, address: match.address });
    else describePoint(loc).then((d) => setPlace((cur) => cur ?? d)).catch(() => {});
  }, [home.resolved, home.location, saved]);

  // The saved address's text arrives after the pin when the list loads second
  useEffect(() => {
    if (!pin) return;
    const match = saved.find((a) => a.latitude === pin.lat && a.longitude === pin.lng);
    if (match) setPlace((cur) => (cur && cur.name === match.label ? cur : { name: match.label, address: match.address }));
  }, [saved, pin]);

  /** New pin: also becomes the Home location, so Home and Cart show the same distance next time. */
  function movePin(p: LatLng, where: { name: string; address: string }) {
    setPin(p);
    setPlace(where);
    home.save({ lat: p.lat, lng: p.lng, area: where.name.length <= 24 ? where.name : areaName(where.address) });
  }

  function confirmPicked(loc: PickedLocation) {
    movePin(loc.pos, { name: loc.name, address: loc.address });
    setDetails("");
    setMapOpen(false);
  }

  /** Delivery check for the picker's preview card — the backend's own quote, so it matches checkout. */
  async function zoneAt(pos: LatLng): Promise<Zone | null> {
    try {
      const q = await fetchQuote(merchantId != null ? savedPromoFor(merchantId) : null, { delivery_type: "delivery", lat: pos.lat, lng: pos.lng }, merchantId ?? undefined);
      const fee = Number(q.totals.delivery_fee);
      const one = q.orders[0] ?? null;
      const parts = [
        one?.distance_km != null ? formatKm(Number(one.distance_km)) : null,
        fee > 0 ? `${money(fee)} delivery` : "Free delivery",
        one?.eta_minutes != null && one.eta_max_minutes != null ? formatEta(one.eta_minutes, one.eta_max_minutes) : null,
      ].filter(Boolean);
      return { ok: true, text: `Delivers here · ${parts.join(" · ")}` };
    } catch (e) {
      const msg = (e instanceof Error && e.message) || "";
      return { ok: false, text: msg.replace(/^Delivery unavailable for this location\.\s*/, "") || "Outside the delivery area" };
    }
  }

  async function useMyLocation() {
    setLocating(true); setLocError(false);
    const p = await getCurrentPosition();
    if (!p) { setLocating(false); setLocError(true); haptic("error"); return; }
    haptic("success");
    const where = await describePoint(p).catch(() => ({ name: "My location", address: "" }));
    movePin(p, where);
    setDetails("");
    setLocating(false);
  }

  function pickSaved(a: SavedAddress) {
    haptic("select");
    movePin({ lat: a.latitude, lng: a.longitude }, { name: a.label, address: a.address });
    setDetails("");
    setMapOpen(false);
  }

  function startNewAddress() {
    haptic("select");
    const used = new Set(saved.map((a) => a.label.toLowerCase()));
    setNewLabel(ADDRESS_LABELS.find((l) => l.label !== "Other" && !used.has(l.label.toLowerCase()))?.label ?? "Other");
    setCustomLabel("");
    setSaveErr("");
    setNewOpen(true);
    setMapOpen(true);
  }

  async function saveNewAddress() {
    if (!pin) { setSaveErr("Choose the place first"); return; }
    const label = newLabel === "Other" ? customLabel.trim() : newLabel;
    if (!label) { setSaveErr("Give this place a name"); return; }
    setSavingAddr(true); setSaveErr("");
    try {
      const row = await saveAddress({
        label, address: place ? placeLabel(place, details) : "Pinned location",
        latitude: pin.lat, longitude: pin.lng, is_default: saved.length === 0,
      });
      setSaved((rows) => [...rows, row]);
      setNewOpen(false);
      setMapOpen(false);
      haptic("success");
    } catch (e) {
      setSaveErr((e instanceof Error && e.message) || "Couldn't save this address");
    } finally {
      setSavingAddr(false);
    }
  }

  async function removeSaved(id: number) {
    try { await deleteAddress(id); setSaved((rows) => rows.filter((a) => a.id !== id)); } catch { /* keep the chip */ }
  }

  function removePromo() {
    savePromo(null);
    const req = ++quoteReq.current;
    fetchQuote(null, choice, merchantId ?? undefined).then((q) => { if (req === quoteReq.current) setQuote(q); }).catch(() => {});
  }

  useEffect(() => {
    if (user && "first_name" in user) {
      const u = user as { first_name?: string; last_name?: string; username?: string; phone?: string };
      const phone = (u.phone || "").replace(/\D/g, "").replace(/^855/, "");
      setForm((f) => ({ ...f, name: `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username || "", phone }));
    }
  }, [user]);

  useEffect(() => {
    if (paying && khqrTimer > 0) {
      const id = setInterval(() => setKhqrTimer((t) => t - 1), 1000);
      return () => clearInterval(id);
    }
  }, [paying, khqrTimer]);

  // Poll PayWay status (via backend) while the QR is on screen
  useEffect(() => {
    if (!paying || !orderId || !khqrData) return;
    let stopped = false;
    const id = setInterval(async () => {
      try {
        const res = await api.get<{ data: { payment_status: string } }>(`/payments/payway/orders/${orderId}/status`);
        if (!stopped && res.data?.payment_status === "paid") {
          stopped = true;
          clearInterval(id);
          handlePaid();
        }
      } catch { /* keep polling */ }
    }, 4000);
    return () => { stopped = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paying, orderId, khqrData]);

  async function loadQr(oid: number) {
    setQrLoading(true); setQrError(""); setKhqrData(null);
    try {
      const qr = await api.post<{ data: KhqrData }>(`/payments/payway/orders/${oid}/qr`);
      if (qr.data?.payment_status === "paid") { handlePaid(); return; }
      setKhqrData(qr.data);
      setKhqrTimer(qr.data?.expires_in || 900);
    } catch (err: unknown) {
      setQrError((err instanceof Error && err.message) || "Failed to generate QR");
    } finally { setQrLoading(false); }
  }

  function handlePaid() {
    haptic("success");
    const next = qrIndex + 1;
    if (next < qrOrderIds.length) {
      setQrIndex(next);
      loadQr(qrOrderIds[next]);
    } else {
      setPaid(true);
    }
  }

  /** Reasons the server would refuse this cart — shown up front so checkout is blocked, not surprised. */
  const blockers: string[] = (quote?.orders ?? []).flatMap((o) => {
    const who = shop?.name || "This shop";
    const out: string[] = [];
    if (!o.is_open) out.push(`${who} is closed right now`);
    if (o.min_order_amount && Number(o.subtotal) < Number(o.min_order_amount)) {
      out.push(`${who} minimum is ${money(o.min_order_amount)} — add ${money(Number(o.min_order_amount) - Number(o.subtotal))}`);
    }
    return out;
  });

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Enter your name";
    if (form.phone.length < 8) e.phone = "Enter a valid phone number";
    if (deliveryType === "delivery" && !pin) e.address = "Choose your location";
    else if (deliveryType === "delivery" && !place) e.address = "Choose your location";
    if (deliveryType === "delivery" && !quote && quoteError) e.address = quoteError;
    setErrors(e);
    const ok = Object.keys(e).length === 0 && blockers.length === 0;
    if (!ok) {
      haptic("error");
      (e.name || e.phone ? contactRef : addressRef).current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return ok;
  }

  async function handlePlaceOrder() {
    if (!validate()) return;
    setPlacing(true); setOrderError("");
    try {
      if (merchantId == null) {
        setOrderError("Cannot place order: no shop selected.");
        return;
      }
      const res = await api.post<{ data: { order_id: number } }>("/orders", {
        merchant_id: merchantId,
        delivery_type: deliveryType,
        delivery_address: deliveryType === "pickup" ? "Pickup at shop" : place ? placeLabel(place, details) : "Pinned location",
        lat: deliveryType === "delivery" ? pin?.lat : undefined,
        lng: deliveryType === "delivery" ? pin?.lng : undefined,
        delivery_phone: "+855" + form.phone,
        delivery_name: form.name,
        customer_note: form.note,
        payment_method: payment,
        // The total the customer was shown; the server refuses if it has moved since
        expected_total: quote?.orders[0]?.total,
        promo_code: quote?.promo?.applied ? quote.promo.code : undefined,
      });
      // Only this shop's items leave the cart; a code saved for another shop stays for its checkout
      if (quote?.promo?.applied) savePromo(null);
      await fetchCart();
      const oid = res?.data?.order_id;

      haptic("success");
      if (payment === "khqr" && oid) {
        setQrOrderIds([oid]);
        setQrIndex(0);
        const one = quote?.orders[0] ?? null;
        setPaidSummary({
          amount: quote ? Number(quote.totals.total) : null,
          eta: deliveryType === "delivery" && one?.eta_minutes != null && one.eta_max_minutes != null ? formatEta(one.eta_minutes, one.eta_max_minutes) : null,
        });
        setPaying(true);
        window.scrollTo({ top: 0 });
        loadQr(oid);
      } else {
        router.replace(oid ? `/shop/order/${oid}?placed=true` : "/shop/orders");
      }
    } catch (err: unknown) {
      haptic("error");
      setOrderError((err instanceof Error && err.message) || "Order failed");
      // A moved price (409) or a closed shop: refresh what the customer sees
      const req = ++quoteReq.current;
      fetchQuote(savedPromoFor(merchantId!), choice, merchantId ?? undefined).then((q) => { if (req === quoteReq.current) setQuote(q); }).catch(() => {});
    } finally { setPlacing(false); }
  }

  const qt = quote?.totals;
  const grand = qt ? Number(qt.total) : itemsTotal;
  const ctaLabel = placing ? "Placing order…" : payment === "khqr" ? `Pay ${money(grand)}` : `Place order · ${money(grand)}`;
  const ctaDisabled = placing || !quote || blockers.length > 0;
  const inTelegram = useMainButton({
    text: ctaLabel,
    onClick: handlePlaceOrder,
    disabled: ctaDisabled,
    loading: placing,
    visible: !paying && !mapOpen && !!user && shopItems.length > 0,
  });

  if (paid) {
    return (
      <PaidSuccess amount={paidSummary.amount} eta={paidSummary.eta}
        note={qrOrderIds.length > 1 ? `${qrOrderIds.length} orders paid` : undefined}
        onDone={() => router.replace(`/shop/order/${qrOrderIds[0]}?placed=true`)} />
    );
  }

  if (paying) {
    return (
      <KhqrScreen
        data={khqrData} loading={qrLoading} error={qrError} timer={khqrTimer}
        index={qrIndex} count={qrOrderIds.length}
        onRetry={() => orderId && loadQr(orderId)}
        onLater={() => router.push("/shop/orders")}
      />
    );
  }

  // Choosing a location: the picker is the whole screen — no checkout title, bar or Telegram button behind it
  if (mapOpen) {
    return (
      <LocationPicker
        initial={pin ? { pos: pin, name: place?.name, address: place?.address } : home.location ? { pos: { lat: home.location.lat, lng: home.location.lng } } : null}
        shop={shopPoint} shopInfo={shop} radiusKm={shop?.delivery_radius_km ?? null}
        zone={zoneAt}
        suggestions={saved.map((a) => ({ id: a.id, name: a.label, address: a.address, pos: { lat: a.latitude, lng: a.longitude }, icon: labelIcon(a.label) }))}
        onConfirm={confirmPicked}
        onClose={() => { setMapOpen(false); setNewOpen(false); }}
      />
    );
  }

  if (!user || shopItems.length === 0) {
    return (
      <div className="min-h-screen bg-surface px-gutter pt-6">
        <TopBar onBack={() => router.back()} />
        <EmptyState className="mt-10" title="Your cart is empty" body="Pick something from a nearby shop and it will wait here." action={{ label: "Browse shops", href: "/shop" }} />
      </div>
    );
  }

  const deliveryFee = Number(qt?.delivery_fee ?? 0);
  const discount = Number(qt?.discount ?? 0);
  const single = quote?.orders[0] ?? null;
  const km = single?.distance_km != null ? Number(single.distance_km) : pin && shopPoint ? distanceKm(pin, shopPoint) : null;
  const eta = single?.eta_minutes != null && single.eta_max_minutes != null ? formatEta(single.eta_minutes, single.eta_max_minutes) : null;
  const outOfArea = deliveryType === "delivery" && !!pin && !quote && !!quoteError;
  // Progress: details → payment → pay
  const contactDone = !!form.name.trim() && form.phone.length >= 8;
  const whereDone = deliveryType === "pickup" || (!!pin && !!place && !outOfArea);
  const progress = contactDone && whereDone ? 2 : 1;

  return (
    <div className="min-h-screen bg-surface">
      <div className="px-gutter pb-[132px] pt-4">
        <TopBar onBack={() => router.back()} shopName={shop?.name} />
        <div className="mt-3 flex gap-1.5" aria-label={`Step ${progress} of 3`}>
          {[1, 2, 3].map((s) => (
            <i key={s} className={`block h-1 flex-1 rounded-sm transition-colors duration-300 ${s <= progress ? "bg-navy-700" : "bg-line"}`} />
          ))}
        </div>

        {/* Delivery / pickup */}
        <div role="radiogroup" aria-label="Delivery method" className="mt-4 grid grid-cols-2 gap-1.5 rounded-card bg-card p-1.5 shadow-fos-sm">
          {([["delivery", "Delivery", eta ?? "To your door"], ["pickup", "Pickup", "Free · at the shop"]] as const).map(([key, title, sub]) => {
            const on = deliveryType === key;
            return (
              <button key={key} type="button" role="radio" aria-checked={on} onClick={() => { haptic("select"); setDeliveryType(key); }}
                className={`fos-press flex h-[52px] flex-col items-center justify-center rounded-[15px] ${on ? "bg-navy-700 text-white" : "text-ink-900"}`}>
                <span className="text-[14px] font-extrabold">{title}</span>
                <small className={`text-[11px] font-semibold ${on ? "text-white/75" : "text-ink-500"}`}>{sub}</small>
              </button>
            );
          })}
        </div>

        {/* Where */}
        <div ref={addressRef}>
          {deliveryType === "delivery" ? (
            <section className="mt-3 overflow-hidden rounded-hero bg-card shadow-fos-sm">
              <MapPreview pin={pin} shop={shopPoint} km={km} eta={eta} outOfArea={outOfArea} onOpen={() => setMapOpen(true)} />

              {/* Preview: the place, its address and whether the shop delivers there */}
              <button type="button" onClick={() => setMapOpen(true)} className="flex w-full items-start gap-3 px-3.5 pt-3 text-left">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-tint-mango text-mango-500">
                  <Icon name={labelIcon(saved.find((a) => a.latitude === pin?.lat && a.longitude === pin?.lng)?.label ?? "")} size={20} strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  {place ? (
                    <>
                      <span className="block truncate text-[15px] font-extrabold text-ink-900">{place.name}</span>
                      <span className="line-clamp-2 block text-caption text-ink-500">{place.address || "Pinned on the map"}</span>
                    </>
                  ) : pin ? (
                    <><span className="fos-shimmer block h-4 w-1/2 rounded" /><span className="fos-shimmer mt-1.5 block h-3 w-4/5 rounded" /></>
                  ) : (
                    <>
                      <span className="block text-[15px] font-extrabold text-ink-900">Where should we deliver?</span>
                      <span className="block text-caption text-ink-500">Search a place or drop a pin</span>
                    </>
                  )}
                  {pin && (
                    outOfArea ? (
                      <span className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-full bg-tint-ruby px-2.5 text-[11px] font-bold text-ruby-500"><Icon name="alert" size={12} strokeWidth={2.6} />Outside delivery area</span>
                    ) : quote ? (
                      <span className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-full bg-tint-jade px-2.5 text-[11px] font-bold text-tone-jade"><Icon name="check" size={12} strokeWidth={2.6} />
                        {`Delivers here${km != null ? ` · ${formatKm(km)}` : ""}`}
                      </span>
                    ) : (
                      <span className="mt-1.5 inline-flex h-6 items-center rounded-full bg-tint-neutral px-2.5 text-[11px] font-bold text-ink-500">Checking delivery…</span>
                    )
                  )}
                </span>
                <span className="mt-0.5 shrink-0 rounded-full bg-surface px-3 py-1.5 text-[12px] font-extrabold text-navy-700">{pin ? "Change" : "Choose"}</span>
              </button>
              {pin && (
                <div className="px-3.5 pt-2.5">
                  <input value={details} onChange={(e) => setDetails(e.target.value)} maxLength={120}
                    placeholder="House no., floor, gate (optional)" aria-label="House number, floor or gate"
                    className="h-11 w-full rounded-md bg-surface px-3 text-[14px] font-semibold text-ink-900 outline-none placeholder:font-medium placeholder:text-ink-500 focus:ring-2 focus:ring-navy-500" />
                </div>
              )}
              {errors.address && <p className="px-3.5 pt-1 text-caption text-ruby-500">{errors.address}</p>}
              {outOfArea && (
                <p className="px-3.5 pt-1 text-caption font-semibold text-ruby-500">{quoteError} · move the pin or choose Pickup</p>
              )}

              <div className="fos-no-scrollbar flex gap-2 overflow-x-auto px-3.5 pb-3.5 pt-3">
                <button type="button" onClick={useMyLocation} disabled={locating}
                  className="fos-press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface px-3 text-[12px] font-bold text-navy-700">
                  <Icon name="locate" size={14} strokeWidth={2.2} />{locating ? "Locating…" : "My location"}
                </button>
                {saved.map((a) => {
                  const on = pin?.lat === a.latitude && pin?.lng === a.longitude;
                  return (
                    <span key={a.id} className={`inline-flex h-8 shrink-0 items-center rounded-full text-[12px] font-bold ${on ? "bg-navy-700 text-white" : "bg-surface text-ink-900"}`}>
                      <button type="button" onClick={() => pickSaved(a)} className="inline-flex h-8 items-center gap-1.5 pl-3 pr-1.5"><Icon name={labelIcon(a.label)} size={14} strokeWidth={2.2} />{a.label}</button>
                      <button type="button" onClick={() => removeSaved(a.id)} aria-label={`Delete ${a.label}`} className={`grid h-8 place-items-center pl-0.5 pr-2.5 ${on ? "text-white/70" : "text-ink-500"}`}><Icon name="close" size={12} strokeWidth={2.4} /></button>
                    </span>
                  );
                })}
                <button type="button" onClick={startNewAddress} className="fos-press inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-dashed border-navy-500 px-3 text-[12px] font-bold text-navy-700"><Icon name="plus" size={14} strokeWidth={2.4} />New address</button>
              </div>
              {locError && <p className="px-3.5 pb-3 text-caption text-ruby-500">Couldn&apos;t get your location — allow access, or pick on the map</p>}

              {newOpen ? (
                <div className="border-t border-line px-3.5 py-3">
                  <p className="text-[13px] font-extrabold text-ink-900">Save this place as</p>
                  <p className="text-caption text-ink-500">{pin ? "Change the place if needed, then save." : "Choose the place first."}</p>
                  <div role="radiogroup" aria-label="Address label" className="mt-2.5 grid grid-cols-4 gap-2">
                    {ADDRESS_LABELS.map((l) => {
                      const on = newLabel === l.label;
                      return (
                        <button key={l.label} type="button" role="radio" aria-checked={on} onClick={() => { setNewLabel(l.label); setSaveErr(""); }}
                          className={`fos-press flex h-16 flex-col items-center justify-center gap-1 rounded-thumb border-[1.5px] text-[12px] font-bold ${on ? "border-navy-700 bg-tint-navy text-navy-700" : "border-line bg-card text-ink-500"}`}>
                          <Icon name={l.icon} size={20} />{l.label}
                        </button>
                      );
                    })}
                  </div>
                  {newLabel === "Other" && (
                    <input autoFocus value={customLabel} onChange={(e) => { setCustomLabel(e.target.value); setSaveErr(""); }} maxLength={40}
                      placeholder="Name it, e.g. Mom's house" aria-label="Address name"
                      className="mt-2 h-11 w-full rounded-md bg-surface px-3 text-[14px] font-semibold text-ink-900 outline-none placeholder:font-medium placeholder:text-ink-500" />
                  )}
                  {saveErr && <p className="pt-1.5 text-caption text-ruby-500">{saveErr}</p>}
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => { setNewOpen(false); setSaveErr(""); }}
                      className="fos-press h-11 flex-1 rounded-md bg-surface text-[14px] font-bold text-ink-500">Cancel</button>
                    <button type="button" onClick={saveNewAddress} disabled={savingAddr || !pin}
                      className="fos-press h-11 flex-[2] rounded-md bg-navy-700 text-[14px] font-bold text-white disabled:opacity-40">
                      {savingAddr ? "Saving…" : "Save address"}
                    </button>
                  </div>
                </div>
              ) : pin && !saved.some((a) => a.latitude === pin.lat && a.longitude === pin.lng) && (
                <button type="button" onClick={startNewAddress}
                  className="fos-press flex w-full items-center gap-2 border-t border-line px-3.5 py-3 text-left text-[13px] font-bold text-navy-700">
                  <Icon name="star" size={16} />Save this address for next time
                </button>
              )}
            </section>
          ) : (
            <section className="mt-3 flex items-center gap-3 rounded-hero bg-card p-3.5 shadow-fos-sm">
              <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-thumb bg-surface text-[22px]">
                {shop?.logo_url ? <img src={shop.logo_url} alt="" className="h-full w-full object-cover" /> : shop?.icon_emoji || <Icon name="store" size={22} className="text-navy-700" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-extrabold text-ink-900">{shop?.name || "The shop"}</div>
                <div className="truncate text-caption text-ink-500">{shop?.address || "The shop confirms the pickup point"}</div>
              </div>
              <Pill variant="jade">Free</Pill>
            </section>
          )}
        </div>

        {/* Contact */}
        <section ref={contactRef} className="mt-3 rounded-card bg-card p-3.5 shadow-fos-sm">
          <div className="flex gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" autoComplete="name"
                className={`h-11 w-full rounded-md bg-surface px-3 text-[14px] font-semibold text-ink-900 outline-none ${errors.name ? "ring-1 ring-ruby-500" : ""}`} />
            </label>
          </div>
          <div className={`mt-2 flex h-11 items-center rounded-md bg-surface ${errors.phone ? "ring-1 ring-ruby-500" : ""}`}>
            <span className="pl-3 pr-2 text-[14px] font-bold text-ink-500">+855</span>
            <input type="tel" inputMode="numeric" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").replace(/^0/, "") })}
              placeholder="12 345 678" aria-label="Phone" autoComplete="tel-national"
              className="h-11 min-w-0 flex-1 bg-transparent pr-3 text-[14px] font-semibold tabular-nums text-ink-900 outline-none" />
          </div>
          {(errors.name || errors.phone) && <p className="pt-1 text-caption text-ruby-500">{errors.name || errors.phone}</p>}
          {noteOpen || form.note ? (
            <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} placeholder="Note for the shop (gate code, floor…)" autoFocus={noteOpen && !form.note}
              className="mt-2 w-full resize-none rounded-md bg-surface p-3 text-[14px] text-ink-900 outline-none" />
          ) : (
            <button type="button" onClick={() => setNoteOpen(true)} className="mt-1 h-9 text-[13px] font-bold text-navy-700">+ Add a note</button>
          )}
        </section>

        {/* Payment */}
        <div role="radiogroup" aria-label="Payment" className="mt-3 flex flex-col gap-2">
          <PayOption on={payment === "khqr"} onPick={() => { haptic("select"); setPayment("khqr"); }}
            logo={<span className="grid h-10 w-10 place-items-center rounded-md bg-[#E1232E] text-[9px] font-extrabold tracking-tight text-white">KHQR</span>}
            title="ABA KHQR" sub="Any bank app" />
          <PayOption on={payment === "cod"} onPick={() => { haptic("select"); setPayment("cod"); }}
            logo={<span className="grid h-10 w-10 place-items-center rounded-md bg-jade-500 text-[18px] font-extrabold text-white">$</span>}
            title="Cash on delivery" sub={deliveryType === "pickup" ? "Pay at the shop" : "Pay the rider"} />
        </div>

        {/* Summary */}
        <section className="mt-3 rounded-card bg-card p-3.5 text-[14px] shadow-fos-sm tabular-nums">
          {/* Only this shop's items — other shops in the cart are separate orders */}
          <div className="mb-1.5 divide-y divide-line border-b border-line pb-1.5">
            {shopItems.map((i) => (
              <div key={i.id} className="flex items-baseline gap-2 py-1.5">
                <span className="shrink-0 font-bold text-ink-500">{i.quantity}×</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-ink-900">{i.product_name}</span>
                <span className="shrink-0 font-bold text-ink-900">{money(i.line_total)}</span>
              </div>
            ))}
          </div>
          <Row label={`Items · ${shopItems.reduce((n, i) => n + i.quantity, 0)}`} value={qt ? money(qt.subtotal) : money(itemsTotal)} />
          <Row
            label={deliveryType === "pickup" ? "Pickup" : `Delivery${km != null ? ` · ${formatKm(km)}` : ""}`}
            value={deliveryType === "delivery" && !pin ? "Choose location" : !qt ? "…" : deliveryFee === 0 ? "Free" : money(deliveryFee)}
            tone={qt && deliveryFee === 0 ? "jade" : undefined}
          />
          {discount > 0 && (
            <div className="flex items-center justify-between py-1 font-bold text-tone-jade">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{single?.promo_title ?? quote?.promo?.code ?? single?.promo_code}{single?.promo_auto ? " · applied automatically" : ""}</span>
                {!single?.promo_auto && <button type="button" onClick={removePromo} className="shrink-0 text-[12px] font-bold text-ruby-500">Remove</button>}
              </span>
              <span>−{money(discount)}</span>
            </div>
          )}
          <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-2.5">
            <span className="text-[16px] font-extrabold text-ink-900">Total</span>
            <span className="text-right">
              <span className="block text-[16px] font-extrabold text-ink-900">{qt ? money(qt.total) : "…"}</span>
              {qt && <span className="block text-[11px] text-ink-500">{formatKhr(Number(qt.total))}</span>}
            </span>
          </div>
        </section>

        {[...blockers, ...(orderError ? [orderError] : []), ...(quoteError && !outOfArea && quote ? [quoteError] : [])].map((m) => (
          <div key={m} role="alert" className="mt-3 rounded-card bg-tint-ruby px-3.5 py-3 text-[13px] font-bold text-ruby-500">{m}</div>
        ))}
      </div>

      {!inTelegram && (
        <div className="fixed inset-x-0 bottom-0 z-[90] border-t border-line bg-card/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="mx-auto max-w-[640px] px-gutter py-[21px]">
            <button type="button" onClick={handlePlaceOrder} disabled={ctaDisabled}
              className={`fos-press h-[52px] w-full rounded-thumb text-[16px] font-extrabold text-white disabled:opacity-50 ${payment === "khqr" ? "bg-grad-promo shadow-[0_10px_24px_rgba(184,134,43,.35)]" : "bg-grad-cta shadow-fos-cta"}`}>
              {ctaLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TopBar({ onBack, shopName }: { onBack: () => void; shopName?: string }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onBack} aria-label="Back" className="fos-press grid h-10 w-10 place-items-center rounded-full bg-card text-ink-900 shadow-fos-sm">
        <svg width="20" height="20" viewBox="0 0 24 24" {...ICON} strokeWidth={2} aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <div className="min-w-0">
        <h1 className="text-[22px] font-extrabold leading-7 text-ink-900">Checkout</h1>
        {shopName && <p className="truncate text-caption text-ink-500">{shopName}</p>}
      </div>
    </div>
  );
}

/**
 * Address card map. With the shop's location known it frames both pins (you in
 * mango, the shop in navy) so the distance chip has something to point at;
 * otherwise it centres on your pin with a pulse.
 */
function MapPreview({ pin, shop, km, eta, outOfArea, onOpen }: {
  pin: LatLng | null; shop: LatLng | null; km: number | null; eta: string | null; outOfArea: boolean; onOpen: () => void;
}) {
  const framed = !!pin && !!shop && !outOfArea;
  const src = pin ? staticMapUrl(pin, framed ? shop : null) : null;
  return (
    <button type="button" onClick={onOpen} aria-label="Edit location on map" className="group relative block h-[150px] w-full overflow-hidden bg-tint-map">
      {src && <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      {pin ? (
        <>
          {!framed && (
            <>
              <span className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-mango-500/25 motion-reduce:animate-none" aria-hidden />
              <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full drop-shadow" width="36" height="36" viewBox="0 0 24 24" aria-hidden>
                <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" fill="#B8862B" /><circle cx="12" cy="9" r="2.6" fill="#fff" />
              </svg>
            </>
          )}
          {(km != null || outOfArea) && (
            <span className={`absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-extrabold shadow-fos-sm ${outOfArea ? "bg-ruby-500 text-white" : "bg-card text-ink-900"}`}>
              {outOfArea ? <><Icon name="alert" size={13} strokeWidth={2.4} />Outside delivery area</> : <><Icon name="truck" size={13} strokeWidth={2.2} />{formatKm(km!)}{eta ? ` · ${eta}` : ""}</>}
            </span>
          )}
          <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-card/95 px-2.5 py-1 text-[11px] font-extrabold text-navy-700 shadow-fos-sm transition-transform group-active:scale-95">
            <Icon name="edit" size={12} strokeWidth={2.4} />Adjust pin
          </span>
        </>
      ) : (
        <span className="absolute inset-0 grid place-items-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-4 py-2 text-[13px] font-extrabold text-navy-700 shadow-fos-md"><Icon name="pin" size={16} />Choose your location</span>
        </span>
      )}
    </button>
  );
}

function PayOption({ on, onPick, logo, title, sub }: { on: boolean; onPick: () => void; logo: React.ReactNode; title: string; sub: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onPick}
      className={`fos-press flex h-16 w-full items-center gap-3 rounded-card bg-card px-3 text-left shadow-fos-sm ${on ? "ring-2 ring-navy-700" : ""}`}>
      {logo}
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-extrabold text-ink-900">{title}</span>
        <span className="block truncate text-caption text-ink-500">{sub}</span>
      </span>
      <span className={`h-[22px] w-[22px] shrink-0 rounded-full border-2 ${on ? "border-[7px] border-navy-700" : "border-line"}`} aria-hidden />
    </button>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "jade" }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-ink-500">{label}</span>
      <span className={`font-bold ${tone === "jade" ? "text-tone-jade" : "text-ink-900"}`}>{value}</span>
    </div>
  );
}

/** Full-screen KHQR on the navy hero: the shared KHQR card, which polls until paid. */
function KhqrScreen({ data, loading, error, timer, index, count, onRetry, onLater }: {
  data: KhqrData | null; loading: boolean; error: string; timer: number; index: number; count: number;
  onRetry: () => void; onLater: () => void;
}) {
  return (
    <div className="min-h-screen bg-grad-hero px-gutter pb-10 pt-6 text-white">
      <h1 className="text-center text-[20px] font-extrabold">Scan to pay</h1>
      <p className="mt-1 text-center text-caption text-white/70">
        {count > 1 ? `Order ${index + 1} of ${count}${data?.order_code ? ` · ${data.order_code}` : ""}` : "ABA Mobile or any KHQR bank app"}
      </p>
      {count > 1 && (
        <div className="mx-auto mt-3 flex max-w-[200px] gap-1.5" aria-hidden>
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className={`h-1 flex-1 rounded-full ${i < index ? "bg-jade-500" : i === index ? "bg-card" : "bg-white/25"}`} />
          ))}
        </div>
      )}

      <div className="mt-5">
        <KhqrCard data={data} loading={loading} error={error} timer={timer} onRetry={onRetry} />
      </div>

      <p className="mx-auto mt-4 flex max-w-[340px] items-center justify-center gap-1.5 text-center text-caption text-white/70">
        <Icon name="lock" size={14} />Paid securely through ABA PayWay
      </p>
      <button type="button" onClick={onLater} className="fos-press mx-auto mt-3 block h-[52px] w-full max-w-[340px] rounded-thumb bg-white/10 text-[15px] font-bold text-white">
        Pay later
      </button>
    </div>
  );
}
