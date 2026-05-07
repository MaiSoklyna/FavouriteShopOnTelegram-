"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useCart } from "@/providers/CartProvider";

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
  const [orderId, setOrderId] = useState<number | null>(null);

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

  const formatTimer = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  function validateStep1() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Name is required";
    if (!form.phone.trim() || form.phone.length < 9) e.phone = "Valid phone required (min 9 digits)";
    if (!form.address.trim()) e.address = "Address is required";
    setErrors(e);
    return Object.keys(e).length === 0;
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
            delivery_address: form.address,
            delivery_province: form.province,
            delivery_phone: "+855" + form.phone,
            delivery_name: form.name,
            customer_note: form.note,
            payment_method: payment,
          })
        )
      );
      await fetchCart();
      const oid = results[0]?.data?.order_id;

      if (payment === "khqr" && oid) {
        setOrderId(oid);
        try {
          const qr = await api.get<{ data: any }>(`/orders/${oid}/khqr`);
          setKhqrData(qr.data);
          setKhqrTimer(qr.data?.expires_in || 900);
        } catch { setOrderError("Failed to generate QR"); }
        setStep(4);
      } else {
        router.replace(oid ? `/shop/order/${oid}?placed=true` : "/shop/orders");
      }
    } catch (err: any) { setOrderError(err.detail || err.message || "Order failed"); }
    finally { setPlacing(false); }
  }

  async function handleConfirmPayment() {
    if (!orderId) return;
    try {
      await api.post(`/orders/${orderId}/confirm-payment`);
      router.replace(`/shop/order/${orderId}?placed=true`);
    } catch { alert("Payment confirmation failed. Contact support if you already paid."); }
  }

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

  const deliveryFee = total > 50 ? 0 : 5;
  const finalTotal = total + deliveryFee;

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

        {/* Step 1: Address */}
        {step === 1 && (
          <div>
            <h2 style={{
              fontSize: 17, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", marginBottom: 20,
            }}>Delivery Address</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
                    style={{ ...inputStyle, flex: 1, borderColor: errors.phone ? "#C62828" : "var(--shop-divider, #ECEEF3)" }} placeholder="12 345 6789" />
                </div>
                {errors.phone && <p style={{ color: "#C62828", fontSize: 12, marginTop: 6 }}>{errors.phone}</p>}
              </div>
              <div>
                <label style={labelStyle}>Province</label>
                <select value={form.province} onChange={e => setForm({ ...form, province: e.target.value })} style={inputStyle}>
                  <option value="">Select province</option>
                  {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <Field label="Full Address *" value={form.address} onChange={v => setForm({ ...form, address: v })} error={errors.address} multiline />
              <Field label="Note (optional)" value={form.note} onChange={v => setForm({ ...form, note: v })} multiline />
            </div>
            <button onClick={() => validateStep1() && setStep(2)} style={btnPrimary}>Continue</button>
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
              { key: "khqr", label: "KHQR Payment", desc: "ABA, ACLEDA, Wing, Pi Pay", icon: "📱" },
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
            <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
              <button onClick={() => setStep(1)} style={btnSecondary}>Back</button>
              <button onClick={() => setStep(3)} style={btnPrimary}>Continue</button>
            </div>
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
              <p style={{ fontSize: 13, color: "var(--shop-muted, #8A8F9C)", marginTop: 4 }}>{form.address}</p>
            </Card>

            <Card>
              <SummaryRow label="Subtotal" value={`$${total.toFixed(2)}`} />
              <SummaryRow label="Delivery" value={deliveryFee === 0 ? "FREE" : `$${deliveryFee.toFixed(2)}`} green={deliveryFee === 0} />
              <div style={{ height: 1, background: "var(--shop-divider, #ECEEF3)", margin: "10px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 16, color: "var(--shop-black, #0B0B0F)" }}>Total</span>
                <span style={{ fontWeight: 700, fontSize: 20, color: "var(--shop-primary, #1E6BFF)" }}>
                  ${finalTotal.toFixed(2)}
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

            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setStep(2)} style={btnSecondary}>Back</button>
              <button onClick={handlePlaceOrder} disabled={placing} style={{ ...btnPrimary, opacity: placing ? 0.6 : 1 }}>
                {placing ? "Placing..." : "Place Order"}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: KHQR */}
        {step === 4 && (
          <div style={{ textAlign: "center" }}>
            <h2 style={{
              fontSize: 17, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", marginBottom: 8,
            }}>Complete Payment</h2>
            <p style={{ fontSize: 13, color: "var(--shop-muted, #8A8F9C)", marginBottom: 24 }}>
              Scan QR with any KHQR app
            </p>

            {khqrData ? (
              <>
                <div style={{
                  background: "var(--shop-surface, #FFFFFF)",
                  borderRadius: "var(--shop-r-card, 16px)", padding: 24, marginBottom: 16,
                  boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
                }}>
                  {khqrData.qr_code && (
                    <img src={khqrData.qr_code} alt="KHQR"
                      style={{ width: 220, height: 220, margin: "0 auto 16px", borderRadius: 12, display: "block" }} />
                  )}
                  <p style={{ fontSize: 28, fontWeight: 700, color: "var(--shop-primary, #1E6BFF)" }}>
                    ${khqrData.amount?.toFixed(2)}
                  </p>
                  <p style={{ fontSize: 13, color: "#E65100", fontWeight: 600, marginTop: 8 }}>
                    Expires in {formatTimer(khqrTimer)}
                  </p>
                </div>
                {khqrData.deeplink && (
                  <a href={khqrData.deeplink} style={{
                    display: "block", width: "100%", padding: 14,
                    background: "var(--shop-primary, #1E6BFF)", color: "#FFFFFF",
                    borderRadius: "var(--shop-r-input, 12px)", fontWeight: 600,
                    textAlign: "center", textDecoration: "none", marginBottom: 10, fontSize: 14,
                  }}>
                    Open in Bakong App
                  </a>
                )}
                <button onClick={handleConfirmPayment} style={{ ...btnPrimary, marginBottom: 10, marginTop: 0 }}>
                  I&apos;ve Paid
                </button>
                <button onClick={() => router.push("/shop/orders")} style={{ ...btnSecondary, width: "100%", marginTop: 0 }}>
                  Pay Later
                </button>
              </>
            ) : (
              <div style={{ padding: 40 }}>
                <p style={{ color: "#C62828" }}>Failed to generate QR code</p>
                <button onClick={() => router.push("/shop/orders")} style={{ ...btnPrimary, marginTop: 16 }}>
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
