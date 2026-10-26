"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { BrandLoader } from "@/components/ui/Spinner";
import type { AdminUser, Category, Merchant, Product } from "@/types";
import type { PromotionRow } from "@/lib/promotions";
import { MonthDaysPicker, SCHEDULES, WeekdayPicker, YearlyRangesPicker, fromLocal, scheduleText, toLocal, type ScheduleType, type YearlyRange } from "@/components/admin/ScheduleInputs";

type Scope = "shop" | "product" | "category" | "platform";
type Location = "home_promotions" | "shop_page";

const SCOPES: { key: Scope; label: string; hint: string }[] = [
  { key: "shop", label: "Entire Shop", hint: "Applies to all products in the selected shop" },
  { key: "product", label: "Selected Products", hint: "Applies only to selected products" },
  { key: "category", label: "Category", hint: "Applies to products within a selected category" },
  { key: "platform", label: "Platform Wide", hint: "Applies to all products in every shop" },
];
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGE_MB = 4;
// Home has one Promotions section; the shop page has its Offers rail
const LOCATIONS: { key: Location; label: string }[] = [
  { key: "home_promotions", label: "Home" },
  { key: "shop_page", label: "Shop page" },
];

interface Form {
  title: string; subtitle: string; scope: Scope; merchant_id: number; category_id: number; product_ids: number[];
  /** Off = a banner-only promotion (announcement), no code or discount */
  has_offer: boolean;
  code: string; discount_type: "percent" | "fixed"; discount_value: string; min_order: string; max_uses: string;
  starts_at: string; ends_at: string; display_locations: Location[]; is_active: boolean;
  schedule_type: ScheduleType; weekdays: number[]; month_days: number[]; yearly_ranges: YearlyRange[]; auto_apply: boolean;
}

const EMPTY: Form = {
  title: "", subtitle: "", scope: "shop", merchant_id: 0, category_id: 0, product_ids: [],
  has_offer: true, code: "", discount_type: "percent", discount_value: "", min_order: "", max_uses: "",
  starts_at: "", ends_at: "", display_locations: ["home_promotions"], is_active: true,
  schedule_type: "once", weekdays: [], month_days: [], yearly_ranges: [], auto_apply: true,
};

const offerText = (p: PromotionRow) => p.offer ? (p.offer.type === "percent" ? `${Number(p.offer.value)}% OFF` : `$${Number(p.offer.value).toFixed(2)} OFF`) : "Banner only";

export default function PromotionBannersPage() {
  const { user, isSuperAdmin } = useAuth();
  const ownShop = !isSuperAdmin ? (user as AdminUser | null)?.merchant_id ?? 0 : 0;
  const [rows, setRows] = useState<PromotionRow[]>([]);
  const [shops, setShops] = useState<Merchant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [image, setImage] = useState<File | null>(null);
  /** The banner already saved on this promotion (when editing) */
  const [savedImage, setSavedImage] = useState<string | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string, ok = true) => {
    setToast({ show: true, msg, ok });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 3500);
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));

  async function load() {
    try {
      setRows(await api.get<PromotionRow[]>("/promotions/admin/list"));
      setMissingTable(false);
    } catch (e: any) {
      // Migration 018 not applied yet: say so instead of an empty list
      if (String(e?.detail || "").toLowerCase().includes("promotions")) setMissingTable(true);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    api.get<Category[]>("/categories").then(setCategories).catch(() => {});
    if (isSuperAdmin) api.get<Merchant[]>("/merchants").then(setShops).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin]);

  const shopId = form.scope === "platform" ? 0 : ownShop || form.merchant_id;
  // The picked shop's products, for product promotions
  useEffect(() => {
    if (!modal || !shopId) { setProducts([]); return; }
    let alive = true;
    setProductsLoading(true);
    api.get<Product[]>("/products", { params: { merchant_id: shopId, page_size: 200 } })
      .then(rows => { if (alive) setProducts(rows); })
      .catch(() => { if (alive) setProducts([]); })
      .finally(() => { if (alive) setProductsLoading(false); });
    return () => { alive = false; };
  }, [modal, shopId]);

  const shopCategories = categories.filter(c => !c.merchant_id || c.merchant_id === shopId);
  const shownProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    return q ? products.filter(p => p.name.toLowerCase().includes(q)) : products;
  }, [products, productQuery]);

  function openCreate() {
    setEditId(null);
    setForm({ ...EMPTY, merchant_id: ownShop || shops[0]?.id || 0 });
    setImage(null); setSavedImage(null); setProductQuery(""); setModal(true);
  }

  function openEdit(p: PromotionRow) {
    setEditId(p.id);
    setForm({
      title: p.title, subtitle: p.subtitle || "", scope: p.scope, merchant_id: p.merchant_id ?? 0, category_id: p.category_id || 0,
      product_ids: p.product_ids || [], has_offer: !!p.offer, code: p.offer?.code || "", discount_type: p.offer?.type || "percent",
      discount_value: p.offer ? String(Number(p.offer.value)) : "", min_order: p.offer?.min_order ? String(Number(p.offer.min_order)) : "",
      max_uses: p.offer?.max_uses ? String(p.offer.max_uses) : "", starts_at: toLocal(p.starts_at), ends_at: toLocal(p.ends_at),
      display_locations: Array.from(new Set((p.display_locations || []).map(l => (l === "home_featured" ? "home_promotions" : l)))) as Location[], is_active: p.is_active,
      schedule_type: p.schedule_type ?? "once", weekdays: p.weekdays ?? [], month_days: p.month_days ?? [],
      yearly_ranges: p.yearly_ranges ?? [], auto_apply: p.auto_apply ?? true,
    });
    setImage(null); setSavedImage(p.image_url); setProductQuery(""); setModal(true);
  }

  async function save() {
    if (!form.title.trim()) return flash("Add a title", false);
    const platform = form.scope === "platform";
    if (!platform && !shopId) return flash("Choose the shop", false);
    if (form.scope === "product" && form.product_ids.length === 0) return flash("Pick at least one product", false);
    if (form.scope === "category" && !form.category_id) return flash("Choose the category", false);
    if (form.has_offer && !form.code.trim()) return flash("Add a coupon code", false);
    if (form.has_offer && !(Number(form.discount_value) > 0)) return flash("Enter the discount amount", false);
    if (form.display_locations.length === 0) return flash("Pick at least one place to show it", false);
    if (form.schedule_type === "weekly" && form.weekdays.length === 0) return flash("Pick the days of the week it runs", false);
    if (form.schedule_type === "monthly" && form.month_days.length === 0) return flash("Pick the days of the month it runs", false);
    if (form.schedule_type === "yearly" && form.yearly_ranges.length === 0) return flash("Add at least one date it runs every year", false);
    const body = {
      title: form.title, subtitle: form.subtitle || null, scope: form.scope, merchant_id: platform ? null : shopId,
      category_id: form.scope === "category" || (form.scope === "platform" && form.category_id) ? form.category_id : null,
      product_ids: form.scope === "product" ? form.product_ids : [],
      code: form.has_offer ? form.code : null,
      discount_type: form.has_offer ? form.discount_type : null,
      discount_value: form.has_offer ? Number(form.discount_value) : null,
      min_order: form.has_offer ? Number(form.min_order) || 0 : 0,
      max_uses: form.has_offer && form.max_uses ? Number(form.max_uses) : null,
      starts_at: fromLocal(form.starts_at), ends_at: fromLocal(form.ends_at),
      display_locations: form.display_locations, is_active: form.is_active,
      schedule_type: form.schedule_type, weekdays: form.weekdays, month_days: form.month_days,
      yearly_ranges: form.yearly_ranges, auto_apply: form.auto_apply,
    };
    setSaving(true);
    try {
      const saved = editId
        ? await api.put<PromotionRow>(`/promotions/admin/${editId}`, body)
        : await api.post<PromotionRow>("/promotions/admin", body);
      if (image) {
        const fd = new FormData(); fd.append("file", image);
        await api.upload(`/promotions/admin/${saved.id}/image`, fd);
      }
      flash(`${editId ? "Promotion updated" : "Promotion created"}${image ? " · banner uploaded" : ""}`);
      setModal(false);
      load();
    } catch (e: any) { flash(e?.detail || "Couldn't save the promotion", false); }
    setSaving(false);
  }

  async function remove(p: PromotionRow) {
    if (!confirm(`Delete "${p.title}"? Its code ${p.offer?.code ?? ""} stops working.`)) return;
    try { await api.delete(`/promotions/admin/${p.id}`); flash("Deleted"); load(); }
    catch { flash("Couldn't delete", false); }
  }

  // Exactly the products this promotion will discount, as the form stands
  const eligible = form.scope === "product" ? products.filter(p => form.product_ids.includes(p.id))
    : form.scope === "category" ? (form.category_id ? products.filter(p => p.category_id === form.category_id) : [])
    : products;

  const toggleProduct = (id: number) => set("product_ids", form.product_ids.includes(id) ? form.product_ids.filter(x => x !== id) : [...form.product_ids, id]);
  const toggleLocation = (k: Location) => set("display_locations", form.display_locations.includes(k) ? form.display_locations.filter(x => x !== k) : [...form.display_locations, k]);

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", fontFamily: "'Kantumruy Pro', sans-serif" }}>Promotions</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
            Every banner, coupon code and sale in one place. Add an image for a big banner; without one the app makes a card from the title, discount, code and dates.
          </p>
        </div>
        <button className="btn-primary" onClick={openCreate} disabled={missingTable}>+ New Promotion</button>
      </div>

      {missingTable ? (
        <div className="admin-card" style={{ padding: 20, fontSize: 14, lineHeight: 1.6 }}>
          <b>Promotions aren&apos;t set up in the database yet.</b> Run <code>supabase/migrations/018_promotions.sql</code> in the Supabase SQL editor, then reload this page.
        </div>
      ) : loading ? <BrandLoader /> : rows.length === 0 ? (
        <div className="admin-card" style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No promotions yet. Create the first one.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map(p => (
            <div key={p.id} className="admin-card" style={{ display: "flex", gap: 14, padding: 14, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ width: 120, height: 68, borderRadius: 10, overflow: "hidden", flexShrink: 0, background: "linear-gradient(135deg,#081D3C,#103562)", display: "grid", placeItems: "center", color: "#D6BA80", fontWeight: 800, fontSize: 15 }}>
                {p.image_url ? <img src={p.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : offerText(p)}
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <b style={{ fontSize: 15 }}>{p.title}</b>
                  <span style={pill(p.is_live ? "#E7F8EF" : "#F1F4F8", p.is_live ? "#067647" : "#5B6472")}>
                    {p.is_live ? "Live now" : !p.is_active ? "Off" : p.next_start ? `Next: ${new Date(p.next_start).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}` : "Ended"}
                  </span>
                  <span style={pill("#FBF4E4", "#71541A")}>{SCOPES.find(s => s.key === p.scope)?.label}{p.scope === "product" ? ` · ${p.product_ids?.length ?? 0}` : p.scope === "category" && p.category_name ? ` · ${p.category_name}` : ""}</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                  <b style={{ color: "var(--text)" }}>{offerText(p)}</b>{p.offer ? <> · code <code>{p.offer.code}</code> · used {p.offer.used_count ?? 0}{p.offer.max_uses ? ` of ${p.offer.max_uses}` : ""} times</> : null}
                  {p.offer?.min_order ? ` · min $${Number(p.offer.min_order).toFixed(2)}` : ""} · {p.scope === "platform" ? "Every shop" : p.shop?.name ?? `Shop #${p.merchant_id}`}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  {p.schedule_type && p.schedule_type !== "once" ? <b style={{ color: "var(--text)" }}>{p.schedule_text}</b> : <>{p.starts_at ? new Date(p.starts_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "Now"} → {p.ends_at ? new Date(p.ends_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "no end date"}</>}
                  {p.auto_apply ? " · applies automatically" : ""}
                  {" · "}{(p.display_locations || []).map(l => LOCATIONS.find(x => x.key === l)?.label ?? l).join(", ")}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn-outline" onClick={() => openEdit(p)}>Edit</button>
                <button className="btn-outline" style={{ color: "#EF4444" }} onClick={() => remove(p)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal-content" style={{ maxWidth: 620, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", marginBottom: 18 }}>{editId ? "Edit promotion" : "New promotion"}</h2>

            <div style={{ display: "grid", gap: 16 }}>
              <Section title="Banner">
                <Field label="Title *"><input className="admin-input" value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g. Serum Week" /></Field>
                <Field label="Subtitle"><input className="admin-input" value={form.subtitle} onChange={e => set("subtitle", e.target.value)} placeholder="e.g. 30% off brightening serums" /></Field>
                <Field label="Banner image">
                  <BannerImageField file={image} savedUrl={savedImage} onFile={setImage} onRemove={() => { setImage(null); setSavedImage(null); }} fileRef={fileRef} onError={msg => flash(msg, false)} />
                </Field>
              </Section>

              <Section title="Promotion Scope">
                {isSuperAdmin && form.scope !== "platform" ? (
                  <Field label="Shop *">
                    <select className="admin-input" value={form.merchant_id} onChange={e => setForm(f => ({ ...f, merchant_id: +e.target.value, product_ids: [], category_id: 0 }))}>
                      <option value={0}>Choose a shop…</option>
                      {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </Field>
                ) : null}
                <div role="radiogroup" aria-label="Promotion scope" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
                  {SCOPES.filter(s => s.key !== "platform" || isSuperAdmin).map(s => {
                    const on = form.scope === s.key;
                    return (
                      <button key={s.key} type="button" role="radio" aria-checked={on} onClick={() => set("scope", s.key)}
                        style={{ textAlign: "left", padding: 12, borderRadius: 12, cursor: "pointer", border: on ? "2px solid #103562" : "1px solid var(--border)", background: on ? "rgba(16,53,98,.06)" : "transparent", position: "relative" }}>
                        <span aria-hidden style={{ position: "absolute", top: 12, right: 12, width: 16, height: 16, borderRadius: 99, border: on ? "5px solid #103562" : "2px solid var(--border)" }} />
                        <b style={{ fontSize: 13, display: "block", paddingRight: 22 }}>{s.label}</b><small style={hint}>{s.hint}</small>
                      </button>
                    );
                  })}
                </div>
                {form.scope === "platform" && (
                  <Field label="Limit to one category (optional)">
                    <select className="admin-input" value={form.category_id} onChange={e => set("category_id", +e.target.value)}>
                      <option value={0}>Every category</option>
                      {categories.filter(c => !c.merchant_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                )}
                {form.scope === "category" && (
                  <Field label="Category *">
                    <select className="admin-input" value={form.category_id} onChange={e => set("category_id", +e.target.value)}>
                      <option value={0}>Choose a category…</option>
                      {shopCategories.map(c => <option key={c.id} value={c.id}>{c.name}{!c.merchant_id ? " (global)" : ""}</option>)}
                    </select>
                  </Field>
                )}
                {form.scope === "product" && (
                  <Field label={`Products * · ${form.product_ids.length} selected`}>
                    <input className="admin-input" value={productQuery} onChange={e => setProductQuery(e.target.value)} placeholder="Search this shop's products" />
                    <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10, marginTop: 6 }}>
                      {!shopId ? <p style={{ ...hint, padding: 12 }}>Choose the shop first.</p>
                        : productsLoading ? <p style={{ ...hint, padding: 12 }}>Loading products…</p>
                        : shownProducts.length === 0 ? <p style={{ ...hint, padding: 12 }}>No products found.</p>
                        : shownProducts.map(p => (
                          <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: 13 }}>
                            <input type="checkbox" checked={form.product_ids.includes(p.id)} onChange={() => toggleProduct(p.id)} />
                            {p.primary_image ? <img src={p.primary_image} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover" }} /> : <span style={{ width: 32 }} />}
                            <span style={{ flex: 1 }}>{p.name}</span>
                            <span style={{ color: "var(--text-muted)" }}>${Number(p.base_price).toFixed(2)}</span>
                          </label>
                        ))}
                    </div>
                  </Field>
                )}
                <EligibleSummary scope={form.scope} shopName={isSuperAdmin ? shops.find(s => s.id === shopId)?.name : "your shop"}
                  products={eligible} shopChosen={form.scope === "platform" || !!shopId} loading={productsLoading} shopProductCount={products.length} categoryName={shopCategories.find(c => c.id === form.category_id)?.name} />
              </Section>

              <Section title="Offer (optional)">
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.has_offer} onChange={e => set("has_offer", e.target.checked)} />
                  This promotion has a coupon code and a discount
                </label>
                {!form.has_offer && <small style={hint}>Without an offer it shows as a banner or announcement only. Nothing is discounted.</small>}
                {form.has_offer && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Coupon code *"><input className="admin-input" value={form.code} onChange={e => set("code", e.target.value.toUpperCase().replace(/\s/g, ""))} placeholder="GIVEYOUBEST" style={{ fontFamily: "monospace", letterSpacing: ".06em" }} /></Field>
                  <Field label="Discount type">
                    <select className="admin-input" value={form.discount_type} onChange={e => set("discount_type", e.target.value as Form["discount_type"])}>
                      <option value="percent">Percent (%)</option>
                      <option value="fixed">Fixed amount ($)</option>
                    </select>
                  </Field>
                  <Field label={`Discount amount * (${form.discount_type === "percent" ? "%" : "$"})`}><input className="admin-input" type="number" min="0" step="0.01" value={form.discount_value} onChange={e => set("discount_value", e.target.value)} placeholder={form.discount_type === "percent" ? "30" : "5.00"} /></Field>
                  <Field label="Minimum order ($)"><input className="admin-input" type="number" min="0" step="0.01" value={form.min_order} onChange={e => set("min_order", e.target.value)} placeholder="0" /></Field>
                  <Field label="Usage limit"><input className="admin-input" type="number" min="1" value={form.max_uses} onChange={e => set("max_uses", e.target.value)} placeholder="Unlimited" /></Field>
                </div>
                )}
              </Section>

              <Section title="Schedule">
                <div role="radiogroup" aria-label="Schedule" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                  {SCHEDULES.map(t => {
                    const on = form.schedule_type === t.key;
                    return (
                      <button key={t.key} type="button" role="radio" aria-checked={on} onClick={() => set("schedule_type", t.key)}
                        style={{ textAlign: "left", padding: 10, borderRadius: 12, cursor: "pointer", border: on ? "2px solid #103562" : "1px solid var(--border)", background: on ? "rgba(16,53,98,.06)" : "transparent" }}>
                        <b style={{ fontSize: 13, display: "block" }}>{t.label}</b><small style={hint}>{t.hint}</small>
                      </button>
                    );
                  })}
                </div>

                {form.schedule_type === "weekly" && <Field label="Days of the week *"><WeekdayPicker value={form.weekdays} onChange={v => set("weekdays", v)} /></Field>}
                {form.schedule_type === "monthly" && <Field label="Days of the month *"><MonthDaysPicker value={form.month_days} onChange={v => set("month_days", v)} /></Field>}
                {form.schedule_type === "yearly" && <Field label="Dates every year *"><YearlyRangesPicker value={form.yearly_ranges} onChange={v => set("yearly_ranges", v)} /></Field>}

                <div style={{ borderRadius: 10, padding: "10px 12px", background: "rgba(16,53,98,.05)", fontSize: 13, fontWeight: 600 }}>
                  {scheduleText(form)} · switches on and off by itself, in Cambodia time
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label={form.schedule_type === "once" ? "Start date" : "Run from (optional)"}><input className="admin-input" type="datetime-local" value={form.starts_at} onChange={e => set("starts_at", e.target.value)} /></Field>
                  <Field label={form.schedule_type === "once" ? "End date" : "Run until (optional)"}><input className="admin-input" type="datetime-local" value={form.ends_at} onChange={e => set("ends_at", e.target.value)} /></Field>
                </div>
                <label style={{ display: form.has_offer ? "flex" : "none", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.auto_apply} onChange={e => set("auto_apply", e.target.checked)} />
                  Apply automatically at checkout (customers don&apos;t need to type the code)
                </label>
              </Section>

              <Section title="Where it shows">
                <Field label="Display locations *">
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {LOCATIONS.map(l => (
                      <label key={l.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                        <input type="checkbox" checked={form.display_locations.includes(l.key)} onChange={() => toggleLocation(l.key)} />{l.label}
                      </label>
                    ))}
                  </div>
                </Field>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.is_active} onChange={e => set("is_active", e.target.checked)} />Active (turning it off also switches the code off)
                </label>
              </Section>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
              <button className="btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : editId ? "Save changes" : "Create promotion"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Banner upload, preview first (Shopify / Facebook Ads pattern): a 16:9 frame shows the
 * image the moment it's picked or dropped; file name, size and pixel size sit underneath
 * as details, with Replace and Remove. The file uploads when the promotion is saved.
 */
function BannerImageField({ file, savedUrl, onFile, onRemove, fileRef, onError }: {
  file: File | null; savedUrl: string | null; onFile: (f: File | null) => void; onRemove: () => void;
  fileRef: React.RefObject<HTMLInputElement>; onError: (msg: string) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const src = preview ?? savedUrl;
  useEffect(() => { setSize(null); }, [src]);

  function take(f: File | undefined | null) {
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) { onError("Use a PNG, JPEG, WebP or GIF image"); return; }
    if (f.size > MAX_IMAGE_MB * 1024 * 1024) { onError(`That image is ${(f.size / 1048576).toFixed(1)} MB. The limit is ${MAX_IMAGE_MB} MB.`); return; }
    onFile(f);
  }
  const pick = () => fileRef.current?.click();
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files?.[0]); };
  const ratio = size ? size.w / size.h : null;
  const offRatio = ratio != null && (ratio < 1.5 || ratio > 2.1);

  return (
    <div>
      <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(",")} style={{ display: "none" }}
        onChange={e => { take(e.target.files?.[0]); e.target.value = ""; }} />
      <div onClick={src ? undefined : pick} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
        style={{ position: "relative", aspectRatio: "16 / 9", width: "100%", borderRadius: 12, overflow: "hidden", cursor: src ? "default" : "pointer",
          border: src ? "1px solid var(--border)" : `2px dashed ${dragging ? "#103562" : "var(--border)"}`, background: src ? "#081D3C" : dragging ? "rgba(16,53,98,.06)" : "var(--bg, #F6F8FB)",
          display: "grid", placeItems: "center" }}>
        {src ? (
          <img src={src} alt="Banner preview" onLoad={e => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ textAlign: "center", padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{dragging ? "Drop to add the banner" : "Add a banner image"}</div>
            <div style={{ ...hint, marginTop: 4 }}>Drag an image here or <span style={{ color: "#103562", fontWeight: 700, textDecoration: "underline" }}>choose a file</span></div>
            <div style={{ ...hint, marginTop: 2 }}>1600 × 900 px recommended · PNG, JPEG, WebP or GIF · up to {MAX_IMAGE_MB} MB</div>
          </div>
        )}
        {file && (
          <span style={{ position: "absolute", top: 10, left: 10, background: "rgba(8,29,60,.85)", color: "#D6BA80", fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 99 }}>
            ✓ Ready · uploads when you save
          </span>
        )}
      </div>
      {src && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file ? file.name : "Current banner"}</div>
            <div>
              {[file ? `${(file.size / 1024 / (file.size > 1048576 ? 1024 : 1)).toFixed(file.size > 1048576 ? 1 : 0)} ${file.size > 1048576 ? "MB" : "KB"}` : null, size ? `${size.w} × ${size.h} px` : null].filter(Boolean).join(" · ")}
              {offRatio && <span style={{ color: "#B54708", fontWeight: 600 }}> · not 16:9, the edges will be cropped</span>}
            </div>
          </div>
          <button type="button" className="btn-outline" onClick={pick}>Replace image</button>
          <button type="button" className="btn-outline" style={{ color: "#EF4444" }} onClick={onRemove}>Remove</button>
        </div>
      )}
    </div>
  );
}

/** Who the promotion discounts, in words and thumbnails, updated as the scope fields change. */
function EligibleSummary({ scope, shopName, products, shopChosen, loading, shopProductCount, categoryName }: {
  scope: Scope; shopName?: string; products: Product[]; shopChosen: boolean; loading: boolean; shopProductCount: number; categoryName?: string;
}) {
  let line: string;
  if (scope === "platform") line = "Every product in every shop is eligible. The discount is taken off each shop's order.";
  else if (!shopChosen) line = "Choose the shop to see which products are eligible.";
  else if (loading) line = `Loading ${shopName ?? "the shop"}'s products…`;
  else if (shopProductCount === 0) line = `${shopName ?? "This shop"} has no products yet, so nothing would be discounted.`;
  else if (scope === "shop") line = `All ${products.length} products in ${shopName ?? "this shop"} are eligible.`;
  else if (scope === "product") line = products.length ? `${products.length} selected ${products.length === 1 ? "product is" : "products are"} eligible.` : "No products selected yet. Tick the products this offer covers.";
  else line = categoryName ? `${products.length} ${products.length === 1 ? "product" : "products"} in ${categoryName} ${products.length === 1 ? "is" : "are"} eligible.` : "Choose the category to see its products.";
  const empty = scope !== "platform" && shopChosen && !loading && products.length === 0;
  return (
    <div style={{ borderRadius: 12, padding: 12, background: empty ? "#FFF6EB" : "rgba(16,53,98,.05)", border: `1px solid ${empty ? "#F8BD68" : "rgba(16,53,98,.15)"}` }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-muted)" }}>Eligible products</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginTop: 2 }}>{line}</div>
      {scope !== "platform" && products.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          {products.slice(0, 8).map(p => (
            <span key={p.id} title={p.name} style={{ width: 36, height: 36, borderRadius: 8, overflow: "hidden", background: "#E3E8EF", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, color: "#5B6472" }}>
              {p.primary_image ? <img src={p.primary_image} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : p.name[0]?.toUpperCase()}
            </span>
          ))}
          {products.length > 8 && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>+{products.length - 8} more</span>}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, display: "grid", gap: 12, margin: 0 }}>
      <legend style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-muted)", padding: "0 6px" }}>{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={lbl}>{label}</label>{children}</div>;
}

const pill = (bg: string, fg: string): React.CSSProperties => ({ background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 });
const hint: React.CSSProperties = { display: "block", fontSize: 11, color: "var(--text-muted)", marginTop: 4 };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 };
