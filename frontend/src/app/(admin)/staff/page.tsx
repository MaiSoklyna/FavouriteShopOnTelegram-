"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ShopAccount, ShopRole } from "@/types";
import { BrandLoader } from "@/components/ui/Spinner";
import { ROLE_LABEL, usePermissions } from "@/lib/permissions";

type TeamRole = Exclude<ShopRole, "owner">;

const EMPTY = { full_name: "", email: "", password: "", telegram_id: "", role: "staff" as TeamRole };

type Editing = {
  account: ShopAccount; full_name: string; email: string; telegram_id: string; new_password: string; role: TeamRole;
};

const ROLE_HINT: Record<TeamRole, string> = {
  manager: "Runs the shop day to day: prices, cancellations, promotions, drivers, sales and the activity log.",
  staff: "Daily work only: adds and edits products and processes orders.",
};

/** A readable temporary password, e.g. "Mango-Lotus-4827" (about 40 bits; they should change it). */
function makePassword(): string {
  const words = ["Mango", "Lotus", "River", "Jasmine", "Tiger", "Coconut", "Lemon", "Orchid", "Pepper", "Sunrise", "Bamboo", "Coral"];
  const n = crypto.getRandomValues(new Uint32Array(3));
  return `${words[n[0] % words.length]}-${words[n[1] % words.length]}-${1000 + (n[2] % 9000)}`;
}

function RoleBadge({ role }: { role: ShopRole }) {
  const cls = role === "owner" ? "badge-confirmed" : role === "manager" ? "badge-shipped" : "badge-processing";
  return <span className={`badge ${cls}`}>{ROLE_LABEL[role]}</span>;
}

/** The shop owner's team: each person gets their own login and a role, so every change in the Activity Log has a name. */
export default function StaffPage() {
  const { matrix } = usePermissions();
  const [people, setPeople] = useState<ShopAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [invited, setInvited] = useState<{ name: string; email: string; password: string } | null>(null);
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
        full_name: form.full_name.trim(), email: form.email.trim(), password: form.password, role: form.role,
        telegram_id: form.telegram_id.trim() ? Number(form.telegram_id.trim()) : null,
      });
      setInvited({ name: form.full_name.trim(), email: form.email.trim().toLowerCase(), password: form.password });
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
    if (editing.role !== a.role) body.role = editing.role;
    const tg = editing.telegram_id.trim();
    if (!tg && a.telegram_id) body.clear_telegram_id = true;
    else if (tg && Number(tg) !== a.telegram_id) body.telegram_id = Number(tg);
    if (editing.new_password) {
      if (editing.new_password.length < 8) { flash("The new password needs at least 8 characters", false); return; }
      body.new_password = editing.new_password;
    }
    if (Object.keys(body).length === 0) { setEditing(null); return; }
    setSaving(true);
    try {
      await api.patch(`/merchant-staff/${a.id}`, body);
      flash(body.role ? `${a.full_name} is now ${ROLE_LABEL[editing.role]}. They sign in again to use it.` : "Saved");
      setEditing(null); load();
    } catch (e: any) { flash(e?.detail || "Could not save", false); }
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

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); flash("Copied"); } catch { flash("Copy it by hand", false); }
  }

  const teamCount = people.filter(p => p.role !== "owner").length;

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Staff</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 640 }}>
            Give each person their own login and a role instead of sharing yours. Only you manage staff, payouts, earnings and
            shop settings. Every change shows up in the <Link href="/activity" style={{ color: "var(--info)" }}>Activity Log</Link> with their name.
          </p>
        </div>
        <button className="btn-primary" data-testid="add-staff" onClick={() => { setForm({ ...EMPTY, password: makePassword() }); setAdding(true); }}>+ Invite staff</button>
      </div>

      {invited && (
        <div className="admin-card" data-testid="invite-details" style={{ marginBottom: 16, borderLeft: "4px solid var(--success, #10B981)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{invited.name} can now sign in</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Send them these sign-in details. The password is shown only now; they can change it under Settings.
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 13, marginTop: 8, wordBreak: "break-all" }}>
                Email: {invited.email}<br />Password: {invited.password}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <button className="btn-outline" onClick={() => copy(`Sign in at ${window.location.origin}/login\nEmail: ${invited.email}\nPassword: ${invited.password}`)}>Copy</button>
              <button className="btn-outline" onClick={() => setInvited(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      <div className="admin-card" style={{ padding: 0, overflowX: "auto" }}>
        {loading ? <BrandLoader /> : (
          <table className="admin-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Telegram</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {people.map(p => (
                <tr key={p.id} data-testid={`account-${p.id}`}>
                  <td style={{ fontWeight: 600 }}>{p.full_name}{p.is_you && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> (you)</span>}</td>
                  <td style={{ fontSize: 12 }}>{p.email}</td>
                  <td><RoleBadge role={p.role} /></td>
                  <td style={{ fontSize: 12 }}>{p.telegram_id ? "Linked" : "—"}</td>
                  <td style={{ fontSize: 12 }}>{p.last_login ? new Date(p.last_login).toLocaleString() : "Never"}</td>
                  <td>{p.is_active ? <span className="badge badge-delivered">Active</span> : <span className="badge badge-cancelled">Deactivated</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Link className="btn-outline" href={`/activity?actor_id=${p.id}`} data-testid={`history-${p.id}`}>History</Link>
                      {p.role !== "owner" && (
                        <>
                          <button className="btn-outline" onClick={() => setEditing({
                            account: p, full_name: p.full_name, email: p.email, role: p.role as TeamRole,
                            telegram_id: p.telegram_id ? String(p.telegram_id) : "", new_password: "",
                          })}>Edit</button>
                          {p.is_active
                            ? <button className="btn-outline" onClick={() => setActive(p, false)}>Deactivate</button>
                            : <button className="btn-primary" onClick={() => setActive(p, true)}>Reactivate</button>}
                          <button className="btn-outline" style={{ color: "var(--danger, #EF4444)" }} onClick={() => setRemoving(p)}>Remove</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && teamCount === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>No staff yet. Invite the people who help you run the shop.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {matrix && (
        <div className="admin-card" style={{ marginTop: 20, padding: 0, overflowX: "auto" }} data-testid="permission-matrix">
          <div style={{ padding: "16px 16px 4px" }}>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>What each role can do</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>The server enforces this on every request, not just in this dashboard.</p>
          </div>
          <table className="admin-table">
            <thead><tr><th>Permission</th>{matrix.roles.map(r => <th key={r.key} style={{ textAlign: "center" }}>{r.label}</th>)}</tr></thead>
            <tbody>
              {matrix.permissions.map(p => (
                <tr key={p.key}>
                  <td style={{ fontSize: 13 }}>{p.label}</td>
                  {matrix.roles.map(r => (
                    <td key={r.key} style={{ textAlign: "center", fontSize: 15 }} aria-label={p.roles.includes(r.key) ? "allowed" : "not allowed"}>
                      {p.roles.includes(r.key) ? <span style={{ color: "var(--success, #10B981)" }}>✓</span> : <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <div className="modal-overlay" onClick={() => setAdding(false)}>
          <div className="modal-content" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Invite someone</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              They sign in to this dashboard with this email and the temporary password. You will see the details to send them.
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              <label>Full name<input className="admin-input" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></label>
              <label>Email<input className="admin-input" type="email" autoComplete="off" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
              <label>Role
                <select className="admin-input" data-testid="invite-role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as TeamRole })}>
                  <option value="staff">Staff</option>
                  <option value="manager">Manager</option>
                </select>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{ROLE_HINT[form.role]}</span>
              </label>
              <label>Temporary password
                <div style={{ display: "flex", gap: 6 }}>
                  <input className="admin-input" style={{ flex: 1, fontFamily: "monospace" }} autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" />
                  <button type="button" className="btn-outline" onClick={() => setForm({ ...form, password: makePassword() })}>New</button>
                </div>
              </label>
              <label>Telegram ID (optional)<input className="admin-input" inputMode="numeric" value={form.telegram_id} onChange={e => setForm({ ...form, telegram_id: e.target.value.replace(/\D/g, "") })} placeholder="Lets them sign in with the bot" /></label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn-outline" style={{ flex: 1 }} onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={add} disabled={saving}>{saving ? "Inviting…" : "Invite"}</button>
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
              <label>Role
                <select className="admin-input" data-testid="edit-role" value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value as TeamRole })}>
                  <option value="staff">Staff</option>
                  <option value="manager">Manager</option>
                </select>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{ROLE_HINT[editing.role]}</span>
              </label>
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
