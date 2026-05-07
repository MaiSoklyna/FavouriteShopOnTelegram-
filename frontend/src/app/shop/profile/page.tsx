"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { LoginGate } from "@/components/shop/LoginGate";
import { api } from "@/lib/api";

const MENU = [
  {
    label: "My Orders", href: "/shop/orders",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--shop-primary, #1E6BFF)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
      </svg>
    ),
  },
  {
    label: "Notifications", href: "/shop/notifications",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--shop-primary, #1E6BFF)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
    ),
  },
  {
    label: "Rewards & Points", href: "/shop/rewards",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--shop-primary, #1E6BFF)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    ),
  },
  {
    label: "Support", href: "/shop/support",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--shop-primary, #1E6BFF)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    ),
  },
];

export default function ProfilePage() {
  const router = useRouter();
  const { user, isShopUser, logout } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user && "name" in user) {
      const u = user as any;
      setForm({ name: u.name || u.username || "", phone: u.phone || "" });
    }
  }, [user]);

  async function handleSave() {
    setSaving(true);
    try {
      await api.patch("/users/me", { first_name: form.name, phone_number: form.phone });
      setEditing(false);
    } catch (e: any) { alert(e.detail || "Failed to update"); }
    finally { setSaving(false); }
  }

  if (!user) {
    return <LoginGate><div /></LoginGate>;
  }

  const displayName = ("name" in user ? (user as any).name : (user as any).username) || "User";
  const initial = displayName[0]?.toUpperCase() || "?";

  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg, #F7F8FB)", paddingBottom: 80 }}>
      {/* Top bar */}
      <div style={{
        height: 56, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px", background: "var(--shop-surface, #FFFFFF)",
        borderBottom: "1px solid var(--shop-divider, #ECEEF3)",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--shop-black, #0B0B0F)" }}>Profile</span>
        <button style={{
          width: 36, height: 36, borderRadius: 10, border: "none",
          background: "var(--shop-bg, #F7F8FB)", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--shop-text, #4A4E5A)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>

      {/* Profile header */}
      <div style={{ textAlign: "center", padding: "28px 16px 20px" }}>
        <div style={{
          width: 80, height: 80, borderRadius: "50%",
          background: "linear-gradient(135deg, #7C3AED, #A855F7)",
          color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 32, fontWeight: 700, margin: "0 auto 14px",
          boxShadow: "0 8px 24px rgba(124,58,237,0.25)",
        }}>
          {initial}
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", margin: "0 0 4px" }}>{displayName}</h2>
        <p style={{ fontSize: 13, color: "var(--shop-muted, #8A8F9C)", margin: "0 0 14px" }}>
          {("phone" in (user as any) && (user as any).phone) || ("telegram_id" in user ? `TG: ${(user as any).telegram_id}` : "")}
        </p>
        {!editing && (
          <button onClick={() => setEditing(true)} style={{
            padding: "8px 20px",
            borderRadius: "var(--shop-r-pill, 999px)",
            border: "1.5px solid var(--shop-primary, #1E6BFF)",
            background: "transparent",
            color: "var(--shop-primary, #1E6BFF)",
            fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}>
            Edit profile
          </button>
        )}
      </div>

      {/* Edit form (shown when editing) */}
      {editing && (
        <div style={{
          margin: "0 16px 16px", padding: 16,
          background: "var(--shop-surface, #FFFFFF)",
          borderRadius: "var(--shop-r-card, 16px)",
          boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
        }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--shop-black, #0B0B0F)", margin: "0 0 12px" }}>Edit Profile</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Full Name"
              style={{
                padding: "12px 14px", borderRadius: "var(--shop-r-input, 12px)",
                border: "1px solid var(--shop-divider, #ECEEF3)",
                background: "var(--shop-bg, #F7F8FB)",
                color: "var(--shop-black, #0B0B0F)", fontSize: 14, outline: "none",
              }} />
            <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Phone"
              style={{
                padding: "12px 14px", borderRadius: "var(--shop-r-input, 12px)",
                border: "1px solid var(--shop-divider, #ECEEF3)",
                background: "var(--shop-bg, #F7F8FB)",
                color: "var(--shop-black, #0B0B0F)", fontSize: 14, outline: "none",
              }} />
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button onClick={() => setEditing(false)} style={{
                flex: 1, padding: 12,
                borderRadius: "var(--shop-r-input, 12px)",
                border: "1.5px solid var(--shop-divider, #ECEEF3)",
                background: "transparent",
                color: "var(--shop-text, #4A4E5A)", fontWeight: 600, fontSize: 14, cursor: "pointer",
              }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{
                flex: 1, padding: 12,
                borderRadius: "var(--shop-r-input, 12px)",
                border: "none",
                background: "var(--shop-primary, #1E6BFF)",
                color: "#FFFFFF", fontWeight: 600, fontSize: 14, cursor: "pointer",
                opacity: saving ? 0.5 : 1,
              }}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: "flex", gap: 10, padding: "0 16px", marginBottom: 20 }}>
        {[
          { num: "0", label: "Orders" },
          { num: "0", label: "Points" },
          { num: "0", label: "Reviews" },
        ].map((stat, i) => (
          <div key={i} style={{
            flex: 1, textAlign: "center", padding: "14px 8px",
            background: "var(--shop-surface, #FFFFFF)",
            borderRadius: "var(--shop-r-card, 16px)",
            boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--shop-black, #0B0B0F)" }}>{stat.num}</div>
            <div style={{ fontSize: 11, color: "var(--shop-muted, #8A8F9C)", marginTop: 2 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Menu list */}
      <div style={{
        margin: "0 16px 16px",
        background: "var(--shop-surface, #FFFFFF)",
        borderRadius: "var(--shop-r-card, 16px)",
        boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
        overflow: "hidden",
      }}>
        {MENU.map((item, i) => (
          <button key={i} onClick={() => router.push(item.href)} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12,
            padding: "14px 16px",
            background: "none", border: "none", cursor: "pointer",
            borderBottom: i < MENU.length - 1 ? "1px solid var(--shop-divider, #ECEEF3)" : "none",
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: "var(--shop-primary-tint, #E8F0FF)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {item.icon}
            </div>
            <span style={{ flex: 1, textAlign: "left", fontSize: 15, fontWeight: 500, color: "var(--shop-black, #0B0B0F)" }}>{item.label}</span>
            <span style={{ color: "var(--shop-muted, #8A8F9C)", fontSize: 18, fontWeight: 300 }}>&rsaquo;</span>
          </button>
        ))}

        {/* Logout item */}
        <button onClick={() => { if (confirm("Logout?")) { logout(); router.replace("/shop"); } }} style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          padding: "14px 16px",
          background: "none", border: "none", cursor: "pointer",
          borderTop: "1px solid var(--shop-divider, #ECEEF3)",
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: "#FEE2E2",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </div>
          <span style={{ flex: 1, textAlign: "left", fontSize: 15, fontWeight: 500, color: "#EF4444" }}>Logout</span>
          <span style={{ color: "var(--shop-muted, #8A8F9C)", fontSize: 18, fontWeight: 300 }}>&rsaquo;</span>
        </button>
      </div>

      <p style={{ textAlign: "center", fontSize: 11, color: "var(--shop-muted, #8A8F9C)", marginTop: 20 }}>Favourite of Shop v2.0</p>
    </div>
  );
}
