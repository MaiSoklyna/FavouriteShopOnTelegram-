"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { HeroImagesEditor } from "@/components/admin/HeroImagesEditor";
import type { Merchant } from "@/types";

const EMPTY_FORM = {
  name: "",
  slug: "",
  owner_name: "",
  email: "",
  phone: "",
  tagline: "",
  description: "",
  icon_emoji: "",
  accent_color: "",
  plan: "Basic",
  fb_page: "",
  instagram: "",
  password: "",
  confirm: "",
  telegram_id: "",
  is_featured: false,
};

type MerchantAdminRow = {
  id: number;
  merchant_id: number;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
};

function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function MerchantsPage() {
  const { isSuperAdmin } = useAuth();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Merchant | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>("");
  const [existingLogoUrl, setExistingLogoUrl] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Credentials modal state
  const [credsMerchant, setCredsMerchant] = useState<Merchant | null>(null);
  const [credsAdmin, setCredsAdmin] = useState<MerchantAdminRow | null>(null);
  const [credsLoading, setCredsLoading] = useState(false);
  const [credsForm, setCredsForm] = useState({ email: "", new_password: "", confirm: "", telegram_id: "" });
  const [credsSaving, setCredsSaving] = useState(false);

  const isEditMode = editId !== null;

  const flash = (msg: string, ok = true) => { setToast({ show: true, msg, ok }); setTimeout(() => setToast(t => ({ ...t, show: false })), 3500); };

  async function load() { try { setMerchants(await api.get<Merchant[]>("/merchants", { params: search ? { search } : undefined })); } catch { /* */ } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [search]);

  async function toggleStatus(m: Merchant) {
    const newStatus = m.status === "active" ? "suspended" : "active";
    await api.patch(`/merchants/${m.id}`, { status: newStatus });
    load();
  }

  function openCreate() {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setLogoFile(null);
    setLogoPreview("");
    setExistingLogoUrl("");
    setCreateOpen(true);
  }

  function openEdit(m: Merchant) {
    setEditId(m.id);
    setForm({
      ...EMPTY_FORM,
      name: m.name || "",
      slug: m.slug || "",
      owner_name: m.owner_name || "",
      email: m.email || "",
      phone: m.phone || "",
      tagline: m.tagline || "",
      description: m.description || "",
      icon_emoji: m.icon_emoji || "",
      accent_color: m.accent_color || "",
      plan: m.plan || "Basic",
      fb_page: m.fb_page || "",
      instagram: m.instagram || "",
      is_featured: !!m.is_featured,
    });
    setLogoFile(null);
    setLogoPreview("");
    setExistingLogoUrl(m.logo_url || "");
    setCreateOpen(true);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) { setLogoFile(null); setLogoPreview(""); return; }
    if (f.size > 2 * 1024 * 1024) { flash("Logo must be under 2 MB", false); return; }
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(f.type)) {
      flash("Logo must be PNG, JPEG, WebP, or GIF", false);
      return;
    }
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
  }

  async function saveCreate() {
    // Common validation
    if (!form.name.trim() || !form.owner_name.trim() || !form.email.trim()) {
      flash("Name, owner, and email are required", false);
      return;
    }

    // Build the merchant fields payload (used for both create and edit)
    const merchantFields = ["name", "owner_name", "email", "phone", "tagline", "description", "icon_emoji", "accent_color", "plan", "fb_page", "instagram"] as const;
    const merchantPayload: Record<string, unknown> = {};
    for (const k of merchantFields) {
      const v = (form as any)[k];
      if (typeof v !== "string") continue;
      merchantPayload[k] = v.trim() === "" ? null : v;
    }
    // Boolean fields go through unmodified (super-admin-only on the backend side)
    merchantPayload.is_featured = !!form.is_featured;

    if (isEditMode) {
      // ── EDIT path ──
      setSaving(true);
      try {
        await api.patch(`/merchants/${editId}`, merchantPayload);

        if (logoFile) {
          const fd = new FormData();
          fd.append("file", logoFile);
          try {
            await api.upload(`/merchants/${editId}/logo`, fd);
          } catch (e: any) {
            flash(`Merchant updated, but logo upload failed: ${e.detail || "unknown"}`, false);
            setCreateOpen(false);
            load();
            setSaving(false);
            return;
          }
        }

        flash("Merchant updated!");
        setCreateOpen(false);
        load();
      } catch (e: any) {
        flash(e.detail || e.message || "Error updating merchant", false);
      }
      setSaving(false);
      return;
    }

    // ── CREATE path ──
    if (!form.slug.trim()) {
      flash("Slug is required", false);
      return;
    }
    if (!/^[a-z0-9-]+$/.test(form.slug)) {
      flash("Slug must use lowercase letters, digits, and hyphens", false);
      return;
    }
    if (form.password.length < 8) {
      flash("Password must be at least 8 characters", false);
      return;
    }
    if (form.password !== form.confirm) {
      flash("Passwords do not match", false);
      return;
    }
    if (form.telegram_id && !/^\d+$/.test(form.telegram_id.trim())) {
      flash("Telegram ID must be numeric", false);
      return;
    }

    setSaving(true);
    try {
      // Step 1 — create the merchant row (slug only valid on create)
      const createPayload: Record<string, unknown> = { ...merchantPayload, slug: form.slug };
      // Strip nulls on create (let DB defaults apply)
      for (const k of Object.keys(createPayload)) {
        if (createPayload[k] === null) delete createPayload[k];
      }
      const created = await api.post<Merchant>("/merchants", createPayload);
      if (!created?.id) throw new Error("Merchant create returned no id");

      // Step 2 — create the merchant_admin login (password + optional telegram)
      try {
        const adminPayload: Record<string, unknown> = {
          email: form.email.trim(),
          password: form.password,
          full_name: form.owner_name.trim(),
          merchant_id: created.id,
          role: "admin",
        };
        if (form.telegram_id.trim()) adminPayload.telegram_id = Number(form.telegram_id.trim());
        await api.post("/auth/create-merchant-admin", adminPayload);
      } catch (e: any) {
        flash(`Shop created (id=${created.id}), but login setup failed: ${e.detail || "unknown"}. Use the row's "Credentials" action to retry.`, false);
        setCreateOpen(false);
        load();
        setSaving(false);
        return;
      }

      // Step 3 — optional logo upload
      if (logoFile) {
        const fd = new FormData();
        fd.append("file", logoFile);
        try {
          await api.upload(`/merchants/${created.id}/logo`, fd);
        } catch (e: any) {
          flash(`Shop & login created, but logo upload failed: ${e.detail || "unknown"}`, false);
          setCreateOpen(false);
          load();
          setSaving(false);
          return;
        }
      }

      flash("Merchant + login created!");
      setCreateOpen(false);
      load();
    } catch (e: any) {
      flash(e.detail || e.message || "Error creating merchant", false);
    }
    setSaving(false);
  }

  // ── Credentials modal ──────────────────────────────────────────

  async function openCreds(m: Merchant) {
    setCredsMerchant(m);
    setCredsAdmin(null);
    setCredsForm({ email: "", new_password: "", confirm: "", telegram_id: "" });
    setCredsLoading(true);
    try {
      const list = await api.get<MerchantAdminRow[]>("/auth/merchant-admins", { params: { merchant_id: m.id } });
      const admin = list?.[0] || null;
      setCredsAdmin(admin);
      if (admin) {
        setCredsForm({ email: admin.email || "", new_password: "", confirm: "", telegram_id: "" });
      } else {
        setCredsForm({ email: m.email || "", new_password: "", confirm: "", telegram_id: "" });
      }
    } catch (e: any) {
      flash(e.detail || "Failed to load admin", false);
    }
    setCredsLoading(false);
  }

  function closeCreds() { setCredsMerchant(null); setCredsAdmin(null); }

  async function saveCreds() {
    if (!credsAdmin) {
      // No admin exists for this merchant — create one
      if (!credsMerchant) return;
      if (!credsForm.email.trim()) { flash("Email is required", false); return; }
      if (credsForm.new_password.length < 8) { flash("Password must be at least 8 characters", false); return; }
      if (credsForm.new_password !== credsForm.confirm) { flash("Passwords do not match", false); return; }
      if (credsForm.telegram_id && !/^\d+$/.test(credsForm.telegram_id.trim())) { flash("Telegram ID must be numeric", false); return; }

      setCredsSaving(true);
      try {
        const payload: Record<string, unknown> = {
          email: credsForm.email.trim(),
          password: credsForm.new_password,
          full_name: credsMerchant.owner_name,
          merchant_id: credsMerchant.id,
          role: "admin",
        };
        if (credsForm.telegram_id.trim()) payload.telegram_id = Number(credsForm.telegram_id.trim());
        await api.post("/auth/create-merchant-admin", payload);
        flash("Login created!");
        closeCreds();
      } catch (e: any) {
        flash(e.detail || "Failed to create login", false);
      }
      setCredsSaving(false);
      return;
    }

    // Update existing admin
    const patch: Record<string, unknown> = {};
    if (credsForm.email.trim() && credsForm.email.trim() !== credsAdmin.email) {
      patch.email = credsForm.email.trim();
    }
    if (credsForm.new_password) {
      if (credsForm.new_password.length < 8) { flash("Password must be at least 8 characters", false); return; }
      if (credsForm.new_password !== credsForm.confirm) { flash("Passwords do not match", false); return; }
      patch.new_password = credsForm.new_password;
    }
    if (credsForm.telegram_id.trim()) {
      if (!/^\d+$/.test(credsForm.telegram_id.trim())) { flash("Telegram ID must be numeric", false); return; }
      patch.telegram_id = Number(credsForm.telegram_id.trim());
    }
    if (Object.keys(patch).length === 0) {
      flash("Nothing to change", false);
      return;
    }

    setCredsSaving(true);
    try {
      await api.patch(`/auth/merchant-admins/${credsAdmin.id}`, patch);
      flash("Credentials updated!");
      closeCreds();
    } catch (e: any) {
      flash(e.detail || "Failed to update credentials", false);
    }
    setCredsSaving(false);
  }

  async function clearTelegramId() {
    if (!credsAdmin) return;
    if (!confirm("Remove the Telegram link for this merchant? They will no longer be able to log in via Telegram.")) return;
    setCredsSaving(true);
    try {
      await api.patch(`/auth/merchant-admins/${credsAdmin.id}`, { clear_telegram_id: true });
      flash("Telegram ID cleared");
      closeCreds();
    } catch (e: any) {
      flash(e.detail || "Failed", false);
    }
    setCredsSaving(false);
  }

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Merchants</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{merchants.length} merchants</p>
        </div>
        {isSuperAdmin && (
          <button className="btn-primary" onClick={openCreate}>+ Add Merchant</button>
        )}
      </div>

      <input className="admin-input" style={{ maxWidth: 300, marginBottom: 16 }} placeholder="Search merchants..." value={search} onChange={e => setSearch(e.target.value)} />

      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div> : (
          <table className="admin-table">
            <thead><tr><th>Logo</th><th>Name</th><th>Owner</th><th>Email</th><th>Plan</th><th>Products</th><th>Orders</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {merchants.length === 0 ? <tr><td colSpan={9} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No merchants</td></tr> :
              merchants.map(m => (
                <tr key={m.id}>
                  <td>
                    {m.logo_url
                      ? <img src={m.logo_url} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }} />
                      : <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--bg-secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{m.icon_emoji || "🏪"}</div>}
                  </td>
                  <td>
                    <p style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                      {m.name}
                      {m.is_featured && <span title="Featured shop" style={{ fontSize: 11 }}>⭐</span>}
                    </p>
                    <p style={{ fontSize: 10, color: "var(--text-muted)" }}>/{m.slug}</p>
                  </td>
                  <td>{m.owner_name}</td>
                  <td style={{ fontSize: 12 }}>{m.email}</td>
                  <td><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "var(--bg-secondary)" }}>{m.plan}</span></td>
                  <td>{m.product_count || 0}</td>
                  <td>{m.order_count || 0}</td>
                  <td><span className={`badge ${m.status === "active" ? "badge-delivered" : "badge-cancelled"}`}>{m.status}</span></td>
                  <td><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => setDetail(m)} style={actionBtn("var(--info)")}>View</button>
                    {isSuperAdmin && (
                      <>
                        <button onClick={() => openEdit(m)} style={actionBtn("var(--accent, #6366f1)")}>Edit</button>
                        <button onClick={() => openCreds(m)} style={actionBtn("var(--accent, #6366f1)")}>Credentials</button>
                        <button onClick={() => toggleStatus(m)} style={actionBtn(m.status === "active" ? "var(--danger)" : "var(--success)")}>{m.status === "active" ? "Suspend" : "Activate"}</button>
                      </>
                    )}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Detail modal ────────────────────────────── */}
      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal-content" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>{detail.icon_emoji} {detail.name}</h2>
            {detail.logo_url && (
              <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}>
                <img src={detail.logo_url} alt="logo" style={{ maxWidth: 120, maxHeight: 120, borderRadius: 12, objectFit: "cover" }} />
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
              {[["Owner", detail.owner_name], ["Email", detail.email], ["Phone", detail.phone], ["Plan", detail.plan], ["Status", detail.status], ["Products", detail.product_count], ["Orders", detail.order_count], ["Joined", detail.created_at ? new Date(detail.created_at).toLocaleDateString() : "—"]].map(([k, v]) => (
                <div key={k as string}><span style={{ color: "var(--text-muted)" }}>{k}: </span><span style={{ color: "var(--text)" }}>{v ?? "—"}</span></div>
              ))}
              {detail.tagline && <div style={{ gridColumn: "1/3" }}><span style={{ color: "var(--text-muted)" }}>Tagline: </span>{detail.tagline}</div>}
              {detail.description && <div style={{ gridColumn: "1/3" }}><span style={{ color: "var(--text-muted)" }}>Description: </span>{detail.description}</div>}
            </div>
            <button className="btn-outline" style={{ width: "100%", marginTop: 16 }} onClick={() => setDetail(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ── Create / Edit modal ────────────────────────────── */}
      {createOpen && (
        <div className="modal-overlay" onClick={() => setCreateOpen(false)}>
          <div className="modal-content" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>
              {isEditMode ? "Edit Merchant" : "New Merchant"}
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Logo */}
              <div>
                <label style={lbl}>Logo</label>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ width: 64, height: 64, borderRadius: 12, background: "var(--bg-secondary)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", border: "1px solid var(--border)" }}>
                    {logoPreview
                      ? <img src={logoPreview} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : existingLogoUrl
                      ? <img src={existingLogoUrl} alt="current logo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <span style={{ fontSize: 24, color: "var(--text-muted)" }}>🏪</span>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <button type="button" className="btn-outline" onClick={() => fileInputRef.current?.click()} style={{ alignSelf: "flex-start" }}>
                      {logoFile ? "Change image" : (isEditMode && existingLogoUrl) ? "Replace logo" : "Choose image"}
                    </button>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>PNG / JPEG / WebP / GIF · max 2 MB</span>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleFile} style={{ display: "none" }} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={lbl}>Shop name *</label>
                  <input className="admin-input" value={form.name} onChange={e => {
                    const name = e.target.value;
                    setForm(f => ({ ...f, name, slug: isEditMode ? f.slug : (f.slug || slugify(name)) }));
                  }} placeholder="Sunshine Cafe" />
                </div>
                <div>
                  <label style={lbl}>Slug {isEditMode ? "(read-only)" : "*"}</label>
                  <input className="admin-input" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="sunshine-cafe" disabled={isEditMode} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={lbl}>Owner name *</label>
                  <input className="admin-input" value={form.owner_name} onChange={e => setForm({ ...form, owner_name: e.target.value })} />
                </div>
                <div>
                  <label style={lbl}>Contact email *</label>
                  <input className="admin-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>

              {isEditMode && (
                <div style={{ padding: "8px 12px", background: "var(--bg-secondary)", borderRadius: 8, fontSize: 11, color: "var(--text-muted)" }}>
                  This is the shop's contact email shown to customers. To change the seller's <strong>login email</strong> or <strong>password</strong>, use the <strong>Credentials</strong> action on the row.
                </div>
              )}

              {/* Hero carousel manager — edit mode only (need a merchant id) */}
              {isEditMode && editId !== null && (
                <div style={{ marginTop: 4, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
                  <HeroImagesEditor merchantId={editId} onError={(msg) => flash(msg, false)} />
                </div>
              )}

              {/* ── Login credentials section (CREATE only) ── */}
              {!isEditMode && (
                <div style={{ marginTop: 4, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>Login credentials</p>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>The seller can log in by password OR by Telegram (if you set their Telegram ID).</p>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <label style={lbl}>Password * (min 8 chars)</label>
                      <input className="admin-input" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
                    </div>
                    <div>
                      <label style={lbl}>Confirm password *</label>
                      <input className="admin-input" type="password" value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" />
                    </div>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <label style={lbl}>Telegram ID (optional)</label>
                    <input className="admin-input" inputMode="numeric" value={form.telegram_id} onChange={e => setForm({ ...form, telegram_id: e.target.value.replace(/\D/g, "") })} placeholder="e.g. 123456789" />
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Seller can find their Telegram ID by messaging <code>@userinfobot</code>.</p>
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={lbl}>Phone</label>
                  <input className="admin-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div>
                  <label style={lbl}>Plan</label>
                  <select className="admin-input" value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })}>
                    <option value="Basic">Basic</option>
                    <option value="Pro">Pro</option>
                    <option value="Enterprise">Enterprise</option>
                  </select>
                </div>
              </div>

              {/* Featured shop toggle (super-admin only — field is stripped server-side for merchant_admin) */}
              {isSuperAdmin && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 14px", background: form.is_featured ? "var(--accent-light, #FEF3C7)" : "var(--bg-secondary)",
                  borderRadius: 10, border: form.is_featured ? "1px solid var(--warning, #F59E0B)" : "1px solid var(--border)",
                  transition: "all 0.2s",
                }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 16 }}>⭐</span> Featured shop
                    </p>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      Pinned to the “Featured Shops” strip on the Telegram mini app home page.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, is_featured: !form.is_featured })}
                    aria-pressed={form.is_featured}
                    style={{
                      width: 46, height: 26, borderRadius: 13,
                      background: form.is_featured ? "var(--warning, #F59E0B)" : "#d1d5db",
                      cursor: "pointer", position: "relative", border: "none",
                      transition: "background 0.2s", flexShrink: 0, padding: 0,
                    }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%", background: "#fff",
                      position: "absolute", top: 2, left: form.is_featured ? 22 : 2,
                      transition: "left 0.2s",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                    }} />
                  </button>
                </div>
              )}

              <div>
                <label style={lbl}>Tagline</label>
                <input className="admin-input" value={form.tagline} onChange={e => setForm({ ...form, tagline: e.target.value })} placeholder="Short one-liner" />
              </div>

              <div>
                <label style={lbl}>Description</label>
                <textarea className="admin-input" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div>
                  <label style={lbl}>Icon emoji</label>
                  <input className="admin-input" value={form.icon_emoji} onChange={e => setForm({ ...form, icon_emoji: e.target.value })} placeholder="🛍️" />
                </div>
                <div>
                  <label style={lbl}>Accent color</label>
                  <input className="admin-input" type="text" value={form.accent_color} onChange={e => setForm({ ...form, accent_color: e.target.value })} placeholder="#16a34a" maxLength={7} />
                </div>
                <div>
                  <label style={lbl}>FB / IG</label>
                  <input className="admin-input" value={form.fb_page} onChange={e => setForm({ ...form, fb_page: e.target.value })} placeholder="facebook.com/..." />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button className="btn-outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={saveCreate} disabled={saving}>
                {saving ? (isEditMode ? "Saving..." : "Creating...") : (isEditMode ? "Save changes" : "Create merchant")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Credentials modal ────────────────────────────── */}
      {credsMerchant && (
        <div className="modal-overlay" onClick={closeCreds}>
          <div className="modal-content" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Credentials — {credsMerchant.name}</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
              {credsLoading ? "Loading…"
                : credsAdmin ? `Login: ${credsAdmin.email}`
                : "No login account exists yet for this merchant. Create one below."}
            </p>

            {!credsLoading && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={lbl}>Login email *</label>
                  <input className="admin-input" type="email" value={credsForm.email} onChange={e => setCredsForm({ ...credsForm, email: e.target.value })} autoComplete="email" />
                  <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>This is what the seller types on the login screen.</p>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={lbl}>{credsAdmin ? "New password (leave blank to keep)" : "Password *"}</label>
                    <input className="admin-input" type="password" value={credsForm.new_password} onChange={e => setCredsForm({ ...credsForm, new_password: e.target.value })} autoComplete="new-password" />
                  </div>
                  <div>
                    <label style={lbl}>Confirm password</label>
                    <input className="admin-input" type="password" value={credsForm.confirm} onChange={e => setCredsForm({ ...credsForm, confirm: e.target.value })} autoComplete="new-password" />
                  </div>
                </div>

                <div>
                  <label style={lbl}>Telegram ID {credsAdmin ? "(set or change)" : "(optional)"}</label>
                  <input className="admin-input" inputMode="numeric" value={credsForm.telegram_id} onChange={e => setCredsForm({ ...credsForm, telegram_id: e.target.value.replace(/\D/g, "") })} placeholder="e.g. 123456789" />
                  <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Seller messages <code>@userinfobot</code> on Telegram to find their ID.</p>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  {credsAdmin
                    ? <button className="btn-outline" style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={clearTelegramId} disabled={credsSaving}>Clear Telegram link</button>
                    : <span />}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn-outline" onClick={closeCreds} disabled={credsSaving}>Cancel</button>
                    <button className="btn-primary" onClick={saveCreds} disabled={credsSaving}>{credsSaving ? "Saving…" : credsAdmin ? "Save changes" : "Create login"}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 };

const actionBtn = (color: string): React.CSSProperties => ({
  background: "none",
  border: "none",
  cursor: "pointer",
  color,
  fontSize: 12,
  fontWeight: 500,
  padding: 0,
});
