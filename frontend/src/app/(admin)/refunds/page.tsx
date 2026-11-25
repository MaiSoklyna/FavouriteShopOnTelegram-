"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { BrandLoader } from "@/components/ui/Spinner";
import type { Refund } from "@/types";

type Tab = "pending" | "refunded";
const METHOD: Record<string, string> = { khqr: "ABA KHQR", stripe: "Card (Stripe)" };

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * Money owed back to customers: paid KHQR/card orders that were cancelled, or payments that arrived
 * after an order was cancelled or had expired. Send the money back outside the app (bank / ABA, or
 * refund the payment in the Stripe dashboard), then mark it sent here with the reference.
 */
export default function RefundsPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [rows, setRows] = useState<Refund[]>([]);
  const [summary, setSummary] = useState({ pending_count: 0, pending_amount: "0.00" });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Refund | null>(null);
  const [form, setForm] = useState({ reference: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });

  const flash = (msg: string, ok = true) => { setToast({ show: true, msg, ok }); setTimeout(() => setToast(t => ({ ...t, show: false })), 3500); };
  const load = useCallback(async () => {
    try {
      const res = await api.get<{ data: Refund[]; summary: typeof summary }>(`/refunds/admin?status=${tab}`);
      setRows(res.data); setSummary(res.summary);
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, [tab]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useAutoRefresh(load, { interval: 30000 });

  async function markSent() {
    if (!open) return;
    if (!form.reference.trim()) { flash("Enter the transfer or Stripe refund reference", false); return; }
    setSaving(true);
    try {
      await api.post(`/refunds/admin/${open.id}/complete`, { reference: form.reference.trim(), note: form.note.trim() || null });
      flash(`Refund for ${open.order_code} marked as sent`); setOpen(null); load();
    } catch (e: any) { flash(e?.detail || e?.message || "Could not save", false); }
    setSaving(false);
  }

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Refunds</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Customers who paid by KHQR or card for an order that didn&apos;t go ahead. Send the money back, then mark it sent with the reference.
        </p>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="admin-card" style={{ padding: "12px 16px", minWidth: 180 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>To send</div>
          <div style={{ fontSize: 22, fontWeight: 700 }} data-testid="refunds-pending-count">{summary.pending_count}</div>
        </div>
        <div className="admin-card" style={{ padding: "12px 16px", minWidth: 180 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Owed to customers</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>${Number(summary.pending_amount).toFixed(2)}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["pending", "refunded"] as Tab[]).map(t => (
          <button key={t} className={tab === t ? "btn-primary" : "btn-outline"} onClick={() => setTab(t)}>
            {t === "pending" ? "To send" : "Sent"}
          </button>
        ))}
      </div>

      <div className="admin-card" style={{ padding: 0, overflow: "auto" }}>
        {loading ? <BrandLoader /> : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Order</th><th>Shop</th><th>Amount</th><th>Paid with</th><th>Why</th>
                <th>{tab === "pending" ? "Since" : "Sent"}</th><th>{tab === "pending" ? "" : "Reference"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                  {tab === "pending" ? "Nothing to refund." : "No refunds sent yet."}
                </td></tr>
              ) : rows.map(r => (
                <tr key={r.id} data-testid={`refund-${r.id}`}>
                  <td style={{ fontWeight: 600 }}>{r.order_code || `#${r.order_id}`}</td>
                  <td style={{ fontSize: 12 }}>{r.merchant_name || (r.merchant_id ? `Shop #${r.merchant_id}` : "—")}</td>
                  <td style={{ fontWeight: 700 }}>${Number(r.amount).toFixed(2)}</td>
                  <td style={{ fontSize: 12 }}>
                    {METHOD[r.payment_method] || r.payment_method}
                    {r.payment_ref && <div style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)" }}>{r.payment_ref}</div>}
                  </td>
                  <td style={{ fontSize: 12, maxWidth: 260 }}>{r.reason_text}</td>
                  <td style={{ fontSize: 12 }}>{when(tab === "pending" ? r.created_at : r.completed_at)}</td>
                  <td style={{ fontSize: 12 }}>
                    {tab === "pending"
                      ? <button className="btn-primary" onClick={() => { setForm({ reference: "", note: "" }); setOpen(r); }}>Mark sent</button>
                      : <>
                          <span style={{ fontFamily: "monospace" }}>{r.refund_reference}</span>
                          {r.completed_by_name && <div style={{ color: "var(--text-muted)", fontSize: 11 }}>by {r.completed_by_name}</div>}
                        </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(null)}>
          <div className="modal-content" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Refund ${Number(open.amount).toFixed(2)} for {open.order_code}</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              {open.payment_method === "stripe"
                ? "Refund the payment in the Stripe dashboard, then paste the refund id (re_…)."
                : "Send the money to the customer (ABA or bank transfer), then enter the transfer reference."}
              {" "}The customer is told the refund was sent.
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              <label>Reference<input className="admin-input" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder={open.payment_method === "stripe" ? "re_3Q…" : "ABA transaction id"} autoFocus /></label>
              <label>Note (optional)<input className="admin-input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="e.g. sent to the customer's ABA 012 345 678" /></label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn-outline" style={{ flex: 1 }} onClick={() => setOpen(null)}>Cancel</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={markSent} disabled={saving}>{saving ? "Saving…" : "Mark sent"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
