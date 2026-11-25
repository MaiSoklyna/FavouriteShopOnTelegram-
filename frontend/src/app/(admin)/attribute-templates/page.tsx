"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AttributeField, AttributeTemplate, AttributeType } from "@/types";
import { BrandLoader } from "@/components/ui/Spinner";

const TYPE_LABEL: Record<AttributeType, string> = { text: "Text", number: "Number", select: "Select", multi_select: "Multi-select", boolean: "Yes / No" };
const NEW_FIELD = { key: "", label: "", type: "select" as AttributeType, unit: "", options: "", filterable: false, importance: "optional" as "optional" | "recommended", help_text: "" };

/** Platform: which details each kind of product has. Shops fill the values; they cannot add fields. */
export default function AttributeTemplatesPage() {
  const [templates, setTemplates] = useState<AttributeTemplate[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<number | null>(null);
  const [field, setField] = useState({ ...NEW_FIELD });
  const [optionDraft, setOptionDraft] = useState<Record<number, string>>({});
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });

  const flash = (msg: string, ok = true) => { setToast({ show: true, msg, ok }); setTimeout(() => setToast(t => ({ ...t, show: false })), 3000); };
  const load = useCallback(async () => {
    try {
      const r = await api.get<{ data: AttributeTemplate[] }>("/attribute-templates/admin/all");
      setTemplates(r.data); setError("");
      if (r.data.length === 0) setError("No templates yet. Run supabase/migrations/036_product_attributes.sql to add the first set.");
    } catch (e: any) { setError(e?.detail || "Could not load templates"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function editField(f: AttributeField, body: Record<string, unknown>) {
    try { await api.patch(`/attribute-templates/admin/fields/${f.id}`, body); load(); }
    catch (e: any) { flash(e?.detail || "Could not save", false); }
  }
  async function editTemplate(t: AttributeTemplate, body: Record<string, unknown>) {
    try { await api.patch(`/attribute-templates/admin/${t.id}`, body); load(); }
    catch (e: any) { flash(e?.detail || "Could not save", false); }
  }
  async function addField(t: AttributeTemplate) {
    const key = field.key.trim() || field.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    try {
      await api.post(`/attribute-templates/admin/${t.id}/fields`, {
        key, label: field.label.trim(), type: field.type, unit: field.unit.trim() || null,
        options: field.options.split(",").map(o => o.trim()).filter(Boolean), filterable: field.filterable,
        importance: field.importance, help_text: field.help_text.trim() || null,
        sort_order: (Math.max(0, ...t.fields.map(f => f.sort_order)) + 10),
      });
      flash("Field added"); setAdding(null); setField({ ...NEW_FIELD }); load();
    } catch (e: any) { flash(e?.detail || "Could not add the field", false); }
  }

  const byType = templates.reduce<Record<string, AttributeTemplate[]>>((acc, t) => { (acc[t.shop_type || "Other"] ||= []).push(t); return acc; }, {});

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Product Details</h1>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16, maxWidth: 680 }}>
        Each kind of product has a set of details shops fill in. <strong>Recommended</strong> details count double in a product&apos;s completeness score.
        <strong> Filter</strong> details appear as filters in customer search. A field&apos;s key and type cannot change once it exists.
      </p>
      {loading ? <BrandLoader /> : error ? <div className="admin-card" style={{ fontSize: 13, color: "var(--text-muted)" }}>{error}</div> : (
        Object.entries(byType).map(([type, list]) => (
          <div key={type} style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8 }}>{type}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {list.map(t => (
                <div key={t.id} className="admin-card" style={{ padding: 0 }} data-testid={`template-${t.key}`}>
                  <button onClick={() => setOpenId(openId === t.id ? null : t.id)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "12px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
                    <span style={{ fontWeight: 600 }}>{t.name} {!t.is_active && <span className="badge badge-cancelled" style={{ marginLeft: 6 }}>Off</span>}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {t.fields.length} details · {t.fields.filter(f => f.filterable).length} filters · {t.product_count ?? 0} products {openId === t.id ? "▲" : "▼"}
                    </span>
                  </button>
                  {openId === t.id && (
                    <div style={{ borderTop: "1px solid var(--border)", overflowX: "auto" }}>
                      <table className="admin-table">
                        <thead><tr><th>Detail</th><th>Type</th><th>Options / unit</th><th>Importance</th><th>Filter</th><th>Shown</th></tr></thead>
                        <tbody>
                          {t.fields.map(f => (
                            <tr key={f.id}>
                              <td><div style={{ fontWeight: 600 }}>{f.label}</div><div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>{f.key}</div></td>
                              <td style={{ fontSize: 12 }}>{TYPE_LABEL[f.type]}</td>
                              <td style={{ fontSize: 12, maxWidth: 320 }}>
                                {f.type === "select" || f.type === "multi_select" ? (
                                  <>
                                    <div>{f.options.map(o => o.label).join(", ")}</div>
                                    <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                                      <input className="admin-input" style={{ fontSize: 12, padding: "4px 8px" }} placeholder="Add options, comma separated" value={optionDraft[f.id] || ""} onChange={e => setOptionDraft({ ...optionDraft, [f.id]: e.target.value })} />
                                      <button className="btn-outline" disabled={!optionDraft[f.id]?.trim()} onClick={() => { editField(f, { add_options: optionDraft[f.id].split(",") }); setOptionDraft({ ...optionDraft, [f.id]: "" }); }}>Add</button>
                                    </div>
                                  </>
                                ) : f.unit || "—"}
                              </td>
                              <td>
                                <select className="admin-input" style={{ fontSize: 12, padding: "4px 8px" }} value={f.importance} onChange={e => editField(f, { importance: e.target.value })}>
                                  <option value="recommended">Recommended</option><option value="optional">Optional</option>
                                </select>
                              </td>
                              <td><input type="checkbox" aria-label="Filterable" checked={f.filterable} disabled={f.type === "text" && f.key !== "brand"} onChange={e => editField(f, { filterable: e.target.checked })} /></td>
                              <td><input type="checkbox" aria-label="Shown in the form" checked={f.is_active} onChange={e => editField(f, { is_active: e.target.checked })} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--border)" }}>
                        <button className="btn-outline" onClick={() => { setAdding(adding === t.id ? null : t.id); setField({ ...NEW_FIELD }); }}>+ Add a detail</button>
                        <button className="btn-outline" onClick={() => editTemplate(t, { is_active: !t.is_active })}>{t.is_active ? "Switch template off" : "Switch template on"}</button>
                      </div>
                      {adding === t.id && (
                        <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                          <label style={{ fontSize: 12 }}>Label<input className="admin-input" value={field.label} onChange={e => setField({ ...field, label: e.target.value })} /></label>
                          <label style={{ fontSize: 12 }}>Key (optional)<input className="admin-input" value={field.key} onChange={e => setField({ ...field, key: e.target.value })} placeholder="made from the label" /></label>
                          <label style={{ fontSize: 12 }}>Type
                            <select className="admin-input" value={field.type} onChange={e => setField({ ...field, type: e.target.value as AttributeType })}>
                              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          </label>
                          {(field.type === "select" || field.type === "multi_select") && <label style={{ fontSize: 12, gridColumn: "1 / -1" }}>Options (comma separated)<input className="admin-input" value={field.options} onChange={e => setField({ ...field, options: e.target.value })} /></label>}
                          {field.type === "number" && <label style={{ fontSize: 12 }}>Unit<input className="admin-input" value={field.unit} onChange={e => setField({ ...field, unit: e.target.value })} placeholder="ml, GB, cm…" /></label>}
                          <label style={{ fontSize: 12 }}>Importance
                            <select className="admin-input" value={field.importance} onChange={e => setField({ ...field, importance: e.target.value as "optional" | "recommended" })}>
                              <option value="optional">Optional</option><option value="recommended">Recommended</option>
                            </select>
                          </label>
                          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={field.filterable} onChange={e => setField({ ...field, filterable: e.target.checked })} /> Customers can filter by it</label>
                          <label style={{ fontSize: 12, gridColumn: "1 / -1" }}>Help text (optional)<input className="admin-input" value={field.help_text} onChange={e => setField({ ...field, help_text: e.target.value })} /></label>
                          <div style={{ gridColumn: "1 / -1" }}><button className="btn-primary" disabled={!field.label.trim()} onClick={() => addField(t)}>Add detail</button></div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
