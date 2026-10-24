"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useCart } from "@/providers/CartProvider";
import { EmptyState, Pill, Skeleton } from "@/components/shop";
import { fetchQuote, getSavedPromo, money, savePromo, type CartQuote, type DeliveryChoice } from "@/lib/quote";
import { deleteAddress, listAddresses, saveAddress, type SavedAddress } from "@/lib/addresses";
import { MAPBOX_TOKEN, distanceKm, formatEta, formatKm, getCurrentPosition, reverseGeocode, type LatLng } from "@/lib/mapbox";
import { Icon, type IconName } from "@/components/shop/Icon";
import { formatKhr } from "@/lib/currency";
import { areaName, useHomeLocation } from "@/lib/useHomeLocation";
import { haptic, useMainButton } from "@/lib/telegram";

// Same look as the map's own loading state, so there is no flash of an empty box
const MapPicker = dynamic(() => import("@/components/map/MapPicker"), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] rounded-card" />,
});

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

interface KhqrData {
  qr_image?: string;
  amount?: string | number;
  deeplink?: string;
  order_code?: string;
  expires_in?: number;
  payment_status?: string;
}

const ICON = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Static map image for the address card — no map library needed for a preview. */
const ADDRESS_LABELS: { label: string; icon: IconName }[] = [
  { label: "Home", icon: "home" },
  { label: "Work", icon: "work" },
  { label: "Room", icon: "room" },
  { label: "Other", icon: "pin" },
];

function labelIcon(label: string): IconName {
  return ADDRESS_LABELS.find((l) => l.label.toLowerCase() === label.trim().toLowerCase())?.icon ?? "pin";
}

function staticMapUrl(p: LatLng) {
  if (!MAPBOX_TOKEN) return null;
  const at = `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;
  return `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/${at},15,0/686x300@2x?attribution=false&logo=false&access_token=${MAPBOX_TOKEN}`;
}

export default function CheckoutPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { items, total, fetchCart } = useCart();
  const home = useHomeLocation(!!user);

  const [paying, setPaying] = useState(false); // KHQR screen
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

  // A single-shop cart can show that shop on the map; with several shops there is no one place to draw
  const merchantKey = Array.from(new Set(items.map((i) => i.merchant_id).filter(Boolean))).join(",");
  useEffect(() => {
    if (!merchantKey || merchantKey.includes(",")) { setShop(null); return; }
    api.get<ShopInfo>(`/merchants/${merchantKey}`).then(setShop).catch(() => setShop(null));
  }, [merchantKey]);
  const shopPoint: LatLng | null = shop?.latitude != null && shop?.longitude != null ? { lat: Number(shop.latitude), lng: Number(shop.longitude) } : null;

  const choice: DeliveryChoice = deliveryType === "pickup"
    ? { delivery_type: "pickup" }
    : { delivery_type: "delivery", lat: pin?.lat, lng: pin?.lng };

  // Backend price for the cart — identical to what placing the order charges
  useEffect(() => {
    if (!user || items.length === 0 || paying) return;
    const code = getSavedPromo();
    // Only the latest request may update the page — an older one (e.g. priced
    // before the pin was set) can come back last on a slow connection.
    const req = ++quoteReq.current;
    fetchQuote(code, choice)
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
  }, [user, items, paying, deliveryType, pin?.lat, pin?.lng]);

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
    if (match) setForm((f) => ({ ...f, address: match.address }));
    else reverseGeocode(loc).then((addr) => addr && setForm((f) => (f.address ? f : { ...f, address: addr }))).catch(() => {});
  }, [home.resolved, home.location, saved]);

  // The saved address's text arrives after the pin when the list loads second
  useEffect(() => {
    if (!pin || form.address) return;
    const match = saved.find((a) => a.latitude === pin.lat && a.longitude === pin.lng);
    if (match) setForm((f) => ({ ...f, address: match.address }));
  }, [saved, pin, form.address]);

  /** New pin: also becomes the Home location, so Home and Cart show the same distance next time. */
  function movePin(p: LatLng, addr?: string) {
    setPin(p);
    if (addr) setForm((f) => ({ ...f, address: addr }));
    home.save({ lat: p.lat, lng: p.lng, area: addr ? areaName(addr) : "Pinned location" });
  }

  async function useMyLocation() {
    setLocating(true); setLocError(false);
    const p = await getCurrentPosition();
    if (!p) { setLocating(false); setLocError(true); haptic("error"); return; }
    haptic("success");
    const addr = await reverseGeocode(p).catch(() => "");
    movePin(p, addr || undefined);
    setLocating(false);
  }

  function pickSaved(a: SavedAddress) {
    haptic("select");
    movePin({ lat: a.latitude, lng: a.longitude }, a.address);
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
    if (!pin) { setSaveErr("Drop a pin on the map first"); return; }
    const label = newLabel === "Other" ? customLabel.trim() : newLabel;
    if (!label) { setSaveErr("Give this place a name"); return; }
    setSavingAddr(true); setSaveErr("");
    try {
      const row = await saveAddress({
        label, address: form.address.trim() || "Pinned location",
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
    fetchQuote(null, choice).then((q) => { if (req === quoteReq.current) setQuote(q); }).catch(() => {});
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
      router.replace(`/shop/order/${qrOrderIds[0]}?placed=true`);
    }
  }

  /** Reasons the server would refuse this cart — shown up front so checkout is blocked, not surprised. */
  const blockers: string[] = (quote?.orders ?? []).flatMap((o) => {
    const who = (quote!.orders.length > 1 ? `Shop #${o.merchant_id}` : shop?.name) || "This shop";
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
    else if (deliveryType === "delivery" && !form.address.trim()) e.address = "Add an address or landmark";
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
      // Group cart items by merchant
      const byMerchant: Record<number, unknown[]> = {};
      items.forEach((item) => {
        const mid = item.merchant_id;
        if (mid) (byMerchant[mid] ||= []).push(item);
      });

      const merchantIds = Object.keys(byMerchant);
      if (merchantIds.length === 0) {
        setOrderError("Cannot place order: no merchant found for cart items.");
        return;
      }

      const results = await Promise.all(
        merchantIds.map((mid) =>
          api.post<{ data: { order_id: number } }>("/orders", {
            merchant_id: Number(mid),
            delivery_type: deliveryType,
            delivery_address: deliveryType === "pickup" ? "Pickup at shop" : form.address,
            lat: deliveryType === "delivery" ? pin?.lat : undefined,
            lng: deliveryType === "delivery" ? pin?.lng : undefined,
            delivery_phone: "+855" + form.phone,
            delivery_name: form.name,
            customer_note: form.note,
            payment_method: payment,
            // The total the customer was shown; the server refuses if it has moved since
            expected_total: quote?.orders.find((o) => o.merchant_id === Number(mid))?.total,
            // A promo code belongs to one shop — send it only with that shop's order
            promo_code: quote?.promo?.applied && quote.promo.merchant_id === Number(mid) ? quote.promo.code : undefined,
          }),
        ),
      );
      savePromo(null);
      await fetchCart();
      const oid = results[0]?.data?.order_id;

      haptic("success");
      if (payment === "khqr" && oid) {
        // One QR per shop order, paid one after another
        const ids = results.map((r) => r?.data?.order_id).filter(Boolean) as number[];
        setQrOrderIds(ids);
        setQrIndex(0);
        setPaying(true);
        window.scrollTo({ top: 0 });
        loadQr(ids[0]);
      } else {
        router.replace(oid ? `/shop/order/${oid}?placed=true` : "/shop/orders");
      }
    } catch (err: unknown) {
      haptic("error");
      setOrderError((err instanceof Error && err.message) || "Order failed");
      // A moved price (409) or a closed shop: refresh what the customer sees
      const req = ++quoteReq.current;
      fetchQuote(getSavedPromo(), choice).then((q) => { if (req === quoteReq.current) setQuote(q); }).catch(() => {});
    } finally { setPlacing(false); }
  }

  const qt = quote?.totals;
  const grand = qt ? Number(qt.total) : total;
  const ctaLabel = placing ? "Placing order…" : payment === "khqr" ? `Pay ${money(grand)}` : `Place order · ${money(grand)}`;
  const ctaDisabled = placing || !quote || blockers.length > 0;
  const inTelegram = useMainButton({
    text: ctaLabel,
    onClick: handlePlaceOrder,
    disabled: ctaDisabled,
    loading: placing,
    visible: !paying && !!user && items.length > 0,
  });

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

  if (!user || items.length === 0) {
    return (
      <div className="min-h-screen bg-surface px-gutter pt-6">
        <TopBar onBack={() => router.back()} />
        <EmptyState className="mt-10" title="Your cart is empty" action={{ label: "Start shopping", href: "/shop" }} />
      </div>
    );
  }

  const deliveryFee = Number(qt?.delivery_fee ?? 0);
  const discount = Number(qt?.discount ?? 0);
  const single = quote?.orders.length === 1 ? quote.orders[0] : null;
  const km = single?.distance_km != null ? Number(single.distance_km) : pin && shopPoint ? distanceKm(pin, shopPoint) : null;
  const eta = single?.eta_minutes != null && single.eta_max_minutes != null ? formatEta(single.eta_minutes, single.eta_max_minutes) : null;
  const multiShop = (quote?.orders.length ?? 0) > 1;
  const outOfArea = deliveryType === "delivery" && !!pin && !quote && !!quoteError;
  // Progress: details → payment → pay
  const contactDone = !!form.name.trim() && form.phone.length >= 8;
  const whereDone = deliveryType === "pickup" || (!!pin && !!form.address.trim() && !outOfArea);
  const progress = contactDone && whereDone ? 2 : 1;

  return (
    <div className="min-h-screen bg-surface">
      <div className="px-gutter pb-[132px] pt-4">
        <TopBar onBack={() => router.back()} />
        <div className="mt-3 flex gap-1.5" aria-label={`Step ${progress} of 3`}>
          {[1, 2, 3].map((s) => (
            <i key={s} className={`block h-1 flex-1 rounded-sm transition-colors duration-300 ${s <= progress ? "bg-navy-700" : "bg-line"}`} />
          ))}
        </div>

        {/* Delivery / pickup */}
        <div role="radiogroup" aria-label="Delivery method" className="mt-4 grid grid-cols-2 gap-1.5 rounded-card bg-white p-1.5 shadow-fos-sm">
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
            <section className="mt-3 overflow-hidden rounded-hero bg-white shadow-fos-sm">
              {mapOpen ? (
                <div className="p-2">
                  <MapPicker
                    value={pin}
                    onChange={(p, addr) => movePin(p, addr || undefined)}
                    shop={shopPoint}
                    shopInfo={shop}
                    radiusKm={shop?.delivery_radius_km ?? null}
                    showLocate={false}
                    height={260}
                  />
                </div>
              ) : (
                <MapPreview pin={pin} km={km} eta={eta} outOfArea={outOfArea} onOpen={() => setMapOpen(true)} />
              )}

              <div className="flex items-center gap-3 px-3.5 pt-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface text-navy-700"><Icon name={labelIcon(saved.find((a) => a.latitude === pin?.lat && a.longitude === pin?.lng)?.label ?? "")} /></span>
                <input
                  value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder={pin ? "Street, house no. or landmark" : "Choose your location"} aria-label="Delivery address"
                  className="h-11 min-w-0 flex-1 truncate bg-transparent text-[14px] font-bold text-ink-900 outline-none placeholder:font-semibold placeholder:text-ink-500"
                />
                <button type="button" onClick={() => setMapOpen((o) => !o)} aria-label={mapOpen ? "Done" : "Edit on map"}
                  className="fos-press grid h-9 min-w-9 place-items-center rounded-full bg-surface px-2 text-[12px] font-bold text-navy-700">
                  {mapOpen ? "Done" : <Icon name="edit" size={16} />}
                </button>
              </div>
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
                  <p className="text-caption text-ink-500">{pin ? "Move the pin on the map if needed, then save." : "Drop a pin on the map first."}</p>
                  <div role="radiogroup" aria-label="Address label" className="mt-2.5 grid grid-cols-4 gap-2">
                    {ADDRESS_LABELS.map((l) => {
                      const on = newLabel === l.label;
                      return (
                        <button key={l.label} type="button" role="radio" aria-checked={on} onClick={() => { setNewLabel(l.label); setSaveErr(""); }}
                          className={`fos-press flex h-16 flex-col items-center justify-center gap-1 rounded-thumb border-[1.5px] text-[12px] font-bold ${on ? "border-navy-700 bg-[#EEF3FC] text-navy-700" : "border-line bg-white text-ink-500"}`}>
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
            <section className="mt-3 flex items-center gap-3 rounded-hero bg-white p-3.5 shadow-fos-sm">
              <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-thumb bg-surface text-[22px]">
                {shop?.logo_url ? <img src={shop.logo_url} alt="" className="h-full w-full object-cover" /> : shop?.icon_emoji || <Icon name="store" size={22} className="text-navy-700" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-extrabold text-ink-900">{shop?.name || (multiShop ? `${quote!.orders.length} shops` : "The shop")}</div>
                <div className="truncate text-caption text-ink-500">{shop?.address || "The shop confirms the pickup point"}</div>
              </div>
              <Pill variant="jade">Free</Pill>
            </section>
          )}
        </div>

        {/* Contact */}
        <section ref={contactRef} className="mt-3 rounded-card bg-white p-3.5 shadow-fos-sm">
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
        <section className="mt-3 rounded-card bg-white p-3.5 text-[14px] shadow-fos-sm tabular-nums">
          <Row label={`Items · ${items.reduce((n, i) => n + i.quantity, 0)}`} value={qt ? money(qt.subtotal) : money(total)} />
          <Row
            label={deliveryType === "pickup" ? "Pickup" : `Delivery${km != null && !multiShop ? ` · ${formatKm(km)}` : ""}`}
            value={deliveryType === "delivery" && !pin ? "Choose location" : !qt ? "…" : deliveryFee === 0 ? "Free" : money(deliveryFee)}
            tone={qt && deliveryFee === 0 ? "jade" : undefined}
          />
          {discount > 0 && (
            <div className="flex items-center justify-between py-1 font-bold text-[#067647]">
              <span className="flex items-center gap-2">
                {quote?.promo?.code}
                <button type="button" onClick={removePromo} className="text-[12px] font-bold text-ruby-500">Remove</button>
              </span>
              <span>−{money(discount)}</span>
            </div>
          )}
          {multiShop && <p className="pb-1 text-[11px] text-ink-500">{quote!.orders.length} shops · each is a separate order with its own delivery fee</p>}
          <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-2.5">
            <span className="text-[16px] font-extrabold text-ink-900">Total</span>
            <span className="text-right">
              <span className="block text-[16px] font-extrabold text-ink-900">{qt ? money(qt.total) : "…"}</span>
              {qt && <span className="block text-[11px] text-ink-500">{formatKhr(Number(qt.total))}</span>}
            </span>
          </div>
        </section>

        {[...blockers, ...(orderError ? [orderError] : []), ...(quoteError && !outOfArea && quote ? [quoteError] : [])].map((m) => (
          <div key={m} role="alert" className="mt-3 rounded-card bg-[#FDECEC] px-3.5 py-3 text-[13px] font-bold text-ruby-500">{m}</div>
        ))}
      </div>

      {!inTelegram && (
        <div className="fixed inset-x-0 bottom-0 z-[90] border-t border-line bg-white/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="mx-auto max-w-[640px] px-gutter py-[21px]">
            <button type="button" onClick={handlePlaceOrder} disabled={ctaDisabled}
              className={`fos-press h-[52px] w-full rounded-thumb text-[16px] font-extrabold text-white disabled:opacity-50 ${payment === "khqr" ? "bg-grad-promo shadow-[0_10px_24px_rgba(255,122,26,.35)]" : "bg-grad-cta shadow-fos-cta"}`}>
              {ctaLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onBack} aria-label="Back" className="fos-press grid h-10 w-10 place-items-center rounded-full bg-white text-ink-900 shadow-fos-sm">
        <svg width="20" height="20" viewBox="0 0 24 24" {...ICON} strokeWidth={2} aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <h1 className="text-[22px] font-extrabold text-ink-900">Checkout</h1>
    </div>
  );
}

function MapPreview({ pin, km, eta, outOfArea, onOpen }: { pin: LatLng | null; km: number | null; eta: string | null; outOfArea: boolean; onOpen: () => void }) {
  const src = pin ? staticMapUrl(pin) : null;
  return (
    <button type="button" onClick={onOpen} aria-label="Edit location on map" className="relative block h-[150px] w-full overflow-hidden bg-[#E9EEF5]">
      {src && <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      {pin ? (
        <>
          <span className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-mango-500/25 motion-reduce:animate-none" aria-hidden />
          <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full drop-shadow" width="36" height="36" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" fill="#FF7A1A" /><circle cx="12" cy="9" r="2.6" fill="#fff" />
          </svg>
          {(km != null || outOfArea) && (
            <span className={`absolute bottom-2.5 left-2.5 rounded-full px-2.5 py-1 text-[12px] font-extrabold shadow-fos-sm ${outOfArea ? "bg-ruby-500 text-white" : "bg-white text-ink-900"}`}>
              {outOfArea ? "Outside delivery area" : `${formatKm(km!)}${eta ? ` · ${eta}` : ""}`}
            </span>
          )}
        </>
      ) : (
        <span className="absolute inset-0 grid place-items-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] font-extrabold text-navy-700 shadow-fos-md"><Icon name="pin" size={16} />Choose your location</span>
        </span>
      )}
    </button>
  );
}

function PayOption({ on, onPick, logo, title, sub }: { on: boolean; onPick: () => void; logo: React.ReactNode; title: string; sub: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onPick}
      className={`fos-press flex h-16 w-full items-center gap-3 rounded-card bg-white px-3 text-left shadow-fos-sm ${on ? "ring-2 ring-navy-700" : ""}`}>
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
      <span className={`font-bold ${tone === "jade" ? "text-[#067647]" : "text-ink-900"}`}>{value}</span>
    </div>
  );
}

/** Full-screen KHQR: red-header card, QR, amount, countdown ring; polls until paid. */
function KhqrScreen({ data, loading, error, timer, index, count, onRetry, onLater }: {
  data: KhqrData | null; loading: boolean; error: string; timer: number; index: number; count: number;
  onRetry: () => void; onLater: () => void;
}) {
  const mmss = `${Math.floor(Math.max(timer, 0) / 60)}:${(Math.max(timer, 0) % 60).toString().padStart(2, "0")}`;
  const expired = timer <= 0;
  const C = 2 * Math.PI * 15;
  return (
    <div className="min-h-screen bg-grad-hero px-gutter pb-10 pt-6 text-white">
      <h1 className="text-center text-[20px] font-extrabold">Scan to pay</h1>
      <p className="mt-1 text-center text-caption text-white/70">
        {count > 1 ? `Order ${index + 1} of ${count}${data?.order_code ? ` · ${data.order_code}` : ""}` : "ABA Mobile or any KHQR bank app"}
      </p>

      <div className="mx-auto mt-5 max-w-[340px] overflow-hidden rounded-sheet bg-white text-ink-900 shadow-fos-lg">
        <div className="flex h-[34px] items-center justify-center bg-[#E1232E] text-[14px] font-extrabold tracking-wide text-white">KHQR</div>
        <div className="p-4">
          {loading ? (
            <Skeleton className="mx-auto h-[260px] w-[260px] rounded-thumb" />
          ) : data?.qr_image ? (
            <img src={data.qr_image} alt="KHQR code" className={`mx-auto h-[260px] w-[260px] object-contain transition-opacity ${expired ? "opacity-20" : ""}`} />
          ) : (
            <div className="grid h-[260px] place-items-center text-center text-[14px] font-bold text-ruby-500">{error || "Could not create the QR"}</div>
          )}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[26px] font-extrabold tabular-nums">{data?.amount != null ? `$${data.amount}` : "…"}</span>
            {data && (
              <span className={`flex items-center gap-1.5 text-[13px] font-extrabold tabular-nums ${expired ? "text-ruby-500" : "text-ink-900"}`}>
                <svg width="28" height="28" viewBox="0 0 36 36" aria-hidden>
                  <circle cx="18" cy="18" r="15" fill="none" stroke="#E3E8EF" strokeWidth="4" />
                  <circle cx="18" cy="18" r="15" fill="none" stroke="#FF7A1A" strokeWidth="4" strokeLinecap="round" transform="rotate(-90 18 18)"
                    strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(timer, 0) / 900)} />
                </svg>
                {expired ? "Expired" : mmss}
              </span>
            )}
          </div>
          {data && !expired && <p className="mt-1 text-caption text-ink-500">Waiting for payment — this updates by itself</p>}
        </div>
      </div>

      <div className="mx-auto mt-5 flex max-w-[340px] flex-col gap-2.5">
        {data?.deeplink && !expired && (
          <a href={data.deeplink} className="fos-press flex h-[52px] items-center justify-center rounded-thumb bg-grad-promo text-[15px] font-extrabold text-white">Open ABA Mobile</a>
        )}
        {(expired || (!data && !loading)) && (
          <button type="button" onClick={onRetry} className="fos-press h-[52px] rounded-thumb bg-white text-[15px] font-extrabold text-navy-700">New QR</button>
        )}
        <button type="button" onClick={onLater} className="fos-press h-[52px] rounded-thumb bg-white/10 text-[15px] font-bold text-white">Pay later</button>
      </div>
    </div>
  );
}
