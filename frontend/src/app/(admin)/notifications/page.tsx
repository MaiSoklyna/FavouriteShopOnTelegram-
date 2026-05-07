"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { Notification } from "@/types";

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", type: "promo", user_ids: "" });
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });

  const flash = (msg: string, ok = true) => { setToast({ show: true, msg, ok }); setTimeout(() => setToast(t => ({ ...t, show: false })), 3000); };

  async function load() { try { setNotifications(await api.get<Notification[]>("/notifications/admin/list")); } catch { /* */ } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  async function send() {
    if (!form.title.trim() || !form.body.trim()) { flash("Title and body required", false); return; }
    setSending(true);
    try {
      const ids = form.user_ids.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      await api.post("/notifications/admin/send", { title: form.title, body: form.body, type: form.type, user_ids: ids.length ? ids : undefined });
      flash("Sent!"); setModal(false); load();
    } catch (e: any) { flash(e.detail || "Error", false); }
    setSending(false);
  }

  async function deleteNotif(id: number) { await api.delete(`/notifications/admin/${id}`); load(); }

  const typeIcon: Record<string, string> = { promo: "🏷️", order: "📦", system: "⚙️", loyalty: "⭐" };

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div><h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Notifications</h1><p style={{ fontSize: 13, color: "var(--text-muted)" }}>{notifications.length} sent</p></div>
        <button className="btn-primary" onClick={() => { setForm({ title: "", body: "", type: "promo", user_ids: "" }); setModal(true); }}>+ Send Notification</button>
      </div>

      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div> : (
          <table className="admin-table">
            <thead><tr><th>Type</th><th>Title</th><th>Body</th><th>User</th><th>Read</th><th>Date</th><th></th></tr></thead>
            <tbody>
              {notifications.length === 0 ? <tr><td colSpan={7} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No notifications</td></tr> :
              notifications.map(n => (
                <tr key={n.id}>
                  <td>{typeIcon[n.type] || "📋"} <span style={{ fontSize: 11 }}>{n.type}</span></td>
                  <td style={{ fontWeight: 600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title}</td>
                  <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)", fontSize: 12 }}>{n.body}</td>
                  <td style={{ fontSize: 12 }}>{n.user_name || `#${n.user_id}`}</td>
                  <td>{n.is_read ? <span style={{ color: "var(--success)" }}>✓</span> : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{n.sent_at ? new Date(n.sent_at).toLocaleDateString() : "—"}</td>
                  <td><button onClick={() => deleteNotif(n.id!)} style={{ background: "none", border: "none", cursor: "pointer" }}>🗑️</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal-content" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Send Notification</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div><label style={lbl}>Type</label><select className="admin-input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option value="promo">Promo</option><option value="order">Order</option><option value="system">System</option><option value="loyalty">Loyalty</option></select></div>
              <div><label style={lbl}>Title *</label><input className="admin-input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Notification title" /></div>
              <div><label style={lbl}>Body *</label><textarea className="admin-input" rows={3} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="Notification message..." /></div>
              <div><label style={lbl}>User IDs (comma-separated, leave empty for all)</label><input className="admin-input" value={form.user_ids} onChange={e => setForm({ ...form, user_ids: e.target.value })} placeholder="1, 2, 3" /></div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button className="btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={send} disabled={sending}>{sending ? "Sending..." : "Send"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 };
