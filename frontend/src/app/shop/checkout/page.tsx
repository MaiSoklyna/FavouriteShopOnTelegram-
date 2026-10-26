"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useCart } from "@/providers/CartProvider";
import { fetchQuote, getSavedPromo, money, savePromo, type CartQuote, type DeliveryChoice } from "@/lib/quote";
import { deleteAddress, listAddresses, saveAddress, type SavedAddress } from "@/lib/addresses";
import { distanceKm, formatEta, formatKm, getCurrentPosition, reverseGeocode, type LatLng } from "@/lib/mapbox";
import { haptic, useMainButton } from "@/lib/telegram";
import { DeliveryIcon, LocationIcon, PayoutIcon, QrIcon, StoreIcon } from "@/components/brand/Icons";

// Same look as the map's own loading state, so there is no flash of an empty box
const MapPicker = dynamic(() => import("@/components/map/MapPicker"), {
  ssr: false,
  loading: () => (
    <div className="shop-skeleton" style={{
      height: 240, borderRadius: "var(--shop-r-input)", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 6,
    }}>
      <span className="map-pin-bounce" style={{ fontSize: 32 }}>📍</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--shop-muted)" }}>Loading map…</span>
    </div>
  ),
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

const PROVINCES = ["Phnom Penh", "Siem Reap", "Battambang", "Kampot", "Kampong Cham", "Other"];

const STEP_LABELS = ["Address", "Payment", "Review"];

export default function CheckoutPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { items, total, fetchCart } = useCart();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: "", phone: "", province: "", address: "", note: "" });
  const [payment, setPayment] = useState("cod");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [khqrData, setKhqrData] = useState<any>(null);
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
  const [saveThis, setSaveThis] = useState(false);
  const [saveLabel, setSaveLabel] = useState("Home");
  const [mapOpen, setMapOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(false);
  const [shop, setShop] = useState<ShopInfo | null>(null);

  // A single-shop cart can show that shop on the map; with several shops there is no one place to draw
  const merchantKey = Array.from(new Set(items.map((i: any) => i.merchant_id).filter(Boolean))).join(",");
  useEffect(() => {
    if (!merchantKey || merchantKey.includes(",")) { setShop(null); return; }
    api.get<ShopInfo>(`/merchants/${merchantKey}`).then(setShop).catch(() => setShop(null));
  }, [merchantKey]);
  const shopPoint: LatLng | null = shop?.latitude != null && shop?.longitude != null ? { lat: shop.latitude, lng: shop.longitude } : null;

  const choice: DeliveryChoice = deliveryType === "pickup"
    ? { delivery_type: "pickup" }
    : { delivery_type: "delivery", lat: pin?.lat, lng: pin?.lng };

  // Backend price for the cart — identical to what placing the order charges
  useEffect(() => {
    if (!user || items.length === 0 || step >= 4) return;
    const code = getSavedPromo();
    fetchQuote(code, choice)
      .then((q) => {
        setQuote(q);
        setQuoteError(q.promo && !q.promo.applied ? (q.promo.error || "Promo code not valid") : "");
        if (q.promo && !q.promo.applied) savePromo(null);
      })
      .catch((err: any) => {
        setQuote(null);
        setQuoteError(err?.detail || "Could not calculate the total. Please go back and try again.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, items, step, deliveryType, pin?.lat, pin?.lng]);

  useEffect(() => {
    if (!user) return;
    listAddresses().then((rows) => {
      setSaved(rows);
      const def = rows.find((a) => a.is_default);
      if (def) pickSaved(def);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function useMyLocation() {
    setLocating(true); setLocError(false);
    const p = await getCurrentPosition();
    if (!p) { setLocating(false); setLocError(true); haptic("error"); return; }
    haptic("success");
    setPin(p); setSaveThis(false);
    const addr = await reverseGeocode(p);
    if (addr) setForm((f) => ({ ...f, address: addr }));
    setLocating(false);
  }

  function pickSaved(a: SavedAddress) {
    setPin({ lat: a.latitude, lng: a.longitude });
    setForm((f) => ({ ...f, address: a.address }));
    setSaveThis(false);
  }

  async function removeSaved(id: number) {
    try { await deleteAddress(id); setSaved((rows) => rows.filter((a) => a.id !== id)); } catch { /* keep the chip */ }
  }

  function removePromo() {
    savePromo(null);
    fetchQuote(null, choice).then(setQuote).catch(() => {});
  }

  useEffect(() => {
    if (user && "first_name" in user) {
      const u = user as any;
      setForm(f => ({ ...f, name: `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username || "", phone: u.phone || "", address: u.address || "" }));
    }
  }, [user]);

  useEffect(() => {
    if (step === 4 && khqrTimer > 0) {
      const id = setInterval(() => setKhqrTimer(t => t - 1), 1000);
      return () => clearInterval(id);
    }
  }, [step, khqrTimer]);

  // Poll PayWay status (via backend) while the QR is on screen
  useEffect(() => {
    if (step !== 4 || !orderId || !khqrData) return;
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
  }, [step, orderId, khqrData]);

  async function loadQr(oid: number) {
    setQrLoading(true); setQrError(""); setKhqrData(null);
    try {
      const qr = await api.post<{ data: any }>(`/payments/payway/orders/${oid}/qr`);
      if (qr.data?.payment_status === "paid") { handlePaid(); return; }
      setKhqrData(qr.data);
      setKhqrTimer(qr.data?.expires_in || 900);
    } catch (err: any) {
      setQrError(err.detail || err.message || "Failed to generate QR");
    } finally { setQrLoading(false); }
  }

  function handlePaid() {
    const next = qrIndex + 1;
    if (next < qrOrderIds.length) {
      setQrIndex(next);
      loadQr(qrOrderIds[next]);
    } else {
      router.replace(`/shop/order/${qrOrderIds[0]}?placed=true`);
    }
  }

  const formatTimer = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  /** Reasons the server would refuse this cart — shown up front so checkout is blocked, not surprised. */
  const blockers: string[] = (quote?.orders ?? []).flatMap((o) => {
    const who = (quote!.orders.length > 1 ? `Shop #${o.merchant_id}` : shop?.name) || "This shop";
    const out: string[] = [];
    if (!o.is_open) out.push(`${who} is closed right now.`);
    if (o.min_order_amount && Number(o.subtotal) < Number(o.min_order_amount)) {
      out.push(`${who} has a ${money(o.min_order_amount)} minimum order — add ${money(Number(o.min_order_amount) - Number(o.subtotal))} more.`);
    }
    return out;
  });

  function validateStep1() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Name is required";
    if (!form.phone.trim() || form.phone.length < 9) e.phone = "Valid phone required (min 9 digits)";
    if (deliveryType === "delivery" && !form.address.trim()) e.address = "Address is required";
    if (deliveryType === "delivery" && !quote && quoteError) e.address = quoteError;
    if (blockers.length) e.blocked = blockers[0];
    setErrors(e);
    const ok = Object.keys(e).length === 0;
    if (!ok) haptic("error");
    return ok;
  }

  async function handlePlaceOrder() {
    setPlacing(true); setOrderError("");
    try {
      // Group cart items by merchant
      const byMerchant: Record<number, any[]> = {};
      items.forEach((item: any) => {
        const mid = item.merchant_id;
        if (mid) (byMerchant[mid] ||= []).push(item);
      });

      const merchantIds = Object.keys(byMerchant);
      if (merchantIds.length === 0) {
        setOrderError("Cannot place order: no merchant found for cart items.");
        setPlacing(false);
        return;
      }

      const results = await Promise.all(
        merchantIds.map(mid =>
          api.post<{ data: { order_id: number } }>("/orders", {
            merchant_id: Number(mid),
            delivery_type: deliveryType,
            delivery_address: deliveryType === "pickup" ? "Pickup at shop" : form.address,
            lat: deliveryType === "delivery" ? pin?.lat : undefined,
            lng: deliveryType === "delivery" ? pin?.lng : undefined,
            delivery_province: form.province,
            delivery_phone: "+855" + form.phone,
            delivery_name: form.name,
            customer_note: form.note,
            payment_method: payment,
            // The total the customer was shown; the server refuses if it has moved since
            expected_total: quote?.orders.find((o) => o.merchant_id === Number(mid))?.total,
            // A promo code belongs to one shop — send it only with that shop's order
            promo_code: quote?.promo?.applied && quote.promo.merchant_id === Number(mid) ? quote.promo.code : undefined,
          })
        )
      );
      savePromo(null);
      await fetchCart();
      const oid = results[0]?.data?.order_id;

      if (saveThis && deliveryType === "delivery" && pin && form.address.trim()) {
        // Best-effort: a failed save must not hide the placed order
        saveAddress({ label: saveLabel.trim() || "Home", address: form.address, latitude: pin.lat, longitude: pin.lng, is_default: saved.length === 0 })
          .catch(() => {});
      }

      haptic("success");
      if (payment === "khqr" && oid) {
        // One QR per shop order, paid one after another
        const ids = results.map(r => r?.data?.order_id).filter(Boolean) as number[];
        setQrOrderIds(ids);
        setQrIndex(0);
        setStep(4);
        loadQr(ids[0]);
      } else {
        router.replace(oid ? `/shop/order/${oid}?placed=true` : "/shop/orders");
      }
    } catch (err: any) {
      haptic("error");
      setOrderError(err.detail || err.message || "Order failed");
      // A moved price (409) or a closed shop: refresh what the customer sees
      fetchQuote(getSavedPromo(), choice).then(setQuote).catch(() => {});
    }
    finally { setPlacing(false); }
  }

  const totalLabel = quote ? money(quote.totals.total) : `$${total.toFixed(2)}`;
  const action = step === 1 ? { label: "Continue", run: () => validateStep1() && setStep(2), disabled: false }
    : step === 2 ? { label: "Continue", run: () => setStep(3), disabled: false }
    : { label: placing ? "Placing…" : "Place order", run: handlePlaceOrder, disabled: placing || !quote || blockers.length > 0 };
  const inTelegram = useMainButton({
    text: `${action.label} · ${totalLabel}`,
    onClick: action.run,
    disabled: action.disabled,
    loading: placing,
    visible: step < 4 && !!user && items.length > 0,
  });

  if (!user || (items.length === 0 && step < 4)) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--shop-bg, #F7F8FB)" }}>
        <TopBar onBack={() => router.back()} title="Checkout" />
        <div style={{ textAlign: "center", paddingTop: 80, padding: "80px 16px" }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: "var(--shop-primary-tint, #E8F0FF)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 28, margin: "0 auto 16px",
          }}>&#128722;</div>
          <p style={{ color: "var(--shop-muted, #8A8F9C)", fontSize: 14 }}>Cart is empty</p>
          <button onClick={() => router.push("/shop")} style={{
            marginTop: 16, padding: "12px 28px",
            background: "var(--shop-primary, #1E6BFF)", color: "#FFFFFF",
            border: "none", borderRadius: "var(--shop-r-pill, 999px)",
            fontWeight: 600, fontSize: 14, cursor: "pointer",
          }}>Start Shopping</button>
        </div>
      </div>
    );
  }

  const qt = quote?.totals;
  const deliveryFee = Number(qt?.delivery_fee ?? 0);
  const discount = Number(qt?.discount ?? 0);

  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg, #F7F8FB)" }}>
      <TopBar
        onBack={() => step > 1 && step < 4 ? setStep(step - 1) : router.back()}
        title="Checkout"
      />

      <div style={{ padding: "0 16px 120px" }}>
        {/* Progress Indicator */}
        <div style={{
          display: "flex", justifyContent: "center", alignItems: "center",
          gap: 0, padding: "20px 0 24px",
        }}>
          {STEP_LABELS.map((label, i) => {
            const s = i + 1;
            const done = step > s;
            const current = step === s;
            return (
              <div key={s} style={{ display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 700,
                    background: done || current ? "var(--shop-primary, #1E6BFF)" : "var(--shop-divider, #ECEEF3)",
                    color: done || current ? "#FFFFFF" : "var(--shop-muted, #8A8F9C)",
                    transition: "all 0.3s",
                  }}>
                    {done ? "✓" : s}
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: done || current ? "var(--shop-primary, #1E6BFF)" : "var(--shop-muted, #8A8F9C)",
                  }}>{label}</span>
                </div>
                {s < 3 && (
                  <div style={{
                    width: 40, height: 2, margin: "0 8px", marginBottom: 18,
                    background: step > s ? "var(--shop-primary, #1E6BFF)" : "var(--shop-divider, #ECEEF3)",
                    borderRadius: 1, transition: "background 0.3s",
                  }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step 1: Delivery */}
        {step === 1 && (
          <div>
            <SectionTitle>Delivery method</SectionTitle>
            <div role="radiogroup" aria-label="Delivery method" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              {([
                ["delivery", DeliveryIcon, "Delivery", "To your door"],
                ["pickup", StoreIcon, "Pickup", "Collect at the shop · Free"],
              ] as const).map(([key, MethodIcon, title, sub]) => {
                const on = deliveryType === key;
                return (
                  <button key={key} role="radio" aria-checked={on} onClick={() => { haptic("select"); setDeliveryType(key); }} className="shop-press" style={{
                    position: "relative", textAlign: "left", minHeight: 84, padding: 14, cursor: "pointer",
                    borderRadius: "var(--shop-r-card)",
                    border: on ? "2px solid var(--shop-primary)" : "1.5px solid var(--shop-divider)",
                    background: on ? "var(--shop-primary-tint)" : "var(--shop-surface)",
                    boxShadow: on ? "none" : "var(--shop-shadow)",
                  }}>
                    <span style={{
                      position: "absolute", top: 12, right: 12, width: 18, height: 18, borderRadius: "50%",
                      border: on ? "5px solid var(--shop-primary)" : "2px solid var(--shop-divider)", background: "var(--shop-surface)",
                    }} />
                    {on ? (
                      <span className="brand-chip"><MethodIcon size={28} /></span>
                    ) : (
                      <span style={{ width: 56, height: 56, display: "grid", placeItems: "center" }}><MethodIcon size={28} style={{ color: "var(--shop-black)" }} /></span>
                    )}
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--shop-black)", marginTop: 4 }}>{title}</div>
                    <div style={{ fontSize: 11, color: "var(--shop-muted)", marginTop: 1 }}>{sub}</div>
                  </button>
                );
              })}
            </div>

            <Card>
              <SectionTitle small>Contact</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Field label="Full Name *" value={form.name} onChange={v => setForm({ ...form, name: v })} error={errors.name} />
                <div>
                  <label style={labelStyle}>Phone *</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{
                      padding: "12px 14px", background: "var(--shop-bg, #F7F8FB)",
                      borderRadius: "var(--shop-r-input, 12px)", fontSize: 14,
                      color: "var(--shop-muted, #8A8F9C)", fontWeight: 600,
                      border: "1.5px solid var(--shop-divider, #ECEEF3)",
                    }}>+855</div>
                    <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })}
                      style={{ ...inputStyle, flex: 1, borderColor: errors.phone ? "var(--shop-danger)" : "var(--shop-divider, #ECEEF3)" }} placeholder="12 345 6789" />
                  </div>
                  {errors.phone && <p style={{ color: "var(--shop-danger)", fontSize: 12, marginTop: 6 }}>{errors.phone}</p>}
                </div>
              </div>
            </Card>

            {deliveryType === "pickup" && (
              <Card>
                <SectionTitle small>Pickup location</SectionTitle>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <ShopBadge shop={shop} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--shop-black)" }}>{shop?.name || "The shop"}</div>
                    <div style={{ fontSize: 12, color: "var(--shop-muted)", marginTop: 2 }}>{shop?.address || "The shop will confirm the pickup address."}</div>
                  </div>
                </div>
              </Card>
            )}

            {deliveryType === "delivery" && (
              <Card>
                <SectionTitle small><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><LocationIcon size={18} style={{ color: "var(--shop-primary)" }} />Delivery address</span></SectionTitle>

                {saved.length > 0 && (
                  <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }} className="shop-h-scroll">
                    {saved.map(a => {
                      const on = pin?.lat === a.latitude && pin?.lng === a.longitude;
                      return (
                        <span key={a.id} style={{
                          display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, borderRadius: 999, fontSize: 13, fontWeight: 600,
                          border: on ? "2px solid var(--shop-primary)" : "1.5px solid var(--shop-divider)",
                          background: on ? "var(--shop-primary-tint)" : "var(--shop-surface)",
                        }}>
                          <button onClick={() => pickSaved(a)} style={{ background: "none", border: "none", minHeight: 40, padding: "0 6px 0 14px", cursor: "pointer", fontWeight: 600, fontSize: 13, color: "var(--shop-black)" }}>
                            {a.is_default ? "★ " : "🏠 "}{a.label}
                          </button>
                          <button onClick={() => removeSaved(a.id)} aria-label={`Delete ${a.label}`} style={{ background: "none", border: "none", minHeight: 40, minWidth: 32, padding: "0 10px 0 0", cursor: "pointer", color: "var(--shop-muted)" }}>×</button>
                        </span>
                      );
                    })}
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <button onClick={useMyLocation} disabled={locating} style={actionBtn}>
                    {locating ? "Locating…" : "🎯 Use my location"}
                  </button>
                  <button onClick={() => setMapOpen(o => !o)} aria-expanded={mapOpen} style={{ ...actionBtn, ...(mapOpen ? actionBtnOn : {}) }}>
                    🗺️ {mapOpen ? "Hide map" : "Choose on map"}
                  </button>
                </div>
                {locError && <p style={{ fontSize: 12, color: "var(--shop-danger)", margin: "8px 0 0" }}>Couldn&apos;t get your location — allow access, or choose on the map.</p>}

                {mapOpen && (
                  <div style={{ marginTop: 12 }}>
                    <MapPicker
                      value={pin}
                      onChange={(p, addr) => { setPin(p); if (addr) setForm(f => ({ ...f, address: addr })); setSaveThis(false); }}
                      shop={shopPoint}
                      shopInfo={shop}
                      radiusKm={shop?.delivery_radius_km ?? null}
                      showLocate={false}
                      height={260}
                    />
                  </div>
                )}

                <div style={{ marginTop: 14 }}>
                  <Field label="Address *" value={form.address} onChange={v => setForm({ ...form, address: v })} error={errors.address} multiline />
                </div>

                <DeliveryInfo
                  pin={pin}
                  quote={quote}
                  quoteError={quoteError}
                  distance={(() => {
                    const q = quote?.orders.length === 1 ? Number(quote.orders[0].distance_km) : NaN;
                    if (!Number.isNaN(q) && q > 0) return q;
                    return pin && shopPoint ? distanceKm(pin, shopPoint) : null;
                  })()}
                  multiShop={(quote?.orders.length ?? 0) > 1}
                />

                {pin && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--shop-text)", marginTop: 14, flexWrap: "wrap" }}>
                    <input type="checkbox" checked={saveThis} onChange={e => setSaveThis(e.target.checked)} style={{ width: 18, height: 18 }} />
                    Save this address as
                    <input value={saveLabel} onChange={e => setSaveLabel(e.target.value)} maxLength={40}
                      style={{ ...inputStyle, width: 110, padding: "6px 10px" }} />
                  </label>
                )}
              </Card>
            )}

            <Card>
              <Field label="Note (optional)" value={form.note} onChange={v => setForm({ ...form, note: v })} multiline />
            </Card>

            <Card>
              <SectionTitle small>Order summary</SectionTitle>
              <SummaryRow label="Products" value={qt ? money(qt.subtotal) : `$${total.toFixed(2)}`} />
              {discount > 0 && <SummaryRow label="Discount" value={`-${money(discount)}`} green />}
              <SummaryRow label={deliveryType === "pickup" ? "Pickup" : "Delivery"}
                value={deliveryType === "delivery" && !pin ? "Pick a location" : !qt ? "…" : deliveryFee === 0 ? "FREE" : money(deliveryFee)}
                green={!!qt && deliveryFee === 0} />
              <div style={{ height: 1, background: "var(--shop-divider)", margin: "10px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--shop-black)" }}>Total</span>
                <span style={{ fontWeight: 700, fontSize: 18, color: "var(--shop-primary)" }}>{qt ? money(qt.total) : `$${total.toFixed(2)}`}</span>
              </div>
            </Card>

            <Blockers items={blockers} />
          </div>
        )}

        {/* Step 2: Payment */}
        {step === 2 && (
          <div>
            <h2 style={{
              fontSize: 17, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", marginBottom: 20,
            }}>Payment Method</h2>
            {[
              { key: "cod", label: "Cash on Delivery", desc: "Pay when you receive", icon: "💵" },
              { key: "khqr", label: "ABA KHQR", desc: "Scan with ABA Mobile or any KHQR banking app", icon: <QrIcon size={20} /> },
            ].map(m => {
              const selected = payment === m.key;
              return (
                <button key={m.key} onClick={() => setPayment(m.key)}
                  style={{
                    width: "100%", textAlign: "left", padding: 16, marginBottom: 10,
                    borderRadius: "var(--shop-r-card, 16px)",
                    border: selected ? "2px solid var(--shop-primary, #1E6BFF)" : "1.5px solid var(--shop-divider, #ECEEF3)",
                    background: selected ? "var(--shop-primary-tint, #E8F0FF)" : "var(--shop-surface, #FFFFFF)",
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 14,
                    boxShadow: selected ? "none" : "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
                  }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: selected ? "var(--shop-primary, #1E6BFF)" : "var(--shop-primary-tint, #E8F0FF)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, flexShrink: 0,
                    color: selected ? "#FFFFFF" : "var(--shop-primary, #1E6BFF)",
                  }}>{m.icon}</div>
                  <div>
                    <div style={{
                      fontWeight: 600, fontSize: 14,
                      color: "var(--shop-black, #0B0B0F)",
                    }}>{m.label}</div>
                    <div style={{ fontSize: 12, color: "var(--shop-muted, #8A8F9C)", marginTop: 2 }}>{m.desc}</div>
                  </div>
                </button>
              );
            })}

          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <div>
            <h2 style={{
              fontSize: 17, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", marginBottom: 20,
            }}>Review &amp; Confirm</h2>

            <Card>
              <h3 style={{
                fontSize: 15, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", marginBottom: 10,
              }}>Items ({items.length})</h3>
              {items.slice(0, 3).map((item: any) => (
                <div key={item.id} style={{
                  display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8,
                }}>
                  <span style={{ color: "var(--shop-text, #4A4E5A)" }}>{item.product_name} x{item.quantity}</span>
                  <span style={{ fontWeight: 600, color: "var(--shop-black, #0B0B0F)" }}>${item.line_total.toFixed(2)}</span>
                </div>
              ))}
              {items.length > 3 && (
                <p style={{ fontSize: 12, color: "var(--shop-primary, #1E6BFF)", fontWeight: 600 }}>
                  +{items.length - 3} more items
                </p>
              )}
            </Card>

            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h3 style={{
                  fontSize: 15, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", margin: 0,
                }}>Delivery</h3>
                <button onClick={() => setStep(1)} style={{
                  background: "none", border: "none",
                  color: "var(--shop-primary, #1E6BFF)",
                  fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}>Change</button>
              </div>
              <p style={{ fontSize: 14, fontWeight: 500, color: "var(--shop-black, #0B0B0F)" }}>
                {form.name} | +855{form.phone}
              </p>
              <p style={{ fontSize: 13, color: "var(--shop-muted, #8A8F9C)", marginTop: 4 }}>
                {deliveryType === "pickup" ? "Pickup at the shop — no delivery fee" : form.address}
              </p>
            </Card>

            <Card>
              <SummaryRow label="Subtotal" value={qt ? money(qt.subtotal) : `$${total.toFixed(2)}`} />
              {discount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, marginBottom: 8 }}>
                  <span style={{ color: "var(--shop-muted, #8A8F9C)" }}>
                    Discount ({quote?.promo?.code}){" "}
                    <button onClick={removePromo} style={{ background: "none", border: "none", color: "#C62828", fontSize: 12, cursor: "pointer", padding: 0 }}>
                      Remove
                    </button>
                  </span>
                  <span style={{ fontWeight: 600, color: "#2E7D32" }}>-{money(discount)}</span>
                </div>
              )}
              <SummaryRow label={deliveryType === "pickup" ? "Pickup" : "Delivery"} value={!qt ? "…" : deliveryFee === 0 ? "FREE" : money(deliveryFee)} green={!!qt && deliveryFee === 0} />
              {(quote?.orders.length ?? 0) > 1 && (
                <p style={{ fontSize: 11, color: "var(--shop-muted, #8A8F9C)", margin: "0 0 8px" }}>
                  Items from {quote!.orders.length} shops — each shop is a separate order with its own delivery fee.
                </p>
              )}
              {quoteError && <p style={{ fontSize: 12, color: "#C62828", margin: "0 0 8px" }}>{quoteError}</p>}
              <div style={{ height: 1, background: "var(--shop-divider, #ECEEF3)", margin: "10px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 16, color: "var(--shop-black, #0B0B0F)" }}>Total</span>
                <span style={{ fontWeight: 700, fontSize: 20, color: "var(--shop-primary, #1E6BFF)" }}>
                  {qt ? money(qt.total) : "…"}
                </span>
              </div>
            </Card>

            {orderError && (
              <div style={{
                background: "#FFEBEE", padding: 14,
                borderRadius: "var(--shop-r-input, 12px)", marginBottom: 12,
              }}>
                <p style={{ color: "#C62828", fontSize: 13, margin: 0 }}>{orderError}</p>
              </div>
            )}

            <Blockers items={blockers} />
          </div>
        )}

        {step < 4 && !inTelegram && (
          <BottomBar total={totalLabel} label={action.label} onClick={action.run} disabled={action.disabled} />
        )}

        {/* Step 4: KHQR */}
        {step === 4 && (
          <div style={{ textAlign: "center" }}>
            <h2 style={{
              fontSize: 17, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", marginBottom: 8,
            }}>Complete Payment</h2>
            <p style={{ fontSize: 13, color: "var(--shop-muted, #8A8F9C)", marginBottom: qrOrderIds.length > 1 ? 8 : 24 }}>
              Scan with ABA Mobile or any KHQR banking app
            </p>
            {qrOrderIds.length > 1 && (
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--shop-primary, #1E6BFF)", marginBottom: 24 }}>
                Order {qrIndex + 1} of {qrOrderIds.length}
                {khqrData?.order_code ? ` · ${khqrData.order_code}` : ""}
              </p>
            )}

            {qrLoading ? (
              <div style={{ padding: 40, color: "var(--shop-muted, #8A8F9C)", fontSize: 14 }}>Generating QR…</div>
            ) : khqrData ? (
              <>
                <div style={{
                  background: "var(--shop-surface, #FFFFFF)",
                  borderRadius: "var(--shop-r-card, 16px)", padding: 24, marginBottom: 16,
                  boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
                }}>
                  {khqrData.qr_image && (
                    <img src={khqrData.qr_image} alt="ABA KHQR"
                      style={{
                        width: 240, maxWidth: "100%", margin: "0 auto 16px", borderRadius: 12, display: "block",
                        opacity: khqrTimer > 0 ? 1 : 0.25,
                      }} />
                  )}
                  <p style={{ fontSize: 28, fontWeight: 700, color: "var(--shop-primary, #1E6BFF)" }}>
                    ${khqrData.amount}
                  </p>
                  {khqrTimer > 0 ? (
                    <>
                      <p style={{ fontSize: 13, color: "#E65100", fontWeight: 600, marginTop: 8 }}>
                        Expires in {formatTimer(khqrTimer)}
                      </p>
                      <p style={{ fontSize: 12, color: "var(--shop-muted, #8A8F9C)", marginTop: 8 }}>
                        Waiting for payment… this page updates automatically.
                      </p>
                    </>
                  ) : (
                    <p style={{ fontSize: 13, color: "#C62828", fontWeight: 600, marginTop: 8 }}>
                      QR expired
                    </p>
                  )}
                </div>
                {khqrTimer > 0 && khqrData.deeplink && (
                  <a href={khqrData.deeplink} style={{
                    display: "block", width: "100%", padding: 14,
                    background: "var(--shop-primary, #1E6BFF)", color: "#FFFFFF",
                    borderRadius: "var(--shop-r-input, 12px)", fontWeight: 600,
                    textAlign: "center", textDecoration: "none", marginBottom: 10, fontSize: 14,
                  }}>
                    Pay with ABA Mobile
                  </a>
                )}
                {khqrTimer <= 0 && orderId && (
                  <button onClick={() => loadQr(orderId)} style={{ ...btnPrimary, marginBottom: 10, marginTop: 0 }}>
                    Generate new QR
                  </button>
                )}
                <button onClick={() => router.push("/shop/orders")} style={{ ...btnSecondary, width: "100%", marginTop: 0 }}>
                  Pay Later
                </button>
              </>
            ) : (
              <div style={{ padding: 40 }}>
                <p style={{ color: "#C62828" }}>{qrError || "Failed to generate QR code"}</p>
                {orderId && (
                  <button onClick={() => loadQr(orderId)} style={{ ...btnPrimary, marginTop: 16 }}>
                    Try again
                  </button>
                )}
                <button onClick={() => router.push("/shop/orders")} style={{ ...btnSecondary, width: "100%", marginTop: 10 }}>
                  Go to Orders
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reusable mini-components ────────────────────────────────
function TopBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div style={{
      height: 56, display: "flex", alignItems: "center", gap: 12,
      background: "var(--shop-surface, #FFFFFF)",
      borderBottom: "1px solid var(--shop-divider, #ECEEF3)",
      padding: "0 16px", position: "sticky", top: 0, zIndex: 10,
    }}>
      <button onClick={onBack} style={{
        width: 36, height: 36, borderRadius: "50%",
        background: "var(--shop-bg, #F7F8FB)", border: "none",
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 16, color: "var(--shop-black, #0B0B0F)", flexShrink: 0,
      }}>&#8592;</button>
      <h1 style={{ fontSize: 17, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", margin: 0 }}>{title}</h1>
    </div>
  );
}

function Field({ label, value, onChange, error, multiline }: { label: string; value: string; onChange: (v: string) => void; error?: string; multiline?: boolean }) {
  const Tag = multiline ? "textarea" : "input";
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <Tag value={value} onChange={(e: any) => onChange(e.target.value)}
        rows={multiline ? 3 : undefined}
        style={{ ...inputStyle, borderColor: error ? "#C62828" : "var(--shop-divider, #ECEEF3)", resize: multiline ? "vertical" as const : undefined }} />
      {error && <p style={{ color: "#C62828", fontSize: 12, marginTop: 6 }}>{error}</p>}
    </div>
  );
}

function SectionTitle({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return (
    <h2 style={{ fontSize: small ? 14 : 15, fontWeight: 700, color: "var(--shop-black)", margin: small ? "0 0 12px" : "0 0 10px" }}>{children}</h2>
  );
}

function ShopBadge({ shop }: { shop: ShopInfo | null }) {
  return (
    <div style={{
      width: 48, height: 48, borderRadius: 12, flexShrink: 0, overflow: "hidden", fontSize: 24,
      background: "var(--shop-primary-tint)", display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {shop?.logo_url ? <img src={shop.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (shop?.icon_emoji || <StoreIcon size={24} style={{ color: "var(--shop-primary)" }} />)}
    </div>
  );
}

/** Distance, fee and time for the chosen pin — or why delivery isn't available. */
function DeliveryInfo({ pin, quote, quoteError, distance, multiShop }: {
  pin: LatLng | null; quote: CartQuote | null; quoteError: string; distance: number | null; multiShop: boolean;
}) {
  if (!pin) {
    return (
      <div style={{ marginTop: 12, padding: 12, borderRadius: "var(--shop-r-input)", background: "var(--shop-bg)", fontSize: 13, color: "var(--shop-muted)" }}>
        Choose your location to see the distance and delivery fee.
      </div>
    );
  }
  if (!quote && quoteError) {
    return (
      <div role="alert" style={{ marginTop: 12, padding: 12, borderRadius: "var(--shop-r-input)", background: "var(--shop-danger-tint)", color: "var(--shop-danger)", fontSize: 13, fontWeight: 600 }}>
        ⚠️ {quoteError}
        <div style={{ fontWeight: 500, marginTop: 4 }}>Move the pin closer, or switch to Pickup.</div>
      </div>
    );
  }
  if (!quote) {
    return <div className="shop-skeleton" style={{ marginTop: 12, height: 64, borderRadius: "var(--shop-r-input)" }} aria-busy="true" />;
  }
  const fee = Number(quote.totals.delivery_fee);
  const first = quote.orders[0];
  const eta = first?.eta_minutes != null && first?.eta_max_minutes != null ? [first.eta_minutes, first.eta_max_minutes] : null;
  const tiles: [string, string][] = [
    ["Distance", multiShop ? "Varies" : distance != null ? formatKm(distance) : "—"],
    ["Delivery fee", multiShop ? money(fee) : fee === 0 ? "FREE" : money(fee)],
    ["Est. time", !multiShop && eta ? formatEta(eta[0], eta[1]) : "—"],
  ];
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 12 }}>
        {tiles.map(([label, value]) => (
          <div key={label} style={{ padding: "10px 6px", borderRadius: "var(--shop-r-input)", background: "var(--shop-success-tint)", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "var(--shop-muted)" }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--shop-success)", marginTop: 2 }}>{value}</div>
          </div>
        ))}
      </div>
      {multiShop && (
        <p style={{ fontSize: 11, color: "var(--shop-muted)", margin: "8px 0 0" }}>
          Items from {quote.orders.length} shops — each shop is a separate order with its own fee.
        </p>
      )}
    </div>
  );
}

function Blockers({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div role="alert" style={{ marginBottom: 12, padding: 14, borderRadius: "var(--shop-r-card)", background: "var(--shop-danger-tint)", color: "var(--shop-danger)", fontSize: 13, fontWeight: 600 }}>
      {items.map((m) => <div key={m}>⚠️ {m}</div>)}
    </div>
  );
}

/** Sticky checkout bar: the running total stays visible next to the main action. */
function BottomBar({ total, label, onClick, disabled }: { total: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div style={{
      position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50,
      display: "flex", alignItems: "center", gap: 14,
      padding: "12px 16px calc(12px + var(--safe-bottom, 0px))",
      background: "var(--shop-surface)", borderTop: "1px solid var(--shop-divider)",
      boxShadow: "0 -6px 20px rgba(8, 29, 60, 0.08)",
    }}>
      <div style={{ minWidth: 76 }}>
        <div style={{ fontSize: 11, color: "var(--shop-muted)" }}>Total</div>
        <div style={{ fontSize: 19, fontWeight: 700, color: "var(--shop-black)" }}>{total}</div>
      </div>
      <button onClick={onClick} disabled={disabled} style={{
        flex: 1, minHeight: 50, borderRadius: "var(--shop-r-input)", border: "none",
        background: "var(--shop-primary)", color: "#fff", fontWeight: 700, fontSize: 15,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1, transition: "opacity .2s",
      }}>{label}</button>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--shop-surface, #FFFFFF)",
      borderRadius: "var(--shop-r-card, 16px)", padding: 16, marginBottom: 12,
      boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
    }}>{children}</div>
  );
}

function SummaryRow({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 8 }}>
      <span style={{ color: "var(--shop-muted, #8A8F9C)" }}>{label}</span>
      <span style={{ fontWeight: 600, color: green ? "#2E7D32" : "var(--shop-text, #4A4E5A)" }}>{value}</span>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 13, fontWeight: 600,
  color: "var(--shop-black, #0B0B0F)", marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px",
  borderRadius: "var(--shop-r-input, 12px)",
  border: "1.5px solid var(--shop-divider, #ECEEF3)",
  background: "var(--shop-bg, #F7F8FB)",
  color: "var(--shop-black, #0B0B0F)", fontSize: 14,
};

const actionBtn: React.CSSProperties = {
  minHeight: 46, borderRadius: "var(--shop-r-input)", border: "1.5px solid var(--shop-primary)",
  background: "var(--shop-surface)", color: "var(--shop-primary)", fontWeight: 700, fontSize: 13, cursor: "pointer",
};

const actionBtnOn: React.CSSProperties = { background: "var(--shop-primary-tint)" };

const btnPrimary: React.CSSProperties = {
  flex: 1, width: "100%", padding: 14,
  borderRadius: "var(--shop-r-input, 12px)",
  border: "none", background: "var(--shop-primary, #1E6BFF)",
  color: "#FFFFFF", fontWeight: 600, fontSize: 14,
  cursor: "pointer", marginTop: 16,
};

const btnSecondary: React.CSSProperties = {
  flex: 1, padding: 14,
  borderRadius: "var(--shop-r-input, 12px)",
  border: "1.5px solid var(--shop-divider, #ECEEF3)",
  background: "transparent", color: "var(--shop-text, #4A4E5A)",
  fontWeight: 600, fontSize: 14, cursor: "pointer", marginTop: 16,
};
