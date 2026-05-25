"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import type { Category, CategoryBanner } from "@/types";

export default function BannersPage() {
  const [banners, setBanners] = useState<CategoryBanner[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: "", subtitle: "", category_id: 0, placement: "home" as "home" | "category" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string, ok = true) => {
    setToast({ show: true, msg, ok });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 3000);
  };

  async function load() {
    try {
      const [b, c] = await Promise.all([
        api.get<CategoryBanner[]>("/category-banners/all"),
        api.get<Category[]>("/categories"),
      ]);
      setBanners(b);
      setCategories(c);
    } catch { /* */ }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditId(null);
    setForm({ title: "", subtitle: "", category_id: categories[0]?.id || 0, placement: "home" });
    setModal(true);
  }

  function openEdit(b: CategoryBanner) {
    setEditId(b.id);
    setForm({ title: b.title, subtitle: b.subtitle || "", category_id: b.category_id, placement: b.placement });
    setModal(true);
  }

  async function save() {
    if (!form.title.trim()) { flash("Title required", false); return; }
    if (!form.category_id) { flash("Select a category", false); return; }
    setSaving(true);
    try {
      if (editId) {
        await api.patch(`/category-banners/${editId}`, form);
        flash("Updated!");
      } else {
        await api.post("/category-banners", form);
        flash("Created! Now upload an image.");
      }
      setModal(false);
      load();
    } catch (e: any) { flash(e.detail || "Error", false); }
    setSaving(false);
  }

  async function handleImageUpload(bannerId: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.upload(`/category-banners/${bannerId}/image`, fd);
      flash("Image uploaded!");
      load();
    } catch { flash("Upload failed", false); }
    setUploading(false);
  }

  async function toggleActive(b: CategoryBanner) {
    try {
      await api.patch(`/category-banners/${b.id}`, { is_active: !b.is_active });
      load();
    } catch { flash("Failed to toggle", false); }
  }

  async function deleteBanner(id: number) {
    if (!confirm("Delete this banner?")) return;
    try { await api.delete(`/category-banners/${id}`); flash("Deleted"); load(); }
    catch { flash("Failed to delete", false); }
  }

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", fontFamily: "'Kantumruy Pro', sans-serif" }}>
            Category Banners
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
            Promotional banners linked to categories — displayed on home page or category pages
          </p>
        </div>
        <button className="btn-primary" onClick={openCreate}>+ Add Banner</button>
      </div>

      {/* Banner cards grid */}
      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
      ) : banners.length === 0 ? (
        <div className="admin-card" style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
          No banners yet. Click &quot;+ Add Banner&quot; to create one.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {banners.map(b => (
            <div key={b.id} className="admin-card" style={{ padding: 0, overflow: "hidden", opacity: b.is_active ? 1 : 0.5 }}>
              {/* Image preview */}
              <div style={{
                position: "relative", width: "100%", height: 176,
                background: b.image_url ? "none" : "var(--bg)",
                borderRadius: "12px 12px 0 0", overflow: "hidden",
              }}>
                {b.image_url ? (
                  <>
                    <img src={b.image_url} alt={b.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.6) 100%)" }} />
                    <div style={{ position: "absolute", bottom: 12, left: 12, right: 12 }}>
                      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#EAEFF3", fontFamily: "'Kantumruy Pro', sans-serif", lineHeight: "22px" }}>
                        {b.title}
                      </h3>
                      {b.subtitle && (
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2, fontFamily: "'Inter', sans-serif" }}>
                          {b.subtitle}
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8 }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                      <rect x="2" y="2" width="20" height="20" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                    <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No image — upload one</p>
                  </div>
                )}
              </div>

              {/* Info + actions */}
              <div style={{ padding: 12 }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                    fontFamily: "'Kantumruy Pro', sans-serif",
                    background: b.placement === "home" ? "var(--accent-light)" : "rgba(214, 186, 128, 0.15)",
                    color: b.placement === "home" ? "var(--accent)" : "#71541A",
                  }}>
                    {b.placement === "home" ? "Home Page" : "Category Page"}
                  </span>
                  <span style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                    fontFamily: "'Kantumruy Pro', sans-serif",
                    background: "var(--accent-light)", color: "var(--accent)",
                  }}>
                    {b.category_name || `Category #${b.category_id}`}
                  </span>
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                  <label style={{
                    flex: 1, padding: "6px", borderRadius: 6,
                    background: "var(--accent)", color: "#fff", fontSize: 12, fontWeight: 500,
                    cursor: uploading ? "not-allowed" : "pointer",
                    fontFamily: "'Kantumruy Pro', sans-serif",
                    textAlign: "center",
                  }}>
                    {uploading ? "..." : "Upload Image"}
                    <input type="file" accept="image/*" style={{ display: "none" }}
                      onChange={(e) => handleImageUpload(b.id, e)} disabled={uploading} />
                  </label>
                  <button onClick={() => openEdit(b)} style={{
                    padding: "6px 10px", borderRadius: 6, border: "none",
                    background: "var(--accent-light)", color: "var(--accent)",
                    fontSize: 12, cursor: "pointer",
                  }}>Edit</button>
                  <button onClick={() => toggleActive(b)} style={{
                    padding: "6px 10px", borderRadius: 6, border: "none",
                    background: b.is_active ? "rgba(239, 68, 68, 0.08)" : "rgba(16, 181, 129, 0.08)",
                    color: b.is_active ? "#EF4444" : "#10B981",
                    fontSize: 12, cursor: "pointer",
                  }}>{b.is_active ? "Hide" : "Show"}</button>
                  <button onClick={() => deleteBanner(b.id)} style={{
                    padding: "6px 10px", borderRadius: 6, border: "none",
                    background: "rgba(239, 68, 68, 0.08)", color: "#EF4444",
                    fontSize: 12, cursor: "pointer",
                  }}>Del</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal-content" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", fontFamily: "'Kantumruy Pro', sans-serif", marginBottom: 20 }}>
              {editId ? "Edit Banner" : "New Banner"}
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={lbl}>Title *</label>
                <input className="admin-input" value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Summer Skincare Sale" />
              </div>

              <div>
                <label style={lbl}>Subtitle</label>
                <input className="admin-input" value={form.subtitle}
                  onChange={e => setForm({ ...form, subtitle: e.target.value })}
                  placeholder="e.g. Up to 30% off selected items" />
              </div>

              <div>
                <label style={lbl}>Category *</label>
                <select className="admin-input" value={form.category_id}
                  onChange={e => setForm({ ...form, category_id: +e.target.value })}>
                  <option value={0}>Select category...</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.merchant_id === null ? " (Global)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={lbl}>Display on</label>
                <select className="admin-input" value={form.placement}
                  onChange={e => setForm({ ...form, placement: e.target.value as "home" | "category" })}>
                  <option value="home">Home Page</option>
                  <option value="category">Category Page</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 }}>
              <button className="btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? "Saving..." : editId ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const lbl: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600,
  color: "var(--text)", marginBottom: 4,
  fontFamily: "'Kantumruy Pro', sans-serif",
};
