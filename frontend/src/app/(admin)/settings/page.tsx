"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import type { AdminUser } from "@/types";

export default function SettingsPage() {
  const { user } = useAuth();
  const admin = user as AdminUser;

  const [profileForm, setProfileForm] = useState({ name: admin?.name || "", email: admin?.email || "" });
  const [passwordForm, setPasswordForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });
  // Does this shop take part in the rewards program? (shops only)
  const [rewards, setRewards] = useState<boolean | null>(null);
  const [savingRewards, setSavingRewards] = useState(false);
  useEffect(() => {
    // Owners only: staff cannot change the shop's rewards participation
    if (admin?.role !== "merchant" || admin?.merchant_role === "staff") return;
    api.get<{ enabled: boolean }>("/loyalty/shop").then((r) => setRewards(r.enabled)).catch(() => setRewards(null));
  }, [admin?.role]);

  async function toggleRewards(on: boolean) {
    setSavingRewards(true);
    try { const r = await api.put<{ enabled: boolean }>("/loyalty/shop", { enabled: on }); setRewards(r.enabled); flash(on ? "Rewards are on for your shop" : "Rewards are off for your shop"); }
    catch (e: any) { flash(e.detail || "Could not change this", false); }
    setSavingRewards(false);
  }

  const flash = (msg: string, ok = true) => { setToast({ show: true, msg, ok }); setTimeout(() => setToast(t => ({ ...t, show: false })), 3000); };

  async function saveProfile() {
    if (!profileForm.name.trim() || !profileForm.email.trim()) { flash("Name and email required", false); return; }
    setSavingProfile(true);
    try { await api.post("/auth/update-profile", profileForm); flash("Profile updated!"); }
    catch (e: any) { flash(e.detail || "Error", false); }
    setSavingProfile(false);
  }

  async function changePassword() {
    if (!passwordForm.current_password || !passwordForm.new_password) { flash("Both passwords required", false); return; }
    if (passwordForm.new_password.length < 8) { flash("New password must be 8+ characters", false); return; }
    if (passwordForm.new_password !== passwordForm.confirm) { flash("Passwords don't match", false); return; }
    setSavingPassword(true);
    try { await api.post("/auth/change-password", { current_password: passwordForm.current_password, new_password: passwordForm.new_password }); flash("Password changed!"); setPasswordForm({ current_password: "", new_password: "", confirm: "" }); }
    catch (e: any) { flash(e.detail || "Error", false); }
    setSavingPassword(false);
  }

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>Settings</h1>

      {/* Profile */}
      <div className="admin-card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Profile</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div><label style={lbl}>Name</label><input className="admin-input" value={profileForm.name} onChange={e => setProfileForm({ ...profileForm, name: e.target.value })} /></div>
          <div><label style={lbl}>Email</label><input type="email" className="admin-input" value={profileForm.email} onChange={e => setProfileForm({ ...profileForm, email: e.target.value })} /></div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn-primary" onClick={saveProfile} disabled={savingProfile}>{savingProfile ? "Saving..." : "Update Profile"}</button>
          </div>
        </div>
      </div>

      {/* Customer rewards: a shop can choose not to take part */}
      {rewards !== null && (
        <div className="admin-card" style={{ marginBottom: 20 }} data-testid="shop-rewards">
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Customer rewards</h3>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
            Customers earn points when an order from your shop is delivered, and spend them on any shop. The platform pays for the points, not you. Turn this off and your orders earn no points. Points already earned are kept.
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text)" }}>
            <input type="checkbox" checked={rewards} disabled={savingRewards} onChange={e => toggleRewards(e.target.checked)} />
            Customers earn points on my orders
          </label>
        </div>
      )}

      {/* Password */}
      <div className="admin-card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Change Password</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div><label style={lbl}>Current Password</label><input type="password" className="admin-input" value={passwordForm.current_password} onChange={e => setPasswordForm({ ...passwordForm, current_password: e.target.value })} /></div>
          <div><label style={lbl}>New Password (min 8 chars)</label><input type="password" className="admin-input" value={passwordForm.new_password} onChange={e => setPasswordForm({ ...passwordForm, new_password: e.target.value })} /></div>
          <div><label style={lbl}>Confirm New Password</label><input type="password" className="admin-input" value={passwordForm.confirm} onChange={e => setPasswordForm({ ...passwordForm, confirm: e.target.value })} /></div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn-primary" onClick={changePassword} disabled={savingPassword}>{savingPassword ? "Changing..." : "Change Password"}</button>
          </div>
        </div>
      </div>

      {/* Account Info */}
      <div className="admin-card">
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Account Info</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
          <div><span style={{ color: "var(--text-muted)" }}>Role: </span><span style={{ fontWeight: 600, color: "var(--text)", textTransform: "capitalize" }}>{admin?.role === "super_admin" ? "Super Admin" : "Merchant Admin"}</span></div>
          {admin?.merchant_name && <div><span style={{ color: "var(--text-muted)" }}>Merchant: </span><span style={{ color: "var(--text)" }}>{admin.merchant_name}</span></div>}
          <div><span style={{ color: "var(--text-muted)" }}>Email: </span><span style={{ color: "var(--text)" }}>{admin?.email}</span></div>
        </div>
      </div>
    </div>
  );
}
const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 };
