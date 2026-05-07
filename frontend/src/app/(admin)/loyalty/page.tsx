"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { LoyaltySettings } from "@/types";

interface LoyaltyStats { totalMembers: number; tiers: Record<string, number>; totalEarned: number; totalRedeemed: number; }

export default function LoyaltyPage() {
  const [settings, setSettings] = useState<LoyaltySettings | null>(null);
  const [stats, setStats] = useState<LoyaltyStats | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<LoyaltySettings>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });

  const flash = (msg: string, ok = true) => { setToast({ show: true, msg, ok }); setTimeout(() => setToast(t => ({ ...t, show: false })), 3000); };

  async function load() {
    try {
      const [s, st, a] = await Promise.all([api.get<LoyaltySettings>("/loyalty/admin/settings"), api.get<LoyaltyStats>("/loyalty/admin/stats"), api.get<any[]>("/loyalty/admin/accounts")]);
      setSettings(s); setStats(st); setAccounts(a || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function saveSettings() {
    setSaving(true);
    try { await api.put("/loyalty/admin/settings", form); flash("Settings saved!"); setEditing(false); load(); }
    catch (e: any) { flash(e.detail || "Error", false); }
    setSaving(false);
  }

  function startEdit() { setForm(settings || {}); setEditing(true); }

  if (loading) return <div><h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20, color: "var(--text)" }}>Loyalty</h1>{[1, 2].map(i => <div key={i} style={{ height: 80, background: "var(--bg-secondary)", borderRadius: 12, marginBottom: 12, animation: "pulse 1.5s infinite" }} />)}<style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style></div>;

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>Loyalty Program</h1>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
        <Stat label="Members" value={stats?.totalMembers || 0} color="var(--info)" />
        <Stat label="Earned" value={stats?.totalEarned?.toLocaleString() || 0} color="var(--success)" />
        <Stat label="Redeemed" value={stats?.totalRedeemed?.toLocaleString() || 0} color="var(--danger)" />
        <Stat label="Bronze" value={stats?.tiers?.bronze || 0} color="#CD7F32" />
        <Stat label="Silver" value={stats?.tiers?.silver || 0} color="#C0C0C0" />
        <Stat label="Gold" value={stats?.tiers?.gold || 0} color="#FFD700" />
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {["overview", "accounts", "settings"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 500, textTransform: "capitalize", background: tab === t ? "var(--accent)" : "var(--bg-secondary)", color: tab === t ? "var(--bg)" : "var(--text-secondary)", border: "none", cursor: "pointer" }}>{t}</button>
        ))}
      </div>

      {tab === "overview" && settings && (
        <div className="admin-card">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Current Settings</h3>
            <span className={`badge ${settings.is_enabled ? "badge-delivered" : "badge-cancelled"}`}>{settings.is_enabled ? "Enabled" : "Disabled"}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 13 }}>
            <div><span style={{ color: "var(--text-muted)" }}>Points/Dollar:</span> <strong>{settings.points_per_dollar}</strong></div>
            <div><span style={{ color: "var(--text-muted)" }}>Point Value:</span> <strong>{settings.points_value_cents}c</strong></div>
            <div><span style={{ color: "var(--text-muted)" }}>Min Redeem:</span> <strong>{settings.min_redeem_points}</strong></div>
            <div><span style={{ color: "var(--text-muted)" }}>Silver at:</span> <strong>{settings.silver_threshold}</strong></div>
            <div><span style={{ color: "var(--text-muted)" }}>Gold at:</span> <strong>{settings.gold_threshold}</strong></div>
            <div><span style={{ color: "var(--text-muted)" }}>Gold Multi:</span> <strong>{settings.gold_multiplier}x</strong></div>
          </div>
        </div>
      )}

      {tab === "accounts" && (
        <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="admin-table">
            <thead><tr><th>User</th><th>Balance</th><th>Lifetime</th><th>Tier</th></tr></thead>
            <tbody>
              {accounts.length === 0 ? <tr><td colSpan={4} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No accounts</td></tr> :
              accounts.map((a: any) => (
                <tr key={a.id}>
                  <td>{a.users?.first_name || a.users?.username || `#${a.user_id}`}</td>
                  <td style={{ fontWeight: 600 }}>{a.balance}</td>
                  <td>{a.lifetime_points}</td>
                  <td><span style={{ fontSize: 12, textTransform: "capitalize" }}>{a.tier === "gold" ? "🥇" : a.tier === "silver" ? "🥈" : "🥉"} {a.tier}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "settings" && (
        <div className="admin-card">
          {!editing ? (
            <button className="btn-primary" onClick={startEdit}>Edit Settings</button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}><input type="checkbox" checked={form.is_enabled || false} onChange={e => setForm({ ...form, is_enabled: e.target.checked })} /> Enabled</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {[["points_per_dollar", "Points/$"], ["points_value_cents", "Point Value (c)"], ["min_redeem_points", "Min Redeem"], ["bronze_threshold", "Bronze At"], ["silver_threshold", "Silver At"], ["gold_threshold", "Gold At"], ["silver_multiplier", "Silver Multi"], ["gold_multiplier", "Gold Multi"]].map(([key, label]) => (
                  <div key={key}><label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{label}</label><input type="number" step="0.1" className="admin-input" value={(form as any)[key] || ""} onChange={e => setForm({ ...form, [key]: +e.target.value })} /></div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-outline" onClick={() => setEditing(false)}>Cancel</button>
                <button className="btn-primary" onClick={saveSettings} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return <div className="admin-card"><p style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</p><p style={{ fontSize: 22, fontWeight: 700, color }}>{value}</p></div>;
}
