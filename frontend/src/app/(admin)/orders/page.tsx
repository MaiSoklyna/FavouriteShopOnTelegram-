"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { Order } from "@/types";

const TABS = ["all", "pending", "confirmed", "processing", "shipped", "delivered", "cancelled"];
const NEXT: Record<string, string[]> = { pending: ["confirmed", "cancelled"], confirmed: ["processing", "cancelled"], processing: ["shipped", "cancelled"], shipped: ["delivered"] };
const STATUS_COLORS: Record<string, string> = { pending: "badge-pending", confirmed: "badge-confirmed", processing: "badge-processing", shipped: "badge-shipped", delivered: "badge-delivered", cancelled: "badge-cancelled" };

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Order | null>(null);

  const load = useCallback(async () => {
    try {
      const params: Record<string, any> = { page_size: 50 };
      if (tab !== "all") params.status = tab;
      const data = await api.get<Order[]>("/orders/admin/list", { params });
      setOrders(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { setLoading(true); load(); }, [tab, load]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [search]);
  useAutoRefresh(load, { interval: 15000 });

  async function openDetail(id: number) {
    try { setDetail(await api.get<Order>(`/orders/${id}`)); } catch { /* ignore */ }
  }

  async function updateStatus(id: number, status: string) {
    await api.patch(`/orders/admin/${id}/status`, { status });
    if (detail?.id === id) openDetail(id);
    load();
  }

  const filtered = search ? orders.filter(o => (o.order_code || "").toLowerCase().includes(search.toLowerCase()) || (o.customer_name || "").toLowerCase().includes(search.toLowerCase())) : orders;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div><h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Orders</h1><p style={{ fontSize: 13, color: "var(--text-muted)" }}>{orders.length} orders</p></div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 500, textTransform: "capitalize", background: tab === t ? "var(--accent)" : "var(--bg-secondary)", color: tab === t ? "var(--bg)" : "var(--text-secondary)", border: "none", cursor: "pointer" }}>{t}</button>
        ))}
      </div>

      <input className="admin-input" style={{ maxWidth: 300, marginBottom: 16 }} placeholder="Search by code or customer..." value={search} onChange={e => setSearch(e.target.value)} />

      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div> : (
          <table className="admin-table">
            <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? <tr><td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No orders</td></tr> :
              filtered.map(o => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 600 }}>{o.order_code || `#${o.id}`}</td>
                  <td><p>{o.customer_name || "—"}</p>{o.customer_phone && <p style={{ fontSize: 10, color: "var(--text-muted)" }}>{o.customer_phone}</p>}</td>
                  <td style={{ fontWeight: 600, fontFamily: "monospace" }}>${Number(o.total).toFixed(2)}</td>
                  <td><span className={`badge ${STATUS_COLORS[o.status] || ""}`}>{o.status}</span></td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{o.created_at ? new Date(o.created_at).toLocaleDateString() : "—"}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button onClick={() => openDetail(o.id)} style={{ background: "none", border: "none", color: "var(--info)", fontWeight: 500, fontSize: 12, cursor: "pointer", padding: 0 }}>View</button>
                      {NEXT[o.status] && (
                        <select
                          value=""
                          onChange={e => { if (e.target.value) updateStatus(o.id, e.target.value); }}
                          style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, cursor: "pointer", textTransform: "capitalize" }}
                        >
                          <option value="">Change status...</option>
                          {NEXT[o.status].map(s => (
                            <option key={s} value={s} style={{ textTransform: "capitalize" }}>
                              {s === "cancelled" ? "Cancel order" : `Mark ${s}`}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail Modal */}
      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal-content" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <div><h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{detail.order_code}</h2>{detail.merchant_name && <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{detail.merchant_name}</p>}</div>
              <span className={`badge ${STATUS_COLORS[detail.status] || ""}`}>{detail.status}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, marginBottom: 16 }}>
              <div><span style={{ color: "var(--text-muted)" }}>Customer: </span>{detail.customer_name || "—"}</div>
              <div><span style={{ color: "var(--text-muted)" }}>Phone: </span>{detail.customer_phone || "—"}</div>
              <div><span style={{ color: "var(--text-muted)" }}>Subtotal: </span>${Number(detail.subtotal).toFixed(2)}</div>
              <div><span style={{ color: "var(--text-muted)" }}>Total: </span><strong>${Number(detail.total).toFixed(2)}</strong></div>
              <div><span style={{ color: "var(--text-muted)" }}>Payment: </span>{detail.payment_method || "—"}</div>
              <div><span style={{ color: "var(--text-muted)" }}>Date: </span>{detail.created_at ? new Date(detail.created_at).toLocaleString() : "—"}</div>
              {detail.delivery_address && <div style={{ gridColumn: "1/3" }}><span style={{ color: "var(--text-muted)" }}>Address: </span>{detail.delivery_address}</div>}
              {detail.customer_note && <div style={{ gridColumn: "1/3" }}><span style={{ color: "var(--text-muted)" }}>Note: </span><em>{detail.customer_note}</em></div>}
            </div>
            {detail.items && detail.items.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase" }}>Items</h4>
                {detail.items.map((item, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                    <span>{item.product_name} x {item.quantity}</span>
                    <span style={{ fontWeight: 600 }}>${Number(item.subtotal).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
            {NEXT[detail.status] && (
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                {NEXT[detail.status].map(s => (
                  <button key={s} onClick={() => updateStatus(detail.id, s)} className={s === "cancelled" ? "btn-danger" : "btn-primary"} style={{ textTransform: "capitalize" }}>
                    {s === "cancelled" ? "Cancel Order" : `Mark ${s}`}
                  </button>
                ))}
              </div>
            )}
            <button className="btn-outline" style={{ width: "100%" }} onClick={() => setDetail(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
