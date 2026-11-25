"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { Product, Category, Merchant, AdminUser, AttributeTemplate, AttributeValue } from "@/types";
import { VariantsEditor, type VariantGroup } from "@/components/admin/VariantsEditor";
import { DetailsEditor } from "@/components/admin/DetailsEditor";
import { completeness, filled } from "@/lib/attributes";
import { BrandLoader } from "@/components/ui/Spinner";
import { usePermissions } from "@/lib/permissions";
import { AddIcon, DeleteIcon, EditIcon, FilterIcon } from "@/components/brand/Icons";

export default function ProductsPage() {
  const { can } = usePermissions();
  // Staff edit products but cannot delete them or change an existing price (enforced by the server too)
  const priceLocked = (editing: boolean) => editing && !can("products.price");
  const { user, isSuperAdmin } = useAuth();
  const adminUser = user as AdminUser;
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [shops, setShops] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState(0);
  const [filterShop, setFilterShop] = useState(0);
  // Bulk: tick products, then put them all in one category
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCat, setBulkCat] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [variants, setVariants] = useState<VariantGroup[]>([]);
  // Product details (attribute templates): all templates for the list's completeness column,
  // the shop's own templates for the form, and the product's chosen template and values
  const [allTemplates, setAllTemplates] = useState<AttributeTemplate[]>([]);
  const [shopTemplates, setShopTemplates] = useState<AttributeTemplate[]>([]);
  const [details, setDetails] = useState<{ templateId: number; values: Record<string, AttributeValue>; hadTemplate: boolean }>({ templateId: 0, values: {}, hadTemplate: false });
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string, ok = true) => { setToast({ show: true, msg, ok }); setTimeout(() => setToast(t => ({ ...t, show: false })), 3000); };

  async function load() {
    try {
      const params: Record<string, any> = { page_size: 50 };
      if (search) params.search = search;
      if (filterCat) params.category_id = filterCat;
      // The backend scopes merchants to their own shop; the shop filter is super-admin only
      if (isSuperAdmin && filterShop) params.merchant_id = filterShop;
      params.include_inactive = true;
      const [p, c, m] = await Promise.all([
        api.get<Product[]>("/products", { params }),
        api.get<Category[]>("/categories"),
        isSuperAdmin ? api.get<Merchant[]>("/merchants") : Promise.resolve<Merchant[]>([]),
      ]);
      setProducts(p); setCategories(c); if (isSuperAdmin) setShops(m);
    } catch { flash("Failed to load", false); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { api.get<{ data: AttributeTemplate[] }>("/attribute-templates").then(r => setAllTemplates(r.data)).catch(() => setAllTemplates([])); }, []);

  // The templates this product's shop may use, and the suggested one for a new product
  useEffect(() => {
    if (!modal) return;
    if (isSuperAdmin && !form.merchant_id) { setShopTemplates([]); return; }
    const params = isSuperAdmin ? { merchant_id: form.merchant_id } : undefined;
    api.get<{ data: AttributeTemplate[]; suggested_id: number | null }>("/attribute-templates/for-shop", { params })
      .then(r => {
        setShopTemplates(r.data);
        if (!editId && r.suggested_id) setDetails(d => (d.templateId ? d : { ...d, templateId: r.suggested_id! }));
      })
      .catch(() => setShopTemplates([]));
  }, [modal, form.merchant_id, isSuperAdmin, editId]);

  const templateById = new Map(allTemplates.map(t => [t.id, t]));
  // Brand (and other text) values this shop already uses, offered as suggestions
  const suggestions: Record<string, string[]> = {};
  for (const p of products) for (const [k, v] of Object.entries(p.attributes || {})) {
    if (typeof v === "string" && v.trim()) {
      const list = (suggestions[k] ||= []);
      if (!list.includes(v)) list.push(v);
    }
  }
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [search, filterCat, filterShop]);
  useAutoRefresh(load, { interval: 30000 });

  // Category options: global ones plus those of the shop being edited / filtered
  const catsFor = (shopId: number) => categories.filter(c => !c.merchant_id || !shopId || c.merchant_id === shopId);

  const toggle = (id: number) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allTicked = products.length > 0 && products.every(p => selected.has(p.id));
  const tickAll = () => setSelected(allTicked ? new Set() : new Set(products.map(p => p.id)));
  // Products of one shop can go to that shop's categories; a mix of shops only to platform-wide ones
  const selectedShops = Array.from(new Set(products.filter(p => selected.has(p.id)).map(p => p.merchant_id)));
  const bulkCats = selectedShops.length === 1 ? catsFor(selectedShops[0]).filter(c => c.merchant_id === selectedShops[0] || !c.merchant_id) : categories.filter(c => !c.merchant_id);

  async function applyBulkCategory() {
    if (!bulkCat) { flash("Choose a category", false); return; }
    setBulkBusy(true);
    try {
      const res = await api.post<{ changed: number; to: string | null }>("/products/bulk/category", {
        product_ids: Array.from(selected), category_id: bulkCat === "none" ? null : Number(bulkCat),
      });
      flash(`${res.changed} product${res.changed === 1 ? "" : "s"} moved to ${res.to ?? "no category"}`);
      setSelected(new Set()); setBulkCat(""); load();
    } catch (e: any) { flash(e?.detail || "Could not change the category", false); }
    setBulkBusy(false);
  }
  const shopName = (id: number) => shops.find(s => s.id === id)?.name;
  const ownShopName = products[0]?.merchant_name;

  function openCreate() {
    setEditId(null); setForm({ ...EMPTY_FORM, merchant_id: isSuperAdmin ? filterShop : 0 });
    setFiles([]); setPreviews([]); setVariants([]); setDetails({ templateId: 0, values: {}, hadTemplate: false }); setModal(true);
  }

  async function openEdit(p: Product) {
    setEditId(p.id); setForm({ name: p.name, description: p.description || "", base_price: p.base_price, compare_price: p.compare_price || 0, stock: p.stock, sku: p.sku || "", icon_emoji: p.icon_emoji || "", delivery_days: p.delivery_days || 3, category_id: p.category_id || 0, merchant_id: p.merchant_id, is_active: p.is_active, is_featured: p.is_featured || false });
    setPreviews(p.primary_image ? [p.primary_image] : []); setFiles([]); setVariants([]);
    setDetails({ templateId: p.attribute_template_id || 0, values: { ...(p.attributes || {}) }, hadTemplate: !!p.attribute_template_id });
    setModal(true);

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
    if (isSuperAdmin && !form.merchant_id) { flash("Choose the shop this product belongs to", false); return; }
    // Validate variants — every option needs a label
    for (const g of variants) {
      for (const o of g.options) {
        if (!o.label.trim()) { flash(`Each ${g.type} option needs a label`, false); return; }
      }
    }
    setSaving(true);
    // Details are sent only once the templates exist (migration 036); 0 clears a template
    const detailPayload = allTemplates.length && (details.templateId || details.hadTemplate)
      ? { attribute_template_id: details.templateId || 0, attributes: details.templateId ? filled(details.values) : {} }
      : {};
    try {
      let productId = editId;
      if (editId) {
        await api.patch(`/products/${editId}`, { ...(isSuperAdmin ? form : { ...form, merchant_id: undefined }), ...detailPayload });
        // Replace variants on edit
        await api.put(`/products/${editId}/variants`, { variants });
      } else {
        const p = await api.post<Product>("/products", { ...form, variants, ...detailPayload });
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
        <div><h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Products</h1><p style={{ fontSize: 13, color: "var(--text-muted)" }}>{isSuperAdmin ? "Every shop's products - each row shows its owner" : `Managing products for ${ownShopName || "your shop"}`}</p></div>
        <button className="btn-primary" onClick={openCreate}><AddIcon size={16} />Add Product</button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[{ l: "Total", v: stats.total, c: "var(--text)" }, { l: "Active", v: stats.active, c: "var(--success)" }, { l: "Out of Stock", v: stats.oos, c: "var(--danger)" }, { l: "Featured", v: stats.featured, c: "var(--warning)" }].map(s => (
          <div key={s.l} className="admin-card"><p style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.l}</p><p style={{ fontSize: 24, fontWeight: 700, color: s.c }}>{s.v}</p></div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <FilterIcon size={18} title="Filters" style={{ color: "var(--text-muted, #64748B)" }} />
        <input className="admin-input" style={{ maxWidth: 260 }} placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} />
        {isSuperAdmin && (
          <select className="admin-input" style={{ maxWidth: 220 }} value={filterShop} onChange={e => { setFilterShop(+e.target.value); setFilterCat(0); }}>
            <option value={0}>All Shops</option>
            {shops.map(s => <option key={s.id} value={s.id}>{s.icon_emoji} {s.name} ({s.product_count ?? 0})</option>)}
          </select>
        )}
        <select className="admin-input" style={{ maxWidth: 200 }} value={filterCat} onChange={e => setFilterCat(+e.target.value)}>
          <option value={0}>All Categories</option>
          {catsFor(filterShop).map(c => <option key={c.id} value={c.id}>{c.icon_emoji} {c.name}</option>)}
        </select>
      </div>

      {selected.size > 0 && (
        <div className="admin-card" data-testid="bulk-bar"
          style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12, padding: "10px 14px", border: "1px solid var(--accent, #0088cc)" }}>
          <strong style={{ fontSize: 13 }}>{selected.size} selected</strong>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Move to</span>
          <select className="admin-input" style={{ maxWidth: 240 }} value={bulkCat} onChange={e => setBulkCat(e.target.value)} data-testid="bulk-category">
            <option value="">Choose a category…</option>
            {bulkCats.map(c => <option key={c.id} value={c.id}>{c.icon_emoji} {c.name}{c.merchant_id ? "" : " (platform)"}</option>)}
            <option value="none">No category</option>
          </select>
          <button className="btn-primary" onClick={applyBulkCategory} disabled={bulkBusy} data-testid="bulk-apply">{bulkBusy ? "Moving…" : "Apply"}</button>
          <button className="btn-outline" onClick={() => setSelected(new Set())}>Clear</button>
          {selectedShops.length > 1 && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Products from several shops can only go to a platform category.</span>}
        </div>
      )}

      {/* Table */}
      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? <BrandLoader /> : (
          <table className="admin-table">
            <thead><tr><th style={{ width: 32 }}><input type="checkbox" aria-label="Select all" checked={allTicked} onChange={tickAll} /></th><th>Image</th><th>Name</th>{isSuperAdmin && <th>Shop</th>}<th>Category</th><th>Price</th><th>Stock</th>{allTemplates.length > 0 && <th>Details</th>}<th>Active</th><th>Actions</th></tr></thead>
            <tbody>
              {products.length === 0 ? <tr><td colSpan={(isSuperAdmin ? 9 : 8) + (allTemplates.length > 0 ? 1 : 0)} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No products found</td></tr> :
              products.map(p => (
                <tr key={p.id} style={selected.has(p.id) ? { background: "var(--info-light)" } : undefined}>
                  <td><input type="checkbox" aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} data-testid={`pick-${p.id}`} /></td>
                  <td>{p.primary_image ? <img src={p.primary_image} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} /> : <div style={{ width: 44, height: 44, borderRadius: 8, background: "var(--bg-secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{p.icon_emoji || "📦"}</div>}</td>
                  <td><p style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</p>{p.sku && <p style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>{p.sku}</p>}</td>
                  {isSuperAdmin && (
                    <td>
                      <button onClick={() => { setFilterShop(p.merchant_id); setFilterCat(0); }} title="Show only this shop's products" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 14, padding: "3px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "var(--text)", display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                        {p.merchant_logo_url ? <img src={p.merchant_logo_url} alt="" style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover" }} /> : <span>{p.merchant_icon || "🏪"}</span>}
                        {p.merchant_name || `Shop #${p.merchant_id}`}
                      </button>
                      {p.merchant_status && p.merchant_status !== "active" && <p style={{ fontSize: 10, color: "var(--warning)", marginTop: 2 }}>shop {p.merchant_status}</p>}
                    </td>
                  )}
                  <td>{p.category_name || "—"}</td>
                  <td><span style={{ fontWeight: 600, fontFamily: "monospace" }}>${p.base_price}</span>{p.compare_price && p.compare_price > p.base_price && <span style={{ fontSize: 11, textDecoration: "line-through", color: "var(--text-muted)", marginLeft: 4 }}>${p.compare_price}</span>}</td>
                  <td style={{ color: p.stock === 0 ? "var(--danger)" : p.stock < 5 ? "var(--warning)" : "var(--text)", fontWeight: p.stock < 5 ? 600 : 400 }}>{p.stock}</td>
                  {allTemplates.length > 0 && <td><DetailsBadge template={p.attribute_template_id ? templateById.get(p.attribute_template_id) : undefined} values={p.attributes} /></td>}
                  <td><div onClick={() => toggleActive(p)} style={{ width: 40, height: 22, borderRadius: 11, background: p.is_active ? "var(--success)" : "#d1d5db", cursor: "pointer", position: "relative", transition: "background 0.2s" }}><div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: p.is_active ? 20 : 2, transition: "left 0.2s" }} /></div></td>
                  <td><div style={{ display: "flex", gap: 4 }}><button onClick={() => openEdit(p)} title="Edit" aria-label="Edit" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent, #103562)", padding: 4 }}><EditIcon size={18} /></button>{can("products.delete") && <button onClick={() => deleteProduct(p.id)} title="Delete" aria-label="Delete" style={{ background: "none", border: "none", cursor: "pointer", color: "#EF4444", padding: 4 }}><DeleteIcon size={18} /></button>}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal-content" style={{ maxWidth: 620, maxHeight: "92vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>{editId ? "Edit Product" : "New Product"}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr", gap: 8 }}>
                <div><label style={labelS}>Name *</label><input className="admin-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                <div><label style={labelS}>Icon</label><input className="admin-input" style={{ textAlign: "center", fontSize: 18 }} value={form.icon_emoji} onChange={e => setForm({ ...form, icon_emoji: e.target.value })} placeholder="📦" /></div>
              </div>
              <div>
                <label style={labelS}>Shop (owner) *</label>
                {isSuperAdmin ? (
                  <select className="admin-input" value={form.merchant_id} onChange={e => {
                    const id = +e.target.value;
                    // Drop a category that belongs to a different shop
                    const cat = categories.find(c => c.id === form.category_id);
                    setForm({ ...form, merchant_id: id, category_id: cat?.merchant_id && cat.merchant_id !== id ? 0 : form.category_id });
                  }}>
                    <option value={0}>Select a shop...</option>
                    {shops.map(s => <option key={s.id} value={s.id}>{s.icon_emoji} {s.name}</option>)}
                  </select>
                ) : (
                  <div className="admin-input" style={{ background: "var(--bg-secondary)", color: "var(--text-muted)" }}>🏪 {ownShopName || "Your shop"}</div>
                )}
                {isSuperAdmin && editId && form.merchant_id > 0 && form.merchant_id !== products.find(p => p.id === editId)?.merchant_id && (
                  <p style={{ fontSize: 11, color: "var(--warning)", marginTop: 4 }}>Saving moves this product to {shopName(form.merchant_id)}.</p>
                )}
              </div>
              <div><label style={labelS}>Category</label><select className="admin-input" value={form.category_id} onChange={e => setForm({ ...form, category_id: +e.target.value })}><option value={0}>None</option>{catsFor(isSuperAdmin ? form.merchant_id : 0).map(c => <option key={c.id} value={c.id}>{c.icon_emoji} {c.name}</option>)}</select></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div><label style={labelS}>Price ($) *</label><input type="number" step="0.01" className="admin-input" value={form.base_price || ""} disabled={priceLocked(!!editId)} title={priceLocked(!!editId) ? "Only an owner or manager can change prices" : undefined} onChange={e => setForm({ ...form, base_price: +e.target.value })} /></div>
                <div><label style={labelS}>Compare Price ($)</label><input type="number" step="0.01" className="admin-input" value={form.compare_price || ""} disabled={priceLocked(!!editId)} onChange={e => setForm({ ...form, compare_price: +e.target.value })} /></div>
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
              {/* Product details (attribute template) */}
              {allTemplates.length > 0 && (
                <div>
                  <label style={labelS}>Product details</label>
                  {isSuperAdmin && !form.merchant_id
                    ? <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Choose the shop first.</p>
                    : <DetailsEditor templates={shopTemplates} templateId={details.templateId} values={details.values} suggestions={suggestions}
                        onChange={(templateId, values) => setDetails(d => ({ ...d, templateId, values }))} />}
                </div>
              )}
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

/** "Details missing" or how complete a product's details are. */
function DetailsBadge({ template, values }: { template?: AttributeTemplate; values?: Record<string, unknown> }) {
  if (!template) return <span className="badge badge-pending" title="Open the product and choose what kind of product it is">Details missing</span>;
  const c = completeness(template, values);
  const cls = c.score >= 80 ? "badge-delivered" : c.score >= 40 ? "badge-confirmed" : "badge-pending";
  return <span className={`badge ${cls}`} title={`${template.name}: recommended ${c.recommendedFilled}/${c.recommendedTotal}, optional ${c.optionalFilled}/${c.optionalTotal}`}>{c.score}%</span>;
}

const EMPTY_FORM = { name: "", description: "", base_price: 0, compare_price: 0, stock: 0, sku: "", icon_emoji: "", delivery_days: 3, category_id: 0, merchant_id: 0, is_active: true, is_featured: false };

const labelS: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 };
