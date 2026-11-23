"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import type { AdminCollection, Merchant, Product } from "@/types";
import { BrandLoader } from "@/components/ui/Spinner";

type Form = {
  id: number | null;
  title: string;
  description: string;
  is_active: boolean;
  sort_order: number;
  starts_at: string;  // datetime-local value
  ends_at: string;
  product_ids: number[];
  cover_url: string | null;
  cover_file: File | null;
  remove_cover: boolean;
};

const EMPTY: Form = { id: null, title: "", description: "", is_active: true, sort_order: 0, starts_at: "", ends_at: "", product_ids: [], cover_url: null, cover_file: null, remove_cover: false };

const STATUS: Record<AdminCollection["status"], { label: string; cls: string; hint: string }> = {
  draft: { label: "Draft", cls: "badge-cancelled", hint: "Not shown to customers" },
  live: { label: "Live", cls: "badge-delivered", hint: "Customers see it on your shop page" },
  scheduled: { label: "Scheduled", cls: "badge-confirmed", hint: "Switched on; starts later" },
  ended: { label: "Ended", cls: "badge-pending", hint: "Its end date has passed" },
};
const DRAFT_WHY: Record<string, string> = { off: "Switched off", no_products: "Add an active product to go live" };

// datetime-local <-> ISO (the browser's own time zone)
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");

/** A shop's own curated product lists, shown as rows on its shop page. Owners and staff manage them. */
export default function CollectionsPage() {
  const { isSuperAdmin } = useAuth();
  const [shops, setShops] = useState<Merchant[]>([]);
  const [shopId, setShopId] = useState("");
  const [rows, setRows] = useState<AdminCollection[]>([]);
  const [limit, setLimit] = useState(20);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<AdminCollection | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });

  const flash = (msg: string, ok = true) => { setToast({ show: true, msg, ok }); setTimeout(() => setToast(t => ({ ...t, show: false })), 3500); };
  const scope = isSuperAdmin ? (shopId ? `?merchant_id=${shopId}` : null) : "";

  useEffect(() => { if (isSuperAdmin) api.get<Merchant[]>("/merchants").then(setShops).catch(() => {}); }, [isSuperAdmin]);

  const load = useCallback(async () => {
    if (scope === null) { setRows([]); setProducts([]); setLoading(false); return; }
    setLoading(true);
    try {
      const [c, p] = await Promise.all([
        api.get<{ data: AdminCollection[]; limit: number }>(`/collections/admin/list${scope}`),
        api.get<Product[]>(`/products?include_inactive=true&page_size=500${isSuperAdmin ? `&merchant_id=${shopId}` : ""}`),
      ]);
      setRows(c.data); setLimit(c.limit); setProducts(p); setError("");
    } catch (e: any) { setError(e?.detail || "Could not load collections"); }
    finally { setLoading(false); }
  }, [scope, isSuperAdmin, shopId]);
  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

  function edit(c: AdminCollection) {
    setSearch("");
    setForm({ id: c.id, title: c.title, description: c.description || "", is_active: c.is_active, sort_order: c.sort_order,
      starts_at: toLocal(c.starts_at), ends_at: toLocal(c.ends_at), product_ids: [...c.product_ids], cover_url: c.cover_url, cover_file: null, remove_cover: false });
  }

  async function save() {
    if (!form) return;
    if (!form.title.trim()) { flash("Give the collection a title", false); return; }
    if (form.starts_at && form.ends_at && new Date(form.starts_at) >= new Date(form.ends_at)) { flash("The end must be after the start", false); return; }
    setSaving(true);
    const body = {
      title: form.title.trim(), description: form.description.trim() || null, type: "manual",
      is_active: form.is_active, sort_order: form.sort_order,
      starts_at: toIso(form.starts_at), ends_at: toIso(form.ends_at),
      product_ids: form.product_ids, remove_cover: form.remove_cover,
      ...(isSuperAdmin ? { merchant_id: Number(shopId) } : {}),
    };
    try {
      const saved = form.id
        ? await api.put<{ id: number }>(`/collections/admin/${form.id}`, body)
        : await api.post<{ id: number }>("/collections/admin", body);
      if (form.cover_file) {
        const fd = new FormData();
        fd.append("file", form.cover_file);
        await api.upload(`/collections/admin/${saved.id}/cover`, fd);
      }
      flash(form.id ? "Collection saved" : "Collection created");
      setForm(null); load();
    } catch (e: any) { flash(e?.detail || "Could not save the collection", false); }
    setSaving(false);
  }

  async function move(c: AdminCollection, dir: -1 | 1) {
    const i = rows.findIndex(r => r.id === c.id), j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const other = rows[j];
    // Swap positions; give both distinct numbers so the order is stable
    const put = (x: AdminCollection, order: number) => api.put(`/collections/admin/${x.id}`, {
      title: x.title, description: x.description, type: "manual", is_active: x.is_active, sort_order: order,
      starts_at: x.starts_at, ends_at: x.ends_at,
    });
    try { await Promise.all([put(c, j), put(other, i)]); load(); }
    catch (e: any) { flash(e?.detail || "Could not reorder", false); }
  }

  async function toggle(c: AdminCollection) {
    try {
      await api.put(`/collections/admin/${c.id}`, { title: c.title, description: c.description, type: "manual",
        is_active: !c.is_active, sort_order: c.sort_order, starts_at: c.starts_at, ends_at: c.ends_at });
      load();
    } catch (e: any) { flash(e?.detail || "Could not update", false); }
  }

  async function remove() {
    if (!deleting) return;
    setSaving(true);
    try { await api.delete(`/collections/admin/${deleting.id}`); flash("Collection deleted"); setDeleting(null); load(); }
    catch (e: any) { flash(e?.detail || "Could not delete", false); }
    setSaving(false);
  }

  // Product picker helpers
  const picked = form?.product_ids ?? [];
  const pick = (id: number) => form && setForm({ ...form, product_ids: picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id] });
  const shift = (idx: number, dir: -1 | 1) => {
    if (!form) return;
    const j = idx + dir;
    if (j < 0 || j >= picked.length) return;
    const next = [...picked];
    [next[idx], next[j]] = [next[j], next[idx]];
    setForm({ ...form, product_ids: next });
  };
  const matches = products.filter(p => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Collections</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 640 }}>
            Group your products into lists like &ldquo;Birthday Cakes&rdquo; or &ldquo;Best Sellers&rdquo;. Each live collection shows as a row on your shop page.
            A product can be in several collections. Use dates for seasonal ones.
          </p>
        </div>
        <button className="btn-primary" data-testid="add-collection" disabled={scope === null || rows.length >= limit}
          onClick={() => { setSearch(""); setForm({ ...EMPTY, sort_order: rows.length }); }}>+ New collection</button>
      </div>

      {isSuperAdmin && (
        <div className="admin-card" style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12 }}>Shop
            <select className="admin-input" value={shopId} onChange={e => setShopId(e.target.value)}>
              <option value="">Choose a shop…</option>
              {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="admin-card" style={{ padding: 0, overflowX: "auto" }}>
        {error ? <p style={{ padding: 24, fontSize: 13, color: "var(--danger, #EF4444)" }}>{error}</p>
          : scope === null ? <p style={{ padding: 24, fontSize: 13, color: "var(--text-muted)" }}>Choose a shop to manage its collections.</p>
          : loading ? <BrandLoader /> : (
          <table className="admin-table">
            <thead><tr><th style={{ width: 70 }}>Order</th><th>Collection</th><th>Products</th><th>Dates</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", padding: 36, color: "var(--text-muted)" }}>No collections yet. Create one and pick the products that belong together.</td></tr>
              ) : rows.map((c, i) => (
                <tr key={c.id} data-testid={`collection-${c.id}`}>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn-outline" aria-label="Move up" disabled={i === 0} onClick={() => move(c, -1)} style={{ padding: "2px 8px" }}>↑</button>
                      <button className="btn-outline" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(c, 1)} style={{ padding: "2px 8px" }}>↓</button>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {c.cover_url
                        ? <img src={c.cover_url} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                        : <div style={{ width: 44, height: 44, borderRadius: 8, background: "var(--bg-secondary)", flexShrink: 0 }} />}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{c.title}</div>
                        {c.description && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.description}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {c.product_ids.length}{c.visible_product_count !== c.product_ids.length && <span style={{ color: "var(--text-muted)" }}> ({c.visible_product_count} active)</span>}
                  </td>
                  <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    {!c.starts_at && !c.ends_at ? "Always" : <>{c.starts_at ? `From ${when(c.starts_at)}` : ""}{c.starts_at && c.ends_at ? <br /> : null}{c.ends_at ? `Until ${when(c.ends_at)}` : ""}</>}
                  </td>
                  <td>
                    <span className={`badge ${STATUS[c.status].cls}`} title={STATUS[c.status].hint}>{STATUS[c.status].label}</span>
                    {c.status === "draft" && c.draft_reason && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{DRAFT_WHY[c.draft_reason]}</div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn-outline" onClick={() => edit(c)}>Edit</button>
                      <button className="btn-outline" onClick={() => toggle(c)}>{c.is_active ? "Move to draft" : "Publish"}</button>
                      <button className="btn-outline" style={{ color: "var(--danger, #EF4444)" }} onClick={() => setDeleting(c)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {scope !== null && !loading && <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>{rows.length} of {limit} collections</p>}

      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <div className="modal-content" style={{ maxWidth: 760, width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{form.id ? "Edit collection" : "New collection"}</h2>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <label style={{ gridColumn: "1 / -1" }}>Title<input className="admin-input" maxLength={80} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Birthday Cakes" /></label>
              <label style={{ gridColumn: "1 / -1" }}>Short description (optional)<input className="admin-input" maxLength={300} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="One line under the title" /></label>
              <label>Starts (optional)<input className="admin-input" type="datetime-local" value={form.starts_at} onChange={e => setForm({ ...form, starts_at: e.target.value })} /></label>
              <label>Ends (optional)<input className="admin-input" type="datetime-local" value={form.ends_at} min={form.starts_at || undefined} onChange={e => setForm({ ...form, ends_at: e.target.value })} /></label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} /> Publish (unticked = Draft, not shown)
              </label>
              <div style={{ fontSize: 13 }}>
                Cover image (optional)
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                  {(form.cover_file || (form.cover_url && !form.remove_cover)) && (
                    <img src={form.cover_file ? URL.createObjectURL(form.cover_file) : form.cover_url!} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover" }} />
                  )}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => setForm({ ...form, cover_file: e.target.files?.[0] ?? null, remove_cover: false })} style={{ fontSize: 12, maxWidth: 200 }} />
                  {form.cover_url && !form.remove_cover && !form.cover_file && (
                    <button type="button" className="btn-outline" onClick={() => setForm({ ...form, remove_cover: true })}>Remove</button>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginTop: 16 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Your products</div>
                <input className="admin-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products" />
                <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, marginTop: 6 }}>
                  {matches.length === 0 ? <p style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>No products found.</p> : matches.map(p => (
                    <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderTop: "1px solid var(--border)", fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked={picked.includes(p.id)} onChange={() => pick(p.id)} />
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                      {!p.is_active && <span className="badge badge-cancelled" style={{ fontSize: 10 }}>Hidden</span>}
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>${Number(p.base_price).toFixed(2)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>In this collection ({picked.length}) · the order customers see</div>
                <div style={{ maxHeight: 318, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
                  {picked.length === 0 ? <p style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>Tick products on the left.</p> : picked.map((pid, i) => {
                    const p = byId.get(pid);
                    return (
                      <div key={pid} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderTop: "1px solid var(--border)", fontSize: 13 }}>
                        <span style={{ color: "var(--text-muted)", width: 18 }}>{i + 1}.</span>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p?.name ?? `#${pid}`}</span>
                        {p && !p.is_active && <span className="badge badge-cancelled" style={{ fontSize: 10 }}>Hidden</span>}
                        <button type="button" className="btn-outline" aria-label="Up" disabled={i === 0} onClick={() => shift(i, -1)} style={{ padding: "0 6px" }}>↑</button>
                        <button type="button" className="btn-outline" aria-label="Down" disabled={i === picked.length - 1} onClick={() => shift(i, 1)} style={{ padding: "0 6px" }}>↓</button>
                        <button type="button" className="btn-outline" aria-label="Remove" onClick={() => pick(pid)} style={{ padding: "0 6px" }}>×</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn-outline" style={{ flex: 1 }} onClick={() => setForm(null)}>Cancel</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>{saving ? "Saving…" : form.id ? "Save" : "Create collection"}</button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <div className="modal-overlay" onClick={() => setDeleting(null)}>
          <div className="modal-content" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Delete &ldquo;{deleting.title}&rdquo;?</h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>Only the collection goes. Its products stay in your shop. To hide it for a while, switch it off instead.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-outline" style={{ flex: 1 }} onClick={() => setDeleting(null)}>Cancel</button>
              <button className="btn-primary" style={{ flex: 1, background: "#EF4444", borderColor: "#EF4444" }} onClick={remove} disabled={saving}>{saving ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
