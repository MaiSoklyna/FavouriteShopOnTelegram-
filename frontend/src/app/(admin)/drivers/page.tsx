"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { AdminDriver, Merchant } from "@/types";
import { BrandLoader } from "@/components/ui/Spinner";

const EMPTY = { telegram_id: "", full_name: "", phone: "", vehicle: "", merchant_id: "" };

/** The people who deliver. A shop manages its own riders; the platform manages everyone. */
export default function DriversPage() {
  const { isSuperAdmin } = useAuth();
  const [drivers, setDrivers] = useState<AdminDriver[]>([]);
  const [shops, setShops] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });

  const flash = (msg: string, ok = true) => { setToast({ show: true, msg, ok }); setTimeout(() => setToast(t => ({ ...t, show: false })), 3500); };
  const load = useCallback(async () => {
    try { setDrivers((await api.get<{ data: AdminDriver[] }>("/deliveries/admin/drivers")).data); }
    catch { /* offline */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, { interval: 20000 });
  useEffect(() => {
    if (isSuperAdmin) api.get<Merchant[]>("/merchants").then(setShops).catch(() => {});
  }, [isSuperAdmin]);

  async function create() {
    if (!/^\d{5,}$/.test(form.telegram_id.trim())) { flash("Telegram ID must be a number", false); return; }
    if (!form.full_name.trim() || form.phone.trim().length < 6) { flash("Name and a phone number are required", false); return; }
    setSaving(true);
    try {
      await api.post("/deliveries/admin/drivers", {
        telegram_id: Number(form.telegram_id.trim()), full_name: form.full_name.trim(), phone: form.phone.trim(),
        vehicle: form.vehicle.trim() || null,
        ...(isSuperAdmin && form.merchant_id ? { merchant_id: Number(form.merchant_id) } : {}),
      });
      flash("Driver added"); setModal(false); setForm({ ...EMPTY }); load();
    } catch (e: any) { flash(e?.detail || e?.message || "Could not add the driver", false); }
    setSaving(false);
  }

  async function setActive(d: AdminDriver, is_active: boolean) {
    try { await api.patch(`/deliveries/admin/drivers/${d.id}`, { is_active }); load(); }
    catch (e: any) { flash(e?.detail || "Could not update", false); }
  }

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Drivers</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {isSuperAdmin ? "Platform drivers work for every shop; shop riders only for their shop." : "Your riders. You can also use the platform's drivers when you assign an order."}
          </p>
        </div>
        <button className="btn-primary" onClick={() => { setForm({ ...EMPTY }); setModal(true); }}>+ Add driver</button>
      </div>

      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? <BrandLoader /> : (
          <table className="admin-table">
            <thead><tr><th>Driver</th><th>Phone</th><th>Vehicle</th><th>Works for</th><th>Now</th><th>Active jobs</th><th>Account</th></tr></thead>
            <tbody>
              {drivers.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No drivers yet. Add someone who has opened the Telegram bot.</td></tr>
              ) : drivers.map(d => (
                <tr key={d.id} data-testid={`driver-${d.id}`}>
                  <td style={{ fontWeight: 600 }}>{d.full_name}</td>
                  <td style={{ fontSize: 12 }}>{d.phone}</td>
                  <td style={{ fontSize: 12 }}>{d.vehicle || "—"}</td>
                  <td style={{ fontSize: 12 }}>{d.merchant_id ? d.shop_name || `Shop #${d.merchant_id}` : "Platform"}</td>
                  <td>{!d.is_active ? <span className="badge badge-cancelled">Off</span> : d.is_available ? <span className="badge badge-delivered">On shift</span> : <span className="badge badge-pending">Off shift</span>}</td>
                  <td>{d.active_jobs}</td>
                  <td>
                    {d.is_active
                      ? <button className="btn-outline" onClick={() => setActive(d, false)}>Switch off</button>
                      : <button className="btn-primary" onClick={() => setActive(d, true)}>Switch on</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal-content" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Add a driver</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>They sign in with Telegram, so they must have opened the bot once.</p>
            <div style={{ display: "grid", gap: 10 }}>
              <label>Telegram ID<input className="admin-input" inputMode="numeric" value={form.telegram_id} onChange={e => setForm({ ...form, telegram_id: e.target.value.replace(/\D/g, "") })} placeholder="e.g. 5847427348" /></label>
              <label>Full name<input className="admin-input" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></label>
              <label>Phone<input className="admin-input" inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="012 345 678" /></label>
              <label>Vehicle (optional)<input className="admin-input" value={form.vehicle} onChange={e => setForm({ ...form, vehicle: e.target.value })} placeholder="Honda Dream, plate…" /></label>
              {isSuperAdmin && (
                <label>Works for
                  <select className="admin-input" value={form.merchant_id} onChange={e => setForm({ ...form, merchant_id: e.target.value })}>
                    <option value="">Platform (any shop)</option>
                    {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn-outline" style={{ flex: 1 }} onClick={() => setModal(false)}>Cancel</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={create} disabled={saving}>{saving ? "Adding…" : "Add driver"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
