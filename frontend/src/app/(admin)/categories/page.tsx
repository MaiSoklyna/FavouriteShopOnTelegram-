"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { IconPicker } from "@/components/admin";
import type { Category } from "@/types";

export default function CategoriesPage() {
  const { isSuperAdmin } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", name_kh: "", icon_emoji: "", image_url: "", sort_order: 0 });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string, ok = true) => { setToast({ show: true, msg, ok }); setTimeout(() => setToast(t => ({ ...t, show: false })), 3000); };

  async function load() { try { setCategories(await api.get<Category[]>("/categories")); } catch { /* */ } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditId(null);
    setForm({ name: "", name_kh: "", icon_emoji: "", image_url: "", sort_order: 0 });
    setImagePreview(null);
    setModal(true);
  }

  function openEdit(c: Category) {
    setEditId(c.id);
    setForm({ name: c.name, name_kh: c.name_kh || "", icon_emoji: c.icon_emoji || "", image_url: (c as any).image_url || "", sort_order: c.sort_order || 0 });
    setImagePreview((c as any).image_url || null);
    setModal(true);
  }

  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !editId) {
      if (!editId) flash("Save the category first, then upload an image", false);
      return;
    }
    setImagePreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await api.upload<{ url: string }>(`/categories/${editId}/image`, fd);
      setForm(f => ({ ...f, image_url: result.url }));
      flash("Image uploaded!");
      load();
    } catch {
      flash("Upload failed", false);
      setImagePreview(null);
    }
    setUploading(false);
  }

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

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{
            fontSize: 22, fontWeight: 700, color: "#081D3C",
            fontFamily: "'Kantumruy Pro', sans-serif",
          }}>
            Categories
          </h1>
          <p style={{ fontSize: 13, color: "#746D6D", marginTop: 2 }}>
            {categories.length} categories
          </p>
        </div>
        <button className="btn-primary" onClick={openCreate}>+ Add Category</button>
      </div>

      {/* Table */}
      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#746D6D" }}>Loading...</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Image</th>
                <th>Name</th>
                <th>Owner</th>
                <th>Name (KH)</th>
                <th>Order</th>
                <th>Products</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 40, color: "#746D6D" }}>
                    No categories yet
                  </td>
                </tr>
              ) : categories.map(c => {
                const iconSrc = (c as any).image_url || (c.icon_emoji && /^https?:\/\//i.test(c.icon_emoji) ? c.icon_emoji : null);
                const emoji = c.icon_emoji && !/^https?:\/\//i.test(c.icon_emoji) ? c.icon_emoji : null;
                return (
                <tr key={c.id}>
                  <td>
                    {iconSrc ? (
                      <img
                        src={iconSrc}
                        alt={c.name}
                        style={{
                          width: 40, height: 40, borderRadius: 8,
                          objectFit: "contain", background: "#EAEFF3",
                        }}
                      />
                    ) : (
                      <div style={{
                        width: 40, height: 40, borderRadius: 8,
                        background: "#EAEFF3",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {emoji ? (
                          <span style={{ fontSize: 20 }}>{emoji}</span>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#746D6D" strokeWidth="1.5">
                            <rect x="3" y="3" width="7" height="7" />
                            <rect x="14" y="3" width="7" height="7" />
                            <rect x="3" y="14" width="7" height="7" />
                            <rect x="14" y="14" width="7" height="7" />
                          </svg>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ fontWeight: 600, color: "#081D3C", fontFamily: "'Kantumruy Pro', sans-serif" }}>
                    {c.name}
                  </td>
                  <td>
                    <span style={{
                      display: "inline-block", padding: "2px 8px", borderRadius: 4,
                      fontSize: 11, fontWeight: 600, fontFamily: "'Kantumruy Pro', sans-serif",
                      background: c.merchant_id ? "rgba(214, 186, 128, 0.15)" : "rgba(16, 53, 98, 0.08)",
                      color: c.merchant_id ? "#71541A" : "#103562",
                    }}>
                      {c.merchant_id ? (c.merchant_name || "Merchant") : "Global"}
                    </span>
                  </td>
                  <td style={{ color: "#746D6D" }}>{c.name_kh || "—"}</td>
                  <td>{c.sort_order}</td>
                  <td>{c.product_count || 0}</td>
                  <td>
                    <span className={`badge ${c.is_active !== false ? "badge-delivered" : "badge-cancelled"}`}>
                      {c.is_active !== false ? "Active" : "Hidden"}
                    </span>
                  </td>
                  <td>
                    {(isSuperAdmin || c.merchant_id !== null) ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => openEdit(c)}
                          title="Edit"
                          style={{
                            background: "rgba(16, 53, 98, 0.08)", border: "none",
                            cursor: "pointer", borderRadius: 6, padding: "6px 8px",
                            color: "#103562", fontSize: 13,
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteCategory(c.id)}
                          title="Delete"
                          style={{
                            background: "rgba(239, 68, 68, 0.08)", border: "none",
                            cursor: "pointer", borderRadius: 6, padding: "6px 8px",
                            color: "#EF4444", fontSize: 13,
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: "#746D6D", fontStyle: "italic" }}>
                        Read-only
                      </span>
                    )}
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal-content" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <h2 style={{
              fontSize: 20, fontWeight: 600, color: "#081D3C",
              fontFamily: "'Kantumruy Pro', sans-serif", marginBottom: 20,
            }}>
              {editId ? "Edit Category" : "New Category"}
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Name */}
              <div>
                <label style={lbl}>Name *</label>
                <input
                  className="admin-input"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Skincare"
                />
              </div>

              {/* Name KH */}
              <div>
                <label style={lbl}>Name (Khmer)</label>
                <input
                  className="admin-input"
                  value={form.name_kh}
                  onChange={e => setForm({ ...form, name_kh: e.target.value })}
                  placeholder="e.g. ថែរក្សាស្បែក"
                />
              </div>

              {/* Category Image */}
              <div>
                <label style={lbl}>Category Image</label>
                <div style={{
                  border: "2px dashed #D6DDE6", borderRadius: 8,
                  padding: 16, textAlign: "center",
                  background: "#F5F7FA",
                }}>
                  {(imagePreview || form.image_url) ? (
                    <div style={{ position: "relative", display: "inline-block" }}>
                      <img
                        src={imagePreview || form.image_url}
                        alt="Preview"
                        style={{
                          width: 120, height: 120, borderRadius: 8,
                          objectFit: "cover", background: "#EAEFF3",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setImagePreview(null);
                          setForm(f => ({ ...f, image_url: "" }));
                          if (fileRef.current) fileRef.current.value = "";
                        }}
                        style={{
                          position: "absolute", top: -8, right: -8,
                          width: 24, height: 24, borderRadius: "50%",
                          background: "#EF4444", color: "#fff", border: "none",
                          cursor: "pointer", fontSize: 12, fontWeight: 700,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#746D6D" strokeWidth="1.5" style={{ margin: "0 auto 8px", display: "block" }}>
                        <rect x="2" y="2" width="20" height="20" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                      <p style={{ fontSize: 12, color: "#746D6D", marginBottom: 4 }}>
                        {editId ? "Click to upload an image" : "Save the category first, then upload"}
                      </p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading || !editId}
                    style={{
                      marginTop: 8, padding: "6px 14px", borderRadius: 6,
                      background: editId ? "#103562" : "#D6DDE6",
                      color: editId ? "#fff" : "#746D6D", border: "none",
                      fontSize: 12, fontWeight: 500, cursor: editId ? "pointer" : "not-allowed",
                      fontFamily: "'Kantumruy Pro', sans-serif",
                    }}
                  >
                    {uploading ? "Uploading..." : "Choose File"}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageFile}
                    style={{ display: "none" }}
                  />
                </div>
                <div style={{ marginTop: 8 }}>
                  <label style={{ ...lbl, marginTop: 4 }}>Or paste image URL</label>
                  <input
                    className="admin-input"
                    value={form.image_url}
                    onChange={e => {
                      setForm({ ...form, image_url: e.target.value });
                      setImagePreview(e.target.value || null);
                    }}
                    placeholder="https://..."
                  />
                </div>
              </div>

              {/* Icon (legacy fallback) */}
              <div>
                <label style={lbl}>Icon (fallback if no image)</label>
                <IconPicker value={form.icon_emoji} onChange={(v) => setForm({ ...form, icon_emoji: v })} />
              </div>

              {/* Sort Order */}
              <div>
                <label style={lbl}>Sort Order</label>
                <input
                  type="number"
                  className="admin-input"
                  value={form.sort_order}
                  onChange={e => setForm({ ...form, sort_order: +e.target.value })}
                />
              </div>
            </div>

            {/* Actions */}
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
  color: "#081D3C", marginBottom: 4,
  fontFamily: "'Kantumruy Pro', sans-serif",
};
