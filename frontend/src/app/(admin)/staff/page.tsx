"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ShopAccount } from "@/types";
import { BrandLoader } from "@/components/ui/Spinner";

const EMPTY = { full_name: "", email: "", password: "", telegram_id: "" };

type Editing = { account: ShopAccount; full_name: string; email: string; telegram_id: string; new_password: string };

/** The shop owner's team: each person gets their own login, so every change in the Activity Log has a name. */
export default function StaffPage() {
  const [people, setPeople] = useState<ShopAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<ShopAccount | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });

  const flash = (msg: string, ok = true) => { setToast({ show: true, msg, ok }); setTimeout(() => setToast(t => ({ ...t, show: false })), 3500); };
  const load = useCallback(async () => {
    try { setPeople((await api.get<{ data: ShopAccount[] }>("/merchant-staff")).data); }
    catch (e: any) { flash(e?.detail || "Could not load your staff", false); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.full_name.trim()) { flash("Enter their name", false); return; }
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) { flash("Enter a valid email", false); return; }
    if (form.password.length < 8) { flash("The password needs at least 8 characters", false); return; }
    setSaving(true);
    try {
      await api.post("/merchant-staff", {
        full_name: form.full_name.trim(), email: form.email.trim(), password: form.password,
        telegram_id: form.telegram_id.trim() ? Number(form.telegram_id.trim()) : null,
      });
      flash(`${form.full_name.trim()} can now sign in`);
      setAdding(false); setForm({ ...EMPTY }); load();
    } catch (e: any) { flash(e?.detail || "Could not add this person", false); }
    setSaving(false);
  }

  async function saveEdit() {
    if (!editing) return;
    const a = editing.account;
    const body: Record<string, unknown> = {};
    if (editing.full_name.trim() && editing.full_name.trim() !== a.full_name) body.full_name = editing.full_name.trim();
    if (editing.email.trim() && editing.email.trim().toLowerCase() !== a.email) body.email = editing.email.trim();
    const tg = editing.telegram_id.trim();
    if (!tg && a.telegram_id) body.clear_telegram_id = true;
    else if (tg && Number(tg) !== a.telegram_id) body.telegram_id = Number(tg);
    if (editing.new_password) {
      if (editing.new_password.length < 8) { flash("The new password needs at least 8 characters", false); return; }
      body.new_password = editing.new_password;
    }
    if (Object.keys(body).length === 0) { setEditing(null); return; }
    setSaving(true);
    try { await api.patch(`/merchant-staff/${a.id}`, body); flash("Saved"); setEditing(null); load(); }
    catch (e: any) { flash(e?.detail || "Could not save", false); }
    setSaving(false);
  }

  async function setActive(a: ShopAccount, is_active: boolean) {
    try {
      await api.patch(`/merchant-staff/${a.id}`, { is_active });
      flash(is_active ? `${a.full_name} can sign in again` : `${a.full_name} is signed out and cannot sign in`);
      load();
    } catch (e: any) { flash(e?.detail || "Could not update", false); }
  }

  async function remove() {
    if (!removing) return;
    setSaving(true);
    try { await api.delete(`/merchant-staff/${removing.id}`); flash(`${removing.full_name} was removed`); setRemoving(null); load(); }
    catch (e: any) { flash(e?.detail || "Could not remove", false); }
    setSaving(false);
  }

  const staffCount = people.filter(p => p.role === "staff").length;

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Staff</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 620 }}>
            Give each person their own login instead of sharing yours. Staff manage products, orders, drivers and promotions.
            Only you manage staff, payouts, earnings and shop settings. Every change shows up in the <a href="/activity" style={{ color: "var(--info)" }}>Activity Log</a> with their name.
          </p>
        </div>
        <button className="btn-primary" data-testid="add-staff" onClick={() => { setForm({ ...EMPTY }); setAdding(true); }}>+ Add staff</button>
      </div>

      <div className="admin-card" style={{ padding: 0, overflowX: "auto" }}>
        {loading ? <BrandLoader /> : (
          <table className="admin-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Telegram</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {people.map(p => (
                <tr key={p.id} data-testid={`account-${p.id}`}>
                  <td style={{ fontWeight: 600 }}>{p.full_name}{p.is_you && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> (you)</span>}</td>
                  <td style={{ fontSize: 12 }}>{p.email}</td>
                  <td>{p.role === "owner" ? <span className="badge badge-confirmed">Owner</span> : <span className="badge badge-processing">Staff</span>}</td>
                  <td style={{ fontSize: 12 }}>{p.telegram_id ? "Linked" : "—"}</td>
                  <td style={{ fontSize: 12 }}>{p.last_login ? new Date(p.last_login).toLocaleString() : "Never"}</td>
                  <td>{p.is_active ? <span className="badge badge-delivered">Active</span> : <span className="badge badge-cancelled">Deactivated</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {p.role === "staff" && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn-outline" onClick={() => setEditing({ account: p, full_name: p.full_name, email: p.email, telegram_id: p.telegram_id ? String(p.telegram_id) : "", new_password: "" })}>Edit</button>
                        {p.is_active
                          ? <button className="btn-outline" onClick={() => setActive(p, false)}>Deactivate</button>
                          : <button className="btn-primary" onClick={() => setActive(p, true)}>Reactivate</button>}
                        <button className="btn-outline" style={{ color: "var(--danger, #EF4444)" }} onClick={() => setRemoving(p)}>Remove</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && staffCount === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>No staff yet. Add the people who help you run the shop.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {adding && (
        <div className="modal-overlay" onClick={() => setAdding(false)}>
          <div className="modal-content" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Add a staff member</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              They sign in to this dashboard with this email and password. Tell them the password yourself; they can change it under Settings.
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              <label>Full name<input className="admin-input" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></label>
              <label>Email<input className="admin-input" type="email" autoComplete="off" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
              <label>Temporary password<input className="admin-input" type="password" autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" /></label>
              <label>Telegram ID (optional)<input className="admin-input" inputMode="numeric" value={form.telegram_id} onChange={e => setForm({ ...form, telegram_id: e.target.value.replace(/\D/g, "") })} placeholder="Lets them sign in with the bot" /></label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn-outline" style={{ flex: 1 }} onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={add} disabled={saving}>{saving ? "Adding…" : "Add staff"}</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal-content" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Edit {editing.account.full_name}</h2>
            <div style={{ display: "grid", gap: 10 }}>
              <label>Full name<input className="admin-input" value={editing.full_name} onChange={e => setEditing({ ...editing, full_name: e.target.value })} /></label>
              <label>Email<input className="admin-input" type="email" value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} /></label>
              <label>Telegram ID<input className="admin-input" inputMode="numeric" value={editing.telegram_id} onChange={e => setEditing({ ...editing, telegram_id: e.target.value.replace(/\D/g, "") })} placeholder="Empty = not linked" /></label>
              <label>New password (optional)<input className="admin-input" type="password" autoComplete="new-password" value={editing.new_password} onChange={e => setEditing({ ...editing, new_password: e.target.value })} placeholder="Leave empty to keep it" /></label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn-outline" style={{ flex: 1 }} onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={saveEdit} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {removing && (
        <div className="modal-overlay" onClick={() => setRemoving(null)}>
          <div className="modal-content" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Remove {removing.full_name}?</h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
              Their login is deleted and they are signed out. What they changed stays in the Activity Log under their name.
              To pause someone instead, use Deactivate.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-outline" style={{ flex: 1 }} onClick={() => setRemoving(null)}>Cancel</button>
              <button className="btn-primary" style={{ flex: 1, background: "#EF4444", borderColor: "#EF4444" }} onClick={remove} disabled={saving}>{saving ? "Removing…" : "Remove"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
