"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { LoginGate } from "@/components/shop/LoginGate";
import type { Order } from "@/types";

const TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

export default function OrdersPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");

  const fetchOrders = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try { setOrders(await api.get<Order[]>("/orders")); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useAutoRefresh(fetchOrders, { interval: 15000, enabled: !!user });

  const filtered = orders.filter(o => {
    if (tab === "active") return ["pending", "confirmed", "processing", "shipped"].includes(o.status);
    if (tab === "completed") return o.status === "delivered";
    if (tab === "cancelled") return o.status === "cancelled";
    return true;
  });

  const tabCount = (key: string) => orders.filter(o => {
    if (key === "active") return ["pending", "confirmed", "processing", "shipped"].includes(o.status);
    if (key === "completed") return o.status === "delivered";
    if (key === "cancelled") return o.status === "cancelled";
    return true;
  }).length;

  if (!user) return <LoginGate><div /></LoginGate>;

  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg, #F7F8FB)" }}>
      {/* Navy header */}
      <div style={{
        background: "#103562",
        borderRadius: "0 0 20px 20px",
        padding: "12px 20px",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <h1 style={{
          fontSize: 16, fontWeight: 500, color: "#FFFFFF", margin: 0,
          fontFamily: "'Kantumruy Pro', sans-serif",
        }}>My Orders</h1>
      </div>

      <div style={{ padding: "16px 16px 80px" }}>
        {/* Tab Pills */}
        <div style={{
          display: "flex", gap: 8, overflowX: "auto", marginBottom: 20, paddingBottom: 2,
        }}>
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{
                  flexShrink: 0, padding: "6px 14px", borderRadius: 999,
                  fontSize: 12, fontWeight: active ? 600 : 500, border: "none", cursor: "pointer",
                  transition: "all 0.2s",
                  fontFamily: "'Kantumruy Pro', sans-serif",
                  background: active ? "var(--shop-primary)" : "var(--shop-surface)",
                  color: active ? "#FFFFFF" : "var(--shop-text)",
                  boxShadow: "var(--shop-shadow)",
                }}>
                {t.label} ({tabCount(t.key)})
              </button>
            );
          })}
        </div>

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{
                height: 140, background: "var(--shop-divider, #ECEEF3)",
                borderRadius: "var(--shop-r-card, 16px)", animation: "pulse 1.5s infinite",
              }} />
            ))}
          </div>
        ) : filtered.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filtered.map(order => (
              <button key={order.id} onClick={() => router.push(`/shop/order/${order.id}`)}
                style={{
                  width: "100%", textAlign: "left",
                  background: "var(--shop-surface, #FFFFFF)", border: "none",
                  borderRadius: "var(--shop-r-card, 16px)", padding: 16, cursor: "pointer",
                  boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
                  transition: "transform 0.15s",
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{
                    fontSize: 12, fontFamily: "monospace", color: "var(--shop-muted, #8A8F9C)",
                    fontWeight: 500,
                  }}>#{order.order_code}</span>
                  <StatusBadge status={order.status} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--shop-black, #0B0B0F)" }}>
                    {order.merchant_name || "Shop"}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--shop-muted, #8A8F9C)" }}>
                    {formatDate(order.created_at)}
                  </span>
                </div>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  borderTop: "1px solid var(--shop-divider, #ECEEF3)", paddingTop: 10, marginTop: 4,
                }}>
                  <span style={{ fontWeight: 700, fontSize: 16, color: "var(--shop-black, #0B0B0F)" }}>
                    ${Number(order.total).toFixed(2)}
                  </span>
                  <span style={{
                    fontSize: 13, color: "var(--shop-primary, #1E6BFF)", fontWeight: 600,
                  }}>View Details &rarr;</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Empty icon="🛍️" message="No orders yet" action="Start Shopping" onAction={() => router.push("/shop")} />
        )}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}

function Empty({ icon, message, action, onAction }: { icon: string; message: string; action?: string; onAction?: () => void }) {
  return (
    <div style={{ textAlign: "center", paddingTop: 60 }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>{icon}</div>
      <p style={{ color: "var(--shop-muted, #8A8F9C)", fontSize: 14 }}>{message}</p>
      {action && onAction && (
        <button onClick={onAction} style={{
          marginTop: 16, padding: "12px 28px",
          background: "var(--shop-primary, #1E6BFF)", color: "#FFFFFF",
          border: "none", borderRadius: "var(--shop-r-pill, 999px)",
          fontWeight: 600, fontSize: 14, cursor: "pointer",
        }}>{action}</button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    pending: { bg: "#FFF3E0", color: "#E65100" },
    confirmed: { bg: "#E3F2FD", color: "#1565C0" },
    processing: { bg: "#F3E5F5", color: "#7B1FA2" },
    shipped: { bg: "#E3F2FD", color: "#1565C0" },
    delivered: { bg: "#E8F5E9", color: "#2E7D32" },
    cancelled: { bg: "#FFEBEE", color: "#C62828" },
  };
  const c = colors[status] || colors.pending;
  return (
    <span style={{
      background: c.bg, color: c.color,
      fontSize: 11, fontWeight: 600, padding: "3px 10px",
      borderRadius: "var(--shop-r-pill, 999px)",
      textTransform: "capitalize",
    }}>{status}</span>
  );
}

function formatDate(d?: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
