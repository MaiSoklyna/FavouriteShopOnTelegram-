"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { CategoryIcon } from "@/components/shop";
import { IconPicker } from "@/components/admin";
import type { Category } from "@/types";

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", name_kh: "", icon_emoji: "", sort_order: 0 });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });

  const flash = (msg: string, ok = true) => { setToast({ show: true, msg, ok }); setTimeout(() => setToast(t => ({ ...t, show: false })), 3000); };

  async function load() { try { setCategories(await api.get<Category[]>("/categories")); } catch { /* */ } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  function openCreate() { setEditId(null); setForm({ name: "", name_kh: "", icon_emoji: "", sort_order: 0 }); setModal(true); }
  function openEdit(c: Category) { setEditId(c.id); setForm({ name: c.name, name_kh: c.name_kh || "", icon_emoji: c.icon_emoji || "", sort_order: c.sort_order || 0 }); setModal(true); }

  async function save() {
    if (!form.name.trim()) { flash("Name required", false); return; }
    setSaving(true);
    try {
      if (editId) { await api.patch(`/categories/${editId}`, form); } else { await api.post("/categories", form); }
      flash(editId ? "Updated!" : "Created!"); setModal(false); load();
    } catch (e: any) { flash(e.detail || "Error", false); }
    setSaving(false);
  }

  async function deleteCategory(id: number) { if (!confirm("Delete?")) return; await api.delete(`/categories/${id}`); flash("Deleted"); load(); }

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div><h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Categories</h1><p style={{ fontSize: 13, color: "var(--text-muted)" }}>{categories.length} categories</p></div>
        <button className="btn-primary" onClick={openCreate}>+ Add Category</button>
      </div>

      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div> : (
          <table className="admin-table">
            <thead><tr><th>Icon</th><th>Name</th><th>Name (KH)</th><th>Order</th><th>Products</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {categories.length === 0 ? <tr><td colSpan={7} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No categories</td></tr> :
              categories.map(c => (
                <tr key={c.id}>
                  <td><CategoryIcon icon={c.icon_emoji} size={28} fallback="box" alt={c.name} /></td>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td style={{ color: "var(--text-muted)" }}>{c.name_kh || "—"}</td>
                  <td>{c.sort_order}</td>
                  <td>{c.product_count || 0}</td>
                  <td><span className={`badge ${c.is_active !== false ? "badge-delivered" : "badge-cancelled"}`}>{c.is_active !== false ? "Active" : "Hidden"}</span></td>
                  <td><div style={{ display: "flex", gap: 4 }}><button onClick={() => openEdit(c)} style={{ background: "none", border: "none", cursor: "pointer" }}>✏️</button><button onClick={() => deleteCategory(c.id)} style={{ background: "none", border: "none", cursor: "pointer" }}>🗑️</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal-content" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>{editId ? "Edit Category" : "New Category"}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div><label style={lbl}>Name *</label><input className="admin-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><label style={lbl}>Name (Khmer)</label><input className="admin-input" value={form.name_kh} onChange={e => setForm({ ...form, name_kh: e.target.value })} /></div>
              <div>
                <label style={lbl}>Icon</label>
                <IconPicker value={form.icon_emoji} onChange={(v) => setForm({ ...form, icon_emoji: v })} />
              </div>
              <div>
                <label style={lbl}>Sort Order</label>
                <input type="number" className="admin-input" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: +e.target.value })} />
              </div>
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
