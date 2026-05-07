"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { PromoCode } from "@/types";

export default function PromotionsPage() {
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ code: "", type: "percent" as "percent" | "fixed", value: 0, min_order: 0, max_uses: 0, expires_at: "", is_active: true });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });

  const flash = (msg: string, ok = true) => { setToast({ show: true, msg, ok }); setTimeout(() => setToast(t => ({ ...t, show: false })), 3000); };

  async function load() { try { setPromos(await api.get<PromoCode[]>("/promos")); } catch { /* */ } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  function openCreate() { setEditId(null); setForm({ code: "", type: "percent", value: 0, min_order: 0, max_uses: 0, expires_at: "", is_active: true }); setModal(true); }
  function openEdit(p: PromoCode) { setEditId(p.id); setForm({ code: p.code, type: p.type, value: p.value, min_order: p.min_order || 0, max_uses: p.max_uses || 0, expires_at: p.expires_at ? p.expires_at.slice(0, 16) : "", is_active: p.is_active }); setModal(true); }

  async function save() {
    if (!form.code.trim()) { flash("Code required", false); return; }
    setSaving(true);
    try {
      const data = { ...form, max_uses: form.max_uses || null, expires_at: form.expires_at || null, min_order: form.min_order || null };
      if (editId) { await api.patch(`/promos/${editId}`, data); } else { await api.post("/promos", data); }
      flash(editId ? "Updated!" : "Created!"); setModal(false); load();
    } catch (e: any) { flash(e.detail || "Error", false); }
    setSaving(false);
  }

  async function deletePromo(id: number) { if (!confirm("Delete?")) return; await api.delete(`/promos/${id}`); flash("Deleted"); load(); }

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div><h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Promotions</h1><p style={{ fontSize: 13, color: "var(--text-muted)" }}>{promos.length} promo codes</p></div>
        <button className="btn-primary" onClick={openCreate}>+ Add Promo</button>
      </div>

      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div> : (
          <table className="admin-table">
            <thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Min Order</th><th>Used</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {promos.length === 0 ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No promo codes</td></tr> :
              promos.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600, fontFamily: "monospace" }}>{p.code}</td>
                  <td><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "var(--bg-secondary)" }}>{p.type}</span></td>
                  <td style={{ fontWeight: 600 }}>{p.type === "percent" ? `${p.value}%` : `$${p.value}`}</td>
                  <td>{p.min_order ? `$${p.min_order}` : "—"}</td>
                  <td>{p.used_count}{p.max_uses ? `/${p.max_uses}` : ""}</td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.expires_at ? new Date(p.expires_at).toLocaleDateString() : "Never"}</td>
                  <td><span className={`badge ${p.is_active ? "badge-delivered" : "badge-cancelled"}`}>{p.is_active ? "Active" : "Inactive"}</span></td>
                  <td><div style={{ display: "flex", gap: 4 }}><button onClick={() => openEdit(p)} style={{ background: "none", border: "none", cursor: "pointer" }}>✏️</button><button onClick={() => deletePromo(p.id)} style={{ background: "none", border: "none", cursor: "pointer" }}>🗑️</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal-content" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>{editId ? "Edit Promo" : "New Promo Code"}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div><label style={lbl}>Code *</label><input className="admin-input" style={{ fontFamily: "monospace", textTransform: "uppercase" }} value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SUMMER20" /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div><label style={lbl}>Type</label><select className="admin-input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value as any })}><option value="percent">Percent (%)</option><option value="fixed">Fixed ($)</option></select></div>
                <div><label style={lbl}>Value *</label><input type="number" step="0.01" className="admin-input" value={form.value || ""} onChange={e => setForm({ ...form, value: +e.target.value })} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div><label style={lbl}>Min Order ($)</label><input type="number" step="0.01" className="admin-input" value={form.min_order || ""} onChange={e => setForm({ ...form, min_order: +e.target.value })} /></div>
                <div><label style={lbl}>Max Uses</label><input type="number" className="admin-input" value={form.max_uses || ""} onChange={e => setForm({ ...form, max_uses: +e.target.value })} placeholder="Unlimited" /></div>
              </div>
              <div><label style={lbl}>Expires At</label><input type="datetime-local" className="admin-input" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} /></div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}><input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} /> Active</label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button className="btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving..." : editId ? "Update" : "Create"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 };
