"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { useCart } from "@/providers/CartProvider";
import { LoginGate } from "@/components/shop/LoginGate";
import { api } from "@/lib/api";

export default function CartPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { items, total, loading, updateQuantity, removeItem } = useCart();

  const [promoCode, setPromoCode] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState("");
  const [promoSuccess, setPromoSuccess] = useState(false);
  const [discount, setDiscount] = useState(0);

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return;
    setPromoLoading(true);
    setPromoError("");
    const merchantIds = [...new Set(items.map((i: any) => i.merchant_id).filter(Boolean))];
    if (!merchantIds.length) { setPromoError("Cannot validate promo"); setPromoLoading(false); return; }

    for (const mid of merchantIds) {
      const merchantTotal = items.filter((i: any) => i.merchant_id === mid).reduce((s, i) => s + (i.line_total || i.unit_price * i.quantity), 0);
      try {
        const res = await api.post<{ data: { discount_amount: number } }>("/promos/validate", { code: promoCode, merchant_id: mid, cart_total: merchantTotal });
        setDiscount(res.data.discount_amount || 0);
        setPromoSuccess(true);
        setPromoLoading(false);
        return;
      } catch { /* try next merchant */ }
    }
    setPromoError("Invalid promo code");
    setPromoLoading(false);
  };

  if (!user) return <LoginGate><div /></LoginGate>;
  if (loading) return <LoadingPage />;
  if (items.length === 0) return <EmptyPage onAction={() => router.push("/shop")} />;

  const deliveryFee = total > 50 ? 0 : 5;
  const finalTotal = total + deliveryFee - discount;

  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg, #F7F8FB)" }}>
      {/* Top bar */}
      <div style={{
        height: 56, display: "flex", alignItems: "center", gap: 12,
        padding: "0 16px", background: "var(--shop-surface, #FFFFFF)",
        borderBottom: "1px solid var(--shop-divider, #ECEEF3)",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <button onClick={() => router.back()} style={{
          width: 36, height: 36, borderRadius: 10, border: "none",
          background: "var(--shop-bg, #F7F8FB)", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, color: "var(--shop-black, #0B0B0F)",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span style={{ flex: 1, fontSize: 17, fontWeight: 700, color: "var(--shop-black, #0B0B0F)" }}>My Cart</span>
        <span style={{
          fontSize: 13, fontWeight: 600, color: "var(--shop-primary, #1E6BFF)",
          background: "var(--shop-primary-tint, #E8F0FF)",
          padding: "4px 10px", borderRadius: "var(--shop-r-pill, 999px)",
        }}>
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
      </div>

      <div style={{ padding: "16px 16px 160px" }}>
        {/* Cart items */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map(item => (
            <div key={item.id} style={{
              display: "flex", gap: 14, padding: 14,
              background: "var(--shop-surface, #FFFFFF)",
              borderRadius: "var(--shop-r-card, 16px)",
              boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
            }}>
              {/* Image */}
              <div style={{
                width: 72, height: 72, borderRadius: 12, flexShrink: 0,
                overflow: "hidden", background: "var(--shop-bg, #F7F8FB)",
              }}>
                {item.primary_image ? (
                  <img src={item.primary_image} alt={item.product_name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <div style={{
                    width: "100%", height: "100%", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    fontSize: 24, fontWeight: 700, color: "var(--shop-muted, #8A8F9C)",
                  }}>
                    {item.product_name?.[0]?.toUpperCase() || "?"}
                  </div>
                )}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div>
                  <h3 style={{
                    fontSize: 14, fontWeight: 600, color: "var(--shop-black, #0B0B0F)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    margin: 0,
                  }}>{item.product_name}</h3>
                  {item.merchant_name && (
                    <p style={{ fontSize: 12, color: "var(--shop-muted, #8A8F9C)", margin: "2px 0 0" }}>{item.merchant_name}</p>
                  )}
                  {Array.isArray(item.selected_variants) && item.selected_variants.length > 0 && (
                    <p style={{ fontSize: 11, color: "var(--shop-muted, #8A8F9C)", margin: "4px 0 0", display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {(item.selected_variants as Array<{ group_name?: string; label?: string }>).map((sv, i) => (
                        <span key={i} style={{ background: "var(--shop-bg, #F7F8FB)", padding: "2px 8px", borderRadius: 999, fontWeight: 500 }}>
                          {sv.group_name ? `${sv.group_name}: ` : ""}{sv.label}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--shop-primary, #1E6BFF)" }}>
                  ${item.line_total.toFixed(2)}
                </span>
              </div>

              {/* Actions column */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "space-between", flexShrink: 0 }}>
                <button onClick={() => removeItem(item.id)} style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 12, fontWeight: 600, color: "#EF4444",
                  padding: "2px 0",
                }}>
                  Remove
                </button>
                {/* Qty stepper */}
                <div style={{
                  display: "flex", alignItems: "center",
                  border: "1px solid var(--shop-divider, #ECEEF3)",
                  borderRadius: "var(--shop-r-pill, 999px)", overflow: "hidden",
                }}>
                  <button onClick={() => updateQuantity(item.id, item.quantity - 1)} style={{
                    width: 30, height: 30, background: "none", border: "none",
                    cursor: "pointer", fontSize: 15, color: "var(--shop-muted, #8A8F9C)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>-</button>
                  <span style={{
                    width: 28, textAlign: "center", fontWeight: 700,
                    fontSize: 13, color: "var(--shop-black, #0B0B0F)",
                  }}>{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.id, item.quantity + 1)} style={{
                    width: 30, height: 30, background: "none", border: "none",
                    cursor: "pointer", fontSize: 15, color: "var(--shop-primary, #1E6BFF)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>+</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Promo box */}
        <div style={{
          marginTop: 20, padding: 14,
          background: "var(--shop-surface, #FFFFFF)",
          borderRadius: "var(--shop-r-card, 16px)",
          boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
        }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--shop-black, #0B0B0F)", margin: "0 0 10px" }}>Promo Code</p>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="text" value={promoCode} onChange={(e) => setPromoCode(e.target.value)}
              placeholder="Enter code" disabled={promoSuccess}
              style={{
                flex: 1, padding: "10px 14px",
                borderRadius: "var(--shop-r-input, 12px)",
                border: "1px solid var(--shop-divider, #ECEEF3)",
                background: "var(--shop-bg, #F7F8FB)",
                color: "var(--shop-black, #0B0B0F)", fontSize: 14,
                outline: "none",
              }} />
            {promoSuccess ? (
              <button onClick={() => { setPromoSuccess(false); setDiscount(0); setPromoCode(""); setPromoError(""); }}
                style={{
                  padding: "10px 18px",
                  borderRadius: "var(--shop-r-input, 12px)",
                  border: "1.5px solid #EF4444",
                  background: "transparent",
                  color: "#EF4444", fontWeight: 600, fontSize: 13,
                  cursor: "pointer", whiteSpace: "nowrap",
                }}>
                Clear
              </button>
            ) : (
              <button onClick={handleApplyPromo}
                disabled={promoLoading || !promoCode.trim()}
                style={{
                  padding: "10px 18px",
                  borderRadius: "var(--shop-r-input, 12px)",
                  border: "none",
                  background: "var(--shop-primary, #1E6BFF)",
                  color: "#FFFFFF", fontWeight: 600, fontSize: 13,
                  cursor: "pointer",
                  opacity: promoLoading || !promoCode.trim() ? 0.4 : 1,
                  whiteSpace: "nowrap",
                }}>
                {promoLoading ? "..." : "Apply"}
              </button>
            )}
          </div>
          {promoError && <p style={{ color: "#EF4444", fontSize: 12, marginTop: 6, marginBottom: 0 }}>{promoError}</p>}
          {promoSuccess && <p style={{ color: "#16a34a", fontSize: 12, marginTop: 6, marginBottom: 0 }}>Promo code applied!</p>}
        </div>

        {/* Summary card */}
        <div style={{
          marginTop: 16, padding: 16,
          background: "var(--shop-surface, #FFFFFF)",
          borderRadius: "var(--shop-r-card, 16px)",
          boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
        }}>
          <Row label="Subtotal" value={`$${total.toFixed(2)}`} />
          <Row label="Shipping" value={deliveryFee === 0 ? "Free" : `$${deliveryFee.toFixed(2)}`} valueColor={deliveryFee === 0 ? "#16a34a" : undefined} />
          {discount > 0 && <Row label="Discount" value={`-$${discount.toFixed(2)}`} valueColor="#16a34a" />}
          <div style={{ height: 1, background: "var(--shop-divider, #ECEEF3)", margin: "12px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--shop-black, #0B0B0F)" }}>Total</span>
            <span style={{ fontWeight: 700, fontSize: 17, color: "var(--shop-primary, #1E6BFF)" }}>${finalTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Checkout button - fixed bottom */}
      <div style={{
        position: "fixed", bottom: 60, left: 0, right: 0, zIndex: 40,
        padding: "12px 16px 16px",
        background: "var(--shop-surface, #FFFFFF)",
        borderTop: "1px solid var(--shop-divider, #ECEEF3)",
      }}>
        <button onClick={() => router.push("/shop/checkout")} style={{
          width: "100%", padding: "16px",
          borderRadius: "var(--shop-r-card, 16px)",
          border: "none",
          background: "var(--shop-primary, #1E6BFF)",
          color: "#FFFFFF", fontWeight: 700, fontSize: 15,
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(30,107,255,0.3)",
        }}>
          Checkout &middot; ${finalTotal.toFixed(2)}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 10 }}>
      <span style={{ color: "var(--shop-text, #4A4E5A)" }}>{label}</span>
      <span style={{ fontWeight: 600, color: valueColor || "var(--shop-black, #0B0B0F)" }}>{value}</span>
    </div>
  );
}

function EmptyPage({ onAction }: { onAction: () => void }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg, #F7F8FB)" }}>
      <div style={{
        height: 56, display: "flex", alignItems: "center", gap: 12,
        padding: "0 16px", background: "var(--shop-surface, #FFFFFF)",
        borderBottom: "1px solid var(--shop-divider, #ECEEF3)",
      }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--shop-black, #0B0B0F)" }}>My Cart</span>
      </div>
      <div style={{ textAlign: "center", paddingTop: 100 }}>
        <div style={{
          width: 72, height: 72, borderRadius: "50%", margin: "0 auto 16px",
          background: "var(--shop-primary-tint, #E8F0FF)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--shop-primary, #1E6BFF)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
          </svg>
        </div>
        <p style={{ fontSize: 16, fontWeight: 600, color: "var(--shop-black, #0B0B0F)", margin: "0 0 4px" }}>Your cart is empty</p>
        <p style={{ fontSize: 13, color: "var(--shop-muted, #8A8F9C)", margin: "0 0 24px" }}>Add items to get started</p>
        <button onClick={onAction} style={{
          padding: "12px 32px",
          background: "var(--shop-primary, #1E6BFF)", color: "#FFFFFF",
          border: "none", borderRadius: "var(--shop-r-pill, 999px)",
          fontWeight: 600, fontSize: 14, cursor: "pointer",
          boxShadow: "0 4px 16px rgba(30,107,255,0.3)",
        }}>
          Start Shopping
        </button>
      </div>
    </div>
  );
}

function LoadingPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg, #F7F8FB)" }}>
      <div style={{
        height: 56, display: "flex", alignItems: "center", gap: 12,
        padding: "0 16px", background: "var(--shop-surface, #FFFFFF)",
        borderBottom: "1px solid var(--shop-divider, #ECEEF3)",
      }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--shop-black, #0B0B0F)" }}>My Cart</span>
      </div>
      <div style={{ padding: 16 }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{
            height: 100, background: "var(--shop-surface, #FFFFFF)",
            borderRadius: "var(--shop-r-card, 16px)",
            boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
            marginBottom: 12, animation: "cartPulse 1.5s infinite",
          }} />
        ))}
      </div>
      <style>{`@keyframes cartPulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}
