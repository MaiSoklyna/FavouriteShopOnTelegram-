"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { BrandLoader } from "@/components/ui/Spinner";
import { MonthDaysPicker, WeekdayPicker, YearlyRangesPicker, fromLocal, scheduleText, toLocal, type ScheduleType, type YearlyRange } from "@/components/admin/ScheduleInputs";
import type { Category } from "@/types";

type Kind = "permanent" | "seasonal" | "scheduled";

interface FeaturedRow {
  id: number; category_id: number; kind: Kind; priority: number; is_active: boolean;
  schedule_type: ScheduleType; starts_at: string | null; ends_at: string | null;
  weekdays: number[]; month_days: number[]; yearly_ranges: YearlyRange[];
  category?: Category | null; is_live: boolean; next_start: string | null; active_until: string | null; schedule_text: string;
}
interface HomeCategory extends Category { featured_id: number | null; source: string }
interface AdminData { rows: FeaturedRow[]; home: HomeCategory[]; min: number; max: number }

const KINDS: { key: Kind; label: string; hint: string }[] = [
  { key: "permanent", label: "Permanent", hint: "Always on Home" },
  { key: "seasonal", label: "Seasonal", hint: "Comes back on the same dates every year" },
  { key: "scheduled", label: "Scheduled", hint: "Between two dates, or on set days" },
];

interface Form {
  category_id: number; kind: Kind; schedule_type: ScheduleType; starts_at: string; ends_at: string;
  weekdays: number[]; month_days: number[]; yearly_ranges: YearlyRange[]; is_active: boolean;
}
const EMPTY: Form = { category_id: 0, kind: "permanent", schedule_type: "once", starts_at: "", ends_at: "", weekdays: [], month_days: [], yearly_ranges: [], is_active: true };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** Which category icons Home shows, in what order, and when. Super admin only. */
export default function FeaturedCategoriesPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [missingTable, setMissingTable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });

  const flash = (msg: string, ok = true) => {
    setToast({ show: true, msg, ok });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 3500);
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));

  async function load() {
    try {
      setData(await api.get<AdminData>("/featured-categories/admin"));
      setMissingTable(false);
    } catch (e: any) {
      if (String(e?.detail || "").includes("020_featured_categories")) setMissingTable(true);
      else flash(e?.detail || "Couldn't load featured categories", false);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    api.get<Category[]>("/categories").then(setCategories).catch(() => {});
  }, []);

  const rows = data?.rows ?? [];
  const liveCount = rows.filter(r => r.is_live).length;

  function openCreate() {
    setEditId(null);
    setForm({ ...EMPTY, category_id: categories.find(c => !rows.some(r => r.category_id === c.id))?.id ?? 0 });
    setModal(true);
  }

  function openEdit(r: FeaturedRow) {
    setEditId(r.id);
    setForm({
      category_id: r.category_id, kind: r.kind, schedule_type: r.schedule_type, starts_at: toLocal(r.starts_at), ends_at: toLocal(r.ends_at),
      weekdays: r.weekdays ?? [], month_days: r.month_days ?? [], yearly_ranges: r.yearly_ranges ?? [], is_active: r.is_active,
    });
    setModal(true);
  }

  async function save() {
    if (!form.category_id) return flash("Choose a category", false);
    const body = {
      category_id: form.category_id, kind: form.kind, is_active: form.is_active,
      priority: editId ? rows.find(r => r.id === editId)?.priority ?? 100 : (Math.max(0, ...rows.map(r => r.priority)) + 10),
      schedule_type: form.kind === "seasonal" ? "yearly" : form.kind === "permanent" ? "once" : form.schedule_type,
      starts_at: fromLocal(form.starts_at), ends_at: fromLocal(form.ends_at),
      weekdays: form.weekdays, month_days: form.month_days, yearly_ranges: form.yearly_ranges,
    };
    setSaving(true);
    try {
      if (editId) await api.put(`/featured-categories/admin/${editId}`, body);
      else await api.post("/featured-categories/admin", body);
      flash(editId ? "Saved" : "Added to Home");
      setModal(false);
      load();
    } catch (e: any) { flash(e?.detail || "Couldn't save", false); }
    setSaving(false);
  }

  async function remove(r: FeaturedRow) {
    if (!confirm(`Take ${r.category?.name ?? "this category"} off Home? It stays on the Discover and Categories pages.`)) return;
    try { await api.delete(`/featured-categories/admin/${r.id}`); flash("Removed from Home"); load(); }
    catch { flash("Couldn't remove", false); }
  }

  async function move(index: number, dir: -1 | 1) {
    const ids = rows.map(r => r.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setData(d => d && { ...d, rows: ids.map(id => d.rows.find(r => r.id === id)!) });
    try { await api.post("/featured-categories/admin/reorder", { ids }); load(); }
    catch { flash("Couldn't save the order", false); load(); }
  }

  const chosenTaken = !editId && rows.some(r => r.category_id === form.category_id);

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Home Categories</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
            Pick the category icons on Home and when they show. Home shows 4–8. Every category stays on the Discover and Categories pages.
          </p>
        </div>
        <button className="btn-primary" onClick={openCreate} disabled={missingTable}>+ Add to Home</button>
      </div>

      {missingTable ? (
        <div className="admin-card" style={{ padding: 20, fontSize: 14, lineHeight: 1.6 }}>
          <b>Featured categories aren&apos;t set up in the database yet.</b> Run <code>supabase/migrations/020_featured_categories.sql</code> in the Supabase SQL editor, then reload this page.
          Until then Home shows the categories with the most products.
        </div>
      ) : loading ? <BrandLoader /> : (
        <div style={{ display: "grid", gap: 16 }}>
          {/* What Home shows right now */}
          <div className="admin-card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-muted)" }}>On Home right now</div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
              {(data?.home ?? []).map(c => (
                <div key={c.id} style={{ width: 76, textAlign: "center", fontSize: 12 }}>
                  <div style={{ width: 56, height: 56, margin: "0 auto", borderRadius: 18, overflow: "hidden", background: "#F1F4F8", display: "grid", placeItems: "center", fontSize: 24, outline: c.featured_id ? "2px solid #D6BA80" : "none" }}>
                    {c.image_url ? <img src={c.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : c.icon_emoji || c.name[0]}
                  </div>
                  <div style={{ marginTop: 4, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{c.featured_id ? "Featured" : "Filled in"}</div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
              Gold ring = chosen here. &quot;Filled in&quot; = added by itself from the categories with the most products: up to {data?.min ?? 4} when fewer are chosen, or {data?.max ?? 8} when none are.
              {liveCount > (data?.max ?? 8) ? ` ${liveCount} are live: only the top ${data?.max ?? 8} by order show.` : ""}
            </p>
          </div>

          {/* Featured list, in display order */}
          {rows.length === 0 ? (
            <div className="admin-card" style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>Nothing chosen yet. Home shows the categories with the most products.</div>
          ) : (
            <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
              {rows.map((r, i) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <button className="btn-outline" style={{ padding: "0 8px", fontSize: 12 }} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">▲</button>
                    <button className="btn-outline" style={{ padding: "0 8px", fontSize: 12 }} disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">▼</button>
                  </div>
                  <span style={{ width: 26, textAlign: "center", fontWeight: 800, color: "var(--text-muted)" }}>{i + 1}</span>
                  <div style={{ width: 44, height: 44, borderRadius: 14, overflow: "hidden", background: "#F1F4F8", display: "grid", placeItems: "center", fontSize: 20, flexShrink: 0 }}>
                    {r.category?.image_url ? <img src={r.category.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : r.category?.icon_emoji || "?"}
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <b>{r.category?.name ?? `Category #${r.category_id}`}</b>
                      <span style={pill("#FBF4E4", "#71541A")}>{KINDS.find(k => k.key === r.kind)?.label}</span>
                      <span style={pill(r.is_live ? "#E7F8EF" : "#F1F4F8", r.is_live ? "#067647" : "#5B6472")}>
                        {r.is_live ? "On Home now" : !r.is_active ? "Off" : r.next_start ? `Next: ${day(r.next_start)}` : "Ended"}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                      {r.kind === "scheduled" && r.schedule_type === "once"
                        ? `${r.starts_at ? day(r.starts_at) : "Now"} → ${r.ends_at ? day(r.ends_at) : "no end date"}`
                        : r.schedule_text}
                      {r.category?.product_count != null ? ` · ${r.category.product_count} ${r.category.product_count === 1 ? "product" : "products"}` : ""}
                    </div>
                  </div>
                  <button className="btn-outline" onClick={() => openEdit(r)}>Edit</button>
                  <button className="btn-outline" style={{ color: "#EF4444" }} onClick={() => remove(r)}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Coming later: fill Home from <b>Trending</b> (most viewed this week) and <b>Best-selling</b> (most ordered in 30 days) categories instead of most products.
          </p>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal-content" style={{ maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>{editId ? "Edit Home category" : "Add a category to Home"}</h2>
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={lbl}>Category *</label>
                <select className="admin-input" value={form.category_id} onChange={e => set("category_id", +e.target.value)}>
                  <option value={0}>Choose a category…</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.merchant_name ? ` · ${c.merchant_name}` : !c.merchant_id ? " (global)" : ""}{c.product_count != null ? ` · ${c.product_count} ${c.product_count === 1 ? "product" : "products"}` : ""}</option>)}
                </select>
                {chosenTaken && <small style={{ ...hint, color: "#B54708" }}>This category is already on the list. Edit that one instead, or it will only show once.</small>}
              </div>

              <div>
                <label style={lbl}>When it shows</label>
                <div role="radiogroup" aria-label="Kind" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                  {KINDS.map(k => {
                    const on = form.kind === k.key;
                    return (
                      <button key={k.key} type="button" role="radio" aria-checked={on} onClick={() => set("kind", k.key)}
                        style={{ textAlign: "left", padding: 10, borderRadius: 12, cursor: "pointer", border: on ? "2px solid #103562" : "1px solid var(--border)", background: on ? "rgba(16,53,98,.06)" : "transparent" }}>
                        <b style={{ fontSize: 13, display: "block" }}>{k.label}</b><small style={hint}>{k.hint}</small>
                      </button>
                    );
                  })}
                </div>
              </div>

              {form.kind === "seasonal" && (
                <div><label style={lbl}>Dates every year *</label><YearlyRangesPicker value={form.yearly_ranges} onChange={v => set("yearly_ranges", v)} /></div>
              )}

              {form.kind === "scheduled" && (
                <>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(["once", "weekly", "monthly"] as ScheduleType[]).map(t => (
                      <button key={t} type="button" onClick={() => set("schedule_type", t)} className="btn-outline"
                        style={{ padding: "6px 12px", fontSize: 13, fontWeight: form.schedule_type === t ? 700 : 500, borderColor: form.schedule_type === t ? "#103562" : undefined }}>
                        {t === "once" ? "Between two dates" : t === "weekly" ? "On days of the week" : "On days of the month"}
                      </button>
                    ))}
                  </div>
                  {form.schedule_type === "weekly" && <div><label style={lbl}>Days of the week *</label><WeekdayPicker value={form.weekdays} onChange={v => set("weekdays", v)} /></div>}
                  {form.schedule_type === "monthly" && <div><label style={lbl}>Days of the month *</label><MonthDaysPicker value={form.month_days} onChange={v => set("month_days", v)} /></div>}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div><label style={lbl}>{form.schedule_type === "once" ? "Start" : "From (optional)"}</label><input className="admin-input" type="datetime-local" value={form.starts_at} onChange={e => set("starts_at", e.target.value)} /></div>
                    <div><label style={lbl}>{form.schedule_type === "once" ? "End" : "Until (optional)"}</label><input className="admin-input" type="datetime-local" value={form.ends_at} onChange={e => set("ends_at", e.target.value)} /></div>
                  </div>
                </>
              )}

              <div style={{ borderRadius: 10, padding: "10px 12px", background: "rgba(16,53,98,.05)", fontSize: 13, fontWeight: 600 }}>
                {form.kind === "permanent" ? "Always on Home, in the order you set"
                  : form.kind === "seasonal" ? scheduleText({ ...form, schedule_type: "yearly" })
                  : scheduleText(form)} · shows and hides by itself, in Cambodia time
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={form.is_active} onChange={e => set("is_active", e.target.checked)} />On (untick to pause without deleting)
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button className="btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : editId ? "Save" : "Add to Home"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const pill = (bg: string, fg: string): React.CSSProperties => ({ background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 });
const hint: React.CSSProperties = { display: "block", fontSize: 11, color: "var(--text-muted)", marginTop: 4 };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 };
