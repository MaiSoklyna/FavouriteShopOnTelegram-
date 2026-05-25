"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { Order } from "@/types";

const TIMELINE = [
  { key: "pending", label: "Ordered", msg: "Your order has been placed" },
  { key: "confirmed", label: "Confirmed", msg: "Merchant confirmed your order" },
  { key: "processing", label: "Packaged", msg: "Order is being prepared" },
  { key: "shipped", label: "Shipped", msg: "Order is on the way" },
  { key: "delivered", label: "Delivered", msg: "Order delivered successfully" },
];

export default function OrderDetailPage() {
  return <Suspense><OrderDetailContent /></Suspense>;
}

function OrderDetailContent() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const placed = searchParams.get("placed") === "true";

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [showSuccess, setShowSuccess] = useState(placed);
  const [showItems, setShowItems] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);

  const fetchOrder = useCallback(async () => {
    try { setOrder(await api.get<Order>(`/orders/${id}`)); }
    catch { router.back(); }
    finally { setLoading(false); }
  }, [id, router]);

  useEffect(() => { fetchOrder(); }, [fetchOrder]);
  useAutoRefresh(fetchOrder, { interval: 10000 });

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
      alert("Review submitted! Thank you.");
    } catch (e: any) { alert(e.detail || "Failed to submit review"); }
    finally { setSubmittingReview(false); }
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg, #F7F8FB)" }}>
      <div style={{
        height: 56, display: "flex", alignItems: "center", gap: 12,
        background: "var(--shop-surface, #FFFFFF)", borderBottom: "1px solid var(--shop-divider, #ECEEF3)",
        padding: "0 16px",
      }}>
        <BackButton />
        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--shop-black, #0B0B0F)" }}>Order Details</span>
      </div>
      <div style={{ padding: 16 }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{
            height: 80, background: "var(--shop-divider, #ECEEF3)",
            borderRadius: "var(--shop-r-card, 16px)", marginBottom: 12,
            animation: "pulse 1.5s infinite",
          }} />
        ))}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );

  if (!order) return null;

  const stepIdx = TIMELINE.findIndex(s => s.key === order.status);
  const isCancelled = order.status === "cancelled";

  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg, #F7F8FB)" }}>
      {/* Top Bar */}
      <div style={{
        height: 56, display: "flex", alignItems: "center", gap: 12,
        background: "var(--shop-surface, #FFFFFF)", borderBottom: "1px solid var(--shop-divider, #ECEEF3)",
        padding: "0 16px", position: "sticky", top: 0, zIndex: 10,
      }}>
        <BackButton />
        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--shop-black, #0B0B0F)" }}>
          Order #{order.order_code}
        </span>
      </div>

      <div style={{ padding: "16px 16px 80px" }}>
        {showSuccess && (
          <div style={{
            background: "#E8F5E9", border: "1px solid #A5D6A7",
            borderRadius: "var(--shop-r-card, 16px)", padding: 16, marginBottom: 16,
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: "#C8E6C9", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, flexShrink: 0,
            }}>&#10003;</div>
            <div>
              <p style={{ fontWeight: 600, fontSize: 14, color: "#2E7D32" }}>Order placed!</p>
              <p style={{ fontSize: 12, color: "#388E3C" }}>We&apos;ll notify you when confirmed</p>
            </div>
          </div>
        )}

        {/* Timeline */}
        {!isCancelled && (
          <div style={{
            background: "var(--shop-surface, #FFFFFF)",
            borderRadius: "var(--shop-r-card, 16px)", padding: 20, marginBottom: 12,
            boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", marginBottom: 16 }}>
              Order Progress
            </h3>
            {TIMELINE.map((step, i) => {
              const done = i <= stepIdx;
              const isCurrent = i === stepIdx;
              return (
                <div key={step.key} style={{ display: "flex", gap: 14 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 700,
                      background: done ? (isCurrent ? "var(--shop-primary, #1E6BFF)" : "#2E7D32") : "var(--shop-divider, #ECEEF3)",
                      color: done ? "#FFFFFF" : "var(--shop-muted, #8A8F9C)",
                      transition: "all 0.3s",
                    }}>
                      {done ? "✓" : i + 1}
                    </div>
                    {i < TIMELINE.length - 1 && (
                      <div style={{
                        width: 2, height: 32,
                        background: done ? (isCurrent ? "var(--shop-primary, #1E6BFF)" : "#2E7D32") : "var(--shop-divider, #ECEEF3)",
                      }} />
                    )}
                  </div>
                  <div style={{ paddingBottom: 10 }}>
                    <p style={{
                      fontSize: 14, fontWeight: 600,
                      color: done ? "var(--shop-black, #0B0B0F)" : "var(--shop-muted, #8A8F9C)",
                    }}>{step.label}</p>
                    <p style={{ fontSize: 12, color: "var(--shop-muted, #8A8F9C)" }}>{step.msg}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {isCancelled && (
          <div style={{
            background: "#FFEBEE", border: "1px solid #EF9A9A",
            borderRadius: "var(--shop-r-card, 16px)", padding: 16, marginBottom: 12,
            display: "flex", gap: 12, alignItems: "center",
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: "#FFCDD2", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, flexShrink: 0,
            }}>&#10005;</div>
            <p style={{ fontWeight: 600, color: "#C62828", fontSize: 14 }}>Order Cancelled</p>
          </div>
        )}

        {/* Items */}
        <div style={{
          background: "var(--shop-surface, #FFFFFF)",
          borderRadius: "var(--shop-r-card, 16px)", padding: 16, marginBottom: 12,
          boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
        }}>
          <button onClick={() => setShowItems(!showItems)} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            width: "100%", background: "none", border: "none", cursor: "pointer",
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", margin: 0 }}>
              Items ({order.items?.length || 0})
            </h3>
            <span style={{
              fontSize: 12, color: "var(--shop-primary, #1E6BFF)", fontWeight: 600,
            }}>{showItems ? "Hide" : "Show"}</span>
          </button>
          {(showItems || (order.items?.length || 0) <= 3) && order.items?.map((item, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", fontSize: 13,
              padding: "10px 0",
              borderTop: "1px solid var(--shop-divider, #ECEEF3)",
              marginTop: i === 0 ? 10 : 0,
            }}>
              <span style={{ color: "var(--shop-text, #4A4E5A)" }}>{item.product_name} x{item.quantity}</span>
              <span style={{ fontWeight: 600, color: "var(--shop-black, #0B0B0F)" }}>
                ${Number(item.subtotal).toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        {/* Price */}
        <div style={{
          background: "var(--shop-surface, #FFFFFF)",
          borderRadius: "var(--shop-r-card, 16px)", padding: 16, marginBottom: 12,
          boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 10 }}>
            <span style={{ color: "var(--shop-muted, #8A8F9C)" }}>Subtotal</span>
            <span style={{ fontWeight: 600, color: "var(--shop-text, #4A4E5A)" }}>
              ${Number(order.subtotal || order.total).toFixed(2)}
            </span>
          </div>
          {(order.discount_amount || 0) > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 10 }}>
              <span style={{ color: "var(--shop-muted, #8A8F9C)" }}>Discount</span>
              <span style={{ fontWeight: 600, color: "#2E7D32" }}>-${Number(order.discount_amount).toFixed(2)}</span>
            </div>
          )}
          <div style={{ height: 1, background: "var(--shop-divider, #ECEEF3)", margin: "10px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--shop-black, #0B0B0F)" }}>Total</span>
            <span style={{ fontWeight: 700, fontSize: 20, color: "var(--shop-primary, #1E6BFF)" }}>
              ${Number(order.total).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Address */}
        <div style={{
          background: "var(--shop-surface, #FFFFFF)",
          borderRadius: "var(--shop-r-card, 16px)", padding: 16, marginBottom: 20,
          boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: "var(--shop-primary-tint, #E8F0FF)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
            }}>📍</div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", margin: 0 }}>Delivery</h3>
          </div>
          <p style={{ fontSize: 14, fontWeight: 500, color: "var(--shop-black, #0B0B0F)" }}>
            {order.customer_name || "Customer"}
          </p>
          <p style={{ fontSize: 13, color: "var(--shop-muted, #8A8F9C)", marginTop: 4 }}>
            {order.delivery_address}
          </p>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {order.status === "pending" && (
            <button onClick={handleCancel} disabled={cancelling}
              style={{
                width: "100%", padding: 14,
                borderRadius: "var(--shop-r-input, 12px)",
                border: "2px solid #C62828", background: "transparent",
                color: "#C62828", fontWeight: 600, fontSize: 14,
                cursor: "pointer", opacity: cancelling ? 0.5 : 1,
              }}>
              {cancelling ? "Cancelling..." : "Cancel Order"}
            </button>
          )}
          {order.status === "delivered" && (
            (order.items?.length || 0) <= 1 ? (
              <button onClick={() => openReview()}
                style={{
                  width: "100%", padding: 14,
                  borderRadius: 8,
                  border: "none",
                  background: "var(--shop-primary)", color: "#FFFFFF",
                  fontWeight: 500, fontSize: 14, cursor: "pointer",
                  fontFamily: "'Kantumruy Pro', sans-serif",
                }}>
                Write Review
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--shop-text)", fontFamily: "'Kantumruy Pro', sans-serif" }}>
                  Review your items:
                </p>
                {order.items?.map(item => (
                  <button key={item.id} onClick={() => openReview(item.product_id)}
                    style={{
                      width: "100%", padding: "10px 14px",
                      borderRadius: 8, border: "1px solid var(--shop-divider)",
                      background: "var(--shop-surface)", color: "var(--shop-primary)",
                      fontWeight: 500, fontSize: 13, cursor: "pointer",
                      fontFamily: "'Kantumruy Pro', sans-serif",
                      textAlign: "left",
                    }}>
                    Review: {item.product_name}
                  </button>
                ))}
              </div>
            )
          )}
          <button onClick={() => router.push("/shop/support")}
            style={{
              width: "100%", padding: 14,
              borderRadius: "var(--shop-r-input, 12px)",
              border: "1.5px solid var(--shop-primary, #1E6BFF)",
              background: "transparent", color: "var(--shop-primary, #1E6BFF)",
              fontWeight: 600, fontSize: 14, cursor: "pointer",
            }}>
            Need Help?
          </button>
        </div>

        {/* Review modal */}
        {showReview && (
          <div style={{
            position: "fixed", inset: 0, zIndex: 50,
            background: "rgba(11,11,15,0.4)", display: "flex", alignItems: "flex-end",
          }}>
            <div style={{
              width: "100%", background: "var(--shop-surface, #FFFFFF)",
              borderRadius: "24px 24px 0 0", padding: 24,
              paddingBottom: "max(24px, env(safe-area-inset-bottom))",
            }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", marginBottom: 16 }}>
                Write a Review
              </h3>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {[1, 2, 3, 4, 5].map(s => (
                  <button key={s} onClick={() => setReviewRating(s)} style={{
                    fontSize: 28, background: "none", border: "none", cursor: "pointer",
                    color: s <= reviewRating ? "#F59E0B" : "#D1D5DB",
                  }}>&#9733;</button>
                ))}
              </div>
              <textarea value={reviewComment} onChange={e => setReviewComment(e.target.value)} rows={4}
                placeholder="Share your experience..."
                style={{
                  width: "100%", padding: "12px 14px",
                  borderRadius: "var(--shop-r-input, 12px)",
                  border: "1.5px solid var(--shop-divider, #ECEEF3)",
                  background: "var(--shop-bg, #F7F8FB)", color: "var(--shop-black, #0B0B0F)",
                  fontSize: 14, marginBottom: 16, resize: "vertical",
                }} />
              <button onClick={handleReview} disabled={submittingReview}
                style={{
                  width: "100%", padding: 14,
                  borderRadius: "var(--shop-r-input, 12px)",
                  border: "none", background: "var(--shop-primary, #1E6BFF)",
                  color: "#FFFFFF", fontWeight: 600, fontSize: 14,
                  cursor: "pointer", opacity: submittingReview ? 0.5 : 1, marginBottom: 8,
                }}>
                {submittingReview ? "Submitting..." : "Submit Review"}
              </button>
              <button onClick={() => setShowReview(false)} style={{
                width: "100%", padding: 10, background: "none", border: "none",
                color: "var(--shop-muted, #8A8F9C)", cursor: "pointer", fontSize: 13,
              }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}

function BackButton() {
  const router = useRouter();
  return (
    <button onClick={() => router.back()} style={{
      width: 36, height: 36, borderRadius: "50%",
      background: "var(--shop-bg, #F7F8FB)", border: "none",
      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 16, color: "var(--shop-black, #0B0B0F)", flexShrink: 0,
    }}>&#8592;</button>
  );
}
