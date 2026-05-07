"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { Product, Category, AdminUser } from "@/types";
import { VariantsEditor, type VariantGroup } from "@/components/admin/VariantsEditor";

export default function ProductsPage() {
  const { user, isSuperAdmin } = useAuth();
  const adminUser = user as AdminUser;
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState(0);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });
  const [form, setForm] = useState({ name: "", description: "", base_price: 0, compare_price: 0, stock: 0, sku: "", icon_emoji: "", delivery_days: 3, category_id: 0, is_active: true, is_featured: false });
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [variants, setVariants] = useState<VariantGroup[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string, ok = true) => { setToast({ show: true, msg, ok }); setTimeout(() => setToast(t => ({ ...t, show: false })), 3000); };

  async function load() {
    try {
      const params: Record<string, any> = { page_size: 50 };
      if (search) params.search = search;
      if (filterCat) params.category_id = filterCat;
      const [p, c] = await Promise.all([api.get<Product[]>("/products", { params }), api.get<Category[]>("/categories")]);
      setProducts(p); setCategories(c);
    } catch { flash("Failed to load", false); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [search, filterCat]);
  useAutoRefresh(load, { interval: 30000 });

  function openCreate() {
    setEditId(null); setForm({ name: "", description: "", base_price: 0, compare_price: 0, stock: 0, sku: "", icon_emoji: "", delivery_days: 3, category_id: 0, is_active: true, is_featured: false });
    setFiles([]); setPreviews([]); setVariants([]); setModal(true);
  }

  async function openEdit(p: Product) {
    setEditId(p.id); setForm({ name: p.name, description: p.description || "", base_price: p.base_price, compare_price: p.compare_price || 0, stock: p.stock, sku: p.sku || "", icon_emoji: p.icon_emoji || "", delivery_days: p.delivery_days || 3, category_id: p.category_id || 0, is_active: p.is_active, is_featured: p.is_featured || false });
    setPreviews(p.primary_image ? [p.primary_image] : []); setFiles([]); setVariants([]); setModal(true);

    // Fetch full product with variants
    try {
      const full = await api.get<Product & { variants?: any[] }>(`/products/${p.id}`);
      const groups: VariantGroup[] = (full.variants || []).map((v: any) => ({
        group_name: v.group_name,
        type: v.type,
        sort_order: v.sort_order || 0,
        options: (v.options || []).map((o: any) => ({
          label: o.label,
          hex_color: o.hex_color || null,
          price_adjust: Number(o.price_adjust) || 0,
          stock_adjust: Number(o.stock_adjust) || 0,
          is_popular: !!o.is_popular,
          sort_order: o.sort_order || 0,
        })),
      }));
      setVariants(groups);
    } catch { /* ignore — keep empty */ }
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const newFiles = Array.from(e.target.files || []);
    setFiles(f => [...f, ...newFiles]);
    setPreviews(p => [...p, ...newFiles.map(f => URL.createObjectURL(f))]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function save() {
    if (!form.name.trim()) { flash("Name required", false); return; }
    // Validate variants — every option needs a label
    for (const g of variants) {
      for (const o of g.options) {
        if (!o.label.trim()) { flash(`Each ${g.type} option needs a label`, false); return; }
      }
    }
    setSaving(true);
    try {
      let productId = editId;
      if (editId) {
        await api.patch(`/products/${editId}`, form);
        // Replace variants on edit
        await api.put(`/products/${editId}/variants`, { variants });
      } else {
        const p = await api.post<Product>("/products", { ...form, variants });
        productId = p.id;
      }
      // Upload images
      for (let i = 0; i < files.length; i++) {
        const fd = new FormData(); fd.append("file", files[i]); fd.append("product_id", String(productId)); fd.append("is_primary", i === 0 ? "true" : "false");
        await api.upload(`/products/${productId}/images`, fd);
      }
      flash(editId ? "Updated!" : "Created!"); setModal(false); load();
    } catch (e: any) { flash(e.detail || "Error saving", false); }
    setSaving(false);
  }

  async function toggleActive(p: Product) {
    await api.patch(`/products/${p.id}`, { is_active: !p.is_active }); load();
  }

  async function deleteProduct(id: number) {
    if (!confirm("Delete this product?")) return;
    await api.delete(`/products/${id}`); flash("Deleted"); load();
  }

  const stats = { total: products.length, active: products.filter(p => p.is_active).length, oos: products.filter(p => p.stock === 0).length, featured: products.filter(p => p.is_featured).length };

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div><h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Products</h1><p style={{ fontSize: 13, color: "var(--text-muted)" }}>Manage your catalog</p></div>
        <button className="btn-primary" onClick={openCreate}>+ Add Product</button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[{ l: "Total", v: stats.total, c: "var(--text)" }, { l: "Active", v: stats.active, c: "var(--success)" }, { l: "Out of Stock", v: stats.oos, c: "var(--danger)" }, { l: "Featured", v: stats.featured, c: "var(--warning)" }].map(s => (
          <div key={s.l} className="admin-card"><p style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.l}</p><p style={{ fontSize: 24, fontWeight: 700, color: s.c }}>{s.v}</p></div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input className="admin-input" style={{ maxWidth: 260 }} placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="admin-input" style={{ maxWidth: 180 }} value={filterCat} onChange={e => setFilterCat(+e.target.value)}>
          <option value={0}>All Categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.icon_emoji} {c.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div> : (
          <table className="admin-table">
            <thead><tr><th>Image</th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Active</th><th>Actions</th></tr></thead>
            <tbody>
              {products.length === 0 ? <tr><td colSpan={7} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No products found</td></tr> :
              products.map(p => (
                <tr key={p.id}>
                  <td>{p.primary_image ? <img src={p.primary_image} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} /> : <div style={{ width: 44, height: 44, borderRadius: 8, background: "var(--bg-secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{p.icon_emoji || "📦"}</div>}</td>
                  <td><p style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</p>{p.sku && <p style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>{p.sku}</p>}</td>
                  <td>{p.category_name || "—"}</td>
                  <td><span style={{ fontWeight: 600, fontFamily: "monospace" }}>${p.base_price}</span>{p.compare_price && p.compare_price > p.base_price && <span style={{ fontSize: 11, textDecoration: "line-through", color: "var(--text-muted)", marginLeft: 4 }}>${p.compare_price}</span>}</td>
                  <td style={{ color: p.stock === 0 ? "var(--danger)" : p.stock < 5 ? "var(--warning)" : "var(--text)", fontWeight: p.stock < 5 ? 600 : 400 }}>{p.stock}</td>
                  <td><div onClick={() => toggleActive(p)} style={{ width: 40, height: 22, borderRadius: 11, background: p.is_active ? "var(--success)" : "#d1d5db", cursor: "pointer", position: "relative", transition: "background 0.2s" }}><div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: p.is_active ? 20 : 2, transition: "left 0.2s" }} /></div></td>
                  <td><div style={{ display: "flex", gap: 4 }}><button onClick={() => openEdit(p)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>✏️</button><button onClick={() => deleteProduct(p.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>🗑️</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal-content" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>{editId ? "Edit Product" : "New Product"}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr", gap: 8 }}>
                <div><label style={labelS}>Name *</label><input className="admin-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                <div><label style={labelS}>Icon</label><input className="admin-input" style={{ textAlign: "center", fontSize: 18 }} value={form.icon_emoji} onChange={e => setForm({ ...form, icon_emoji: e.target.value })} placeholder="📦" /></div>
              </div>
              <div><label style={labelS}>Category</label><select className="admin-input" value={form.category_id} onChange={e => setForm({ ...form, category_id: +e.target.value })}><option value={0}>Select</option>{categories.map(c => <option key={c.id} value={c.id}>{c.icon_emoji} {c.name}</option>)}</select></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div><label style={labelS}>Price ($) *</label><input type="number" step="0.01" className="admin-input" value={form.base_price || ""} onChange={e => setForm({ ...form, base_price: +e.target.value })} /></div>
                <div><label style={labelS}>Compare Price ($)</label><input type="number" step="0.01" className="admin-input" value={form.compare_price || ""} onChange={e => setForm({ ...form, compare_price: +e.target.value })} /></div>
              </div>
              <div><label style={labelS}>Description</label><textarea className="admin-input" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div><label style={labelS}>Stock *</label><input type="number" className="admin-input" value={form.stock || ""} onChange={e => setForm({ ...form, stock: +e.target.value })} /></div>
                <div><label style={labelS}>SKU</label><input className="admin-input" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} /></div>
                <div><label style={labelS}>Delivery (days)</label><input type="number" className="admin-input" value={form.delivery_days} onChange={e => setForm({ ...form, delivery_days: +e.target.value })} /></div>
              </div>
              {/* Images */}
              <div>
                <label style={labelS}>Images</label>
                <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleFiles} style={{ display: "none" }} />
                {previews.length > 0 && <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>{previews.map((u, i) => <div key={i} style={{ position: "relative" }}><img src={u} alt="" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8 }} /><button onClick={() => { setPreviews(p => p.filter((_, j) => j !== i)); setFiles(f => f.filter((_, j) => j !== i)); }} style={{ position: "absolute", top: -4, right: -4, width: 20, height: 20, borderRadius: "50%", background: "var(--danger)", color: "#fff", border: "none", cursor: "pointer", fontSize: 10 }}>X</button></div>)}</div>}
                <div onClick={() => fileRef.current?.click()} style={{ border: "2px dashed var(--border)", borderRadius: 10, padding: 20, textAlign: "center", cursor: "pointer", background: "var(--bg-secondary)" }}>
                  <p style={{ fontSize: 24, marginBottom: 4 }}>📷</p>
                  <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Click to upload</p>
                </div>
              </div>
              {/* Variants */}
              <div>
                <label style={labelS}>Variants (size & color)</label>
                <VariantsEditor value={variants} onChange={setVariants} />
              </div>

              <div style={{ display: "flex", gap: 16 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}><input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} /> Active</label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}><input type="checkbox" checked={form.is_featured} onChange={e => setForm({ ...form, is_featured: e.target.checked })} /> Featured</label>
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

const labelS: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 };
