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
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--shop-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
      </svg>
    ),
  },
  {
    label: "Notifications", href: "/shop/notifications",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--shop-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
    ),
  },
  {
    label: "Rewards & Points", href: "/shop/rewards",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--shop-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    ),
  },
  {
    label: "Support", href: "/shop/support",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--shop-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
      await api.patch("/users/me", { first_name: form.name, phone: form.phone });
      setEditing(false);
      if (typeof window !== "undefined") window.location.reload();
    } catch (e: any) { alert(e.detail || "Failed to update"); }
    finally { setSaving(false); }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  }

  if (!user) {
    return <LoginGate><div /></LoginGate>;
  }

  const displayName = ("name" in user ? (user as any).name : (user as any).username) || "User";
  const initial = displayName[0]?.toUpperCase() || "?";

  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg)", paddingBottom: 80 }}>
      {/* Navy header */}
      <div style={{
        background: "#103562",
        borderRadius: "0 0 20px 20px",
        padding: "16px 20px 28px",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <span style={{
            fontSize: 16, fontWeight: 500, color: "#FFFFFF",
            fontFamily: "'Kantumruy Pro', sans-serif",
          }}>Profile</span>
          <button onClick={toggleTheme} style={{
            width: 36, height: 36, borderRadius: 20,
            background: "rgba(234, 239, 243, 0.2)",
            border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          </button>
        </div>

        {/* Avatar + name in header */}
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 72, height: 72, borderRadius: "50%",
            background: "linear-gradient(135deg, #D6BA80, #71541A)",
            color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 28, fontWeight: 700, margin: "0 auto 12px",
            border: "3px solid rgba(234, 239, 243, 0.3)",
          }}>
            {initial}
          </div>
          <h2 style={{
            fontSize: 20, fontWeight: 600, color: "#FFFFFF", margin: "0 0 4px",
            fontFamily: "'Kantumruy Pro', sans-serif",
          }}>{displayName}</h2>
          <p style={{
            fontSize: 12, color: "#D6BA80", margin: 0,
            fontFamily: "'Kantumruy Pro', sans-serif",
          }}>
            {("phone" in (user as any) && (user as any).phone) || ("telegram_id" in user ? `TG: ${(user as any).telegram_id}` : "")}
          </p>
        </div>
      </div>

      <div style={{ padding: "0 16px", marginTop: -12 }}>
        {/* Edit profile button */}
        {!editing && (
          <button onClick={() => setEditing(true)} style={{
            width: "100%", padding: "10px",
            borderRadius: 8, border: "none",
            background: "var(--shop-surface)", color: "var(--shop-primary)",
            fontWeight: 500, fontSize: 13, cursor: "pointer",
            fontFamily: "'Kantumruy Pro', sans-serif",
            boxShadow: "var(--shop-shadow)",
            marginBottom: 16,
          }}>
            Edit Profile
          </button>
        )}

        {/* Edit form */}
        {editing && (
          <div style={{
            padding: 16, marginBottom: 16,
            background: "var(--shop-surface)", borderRadius: 8,
            boxShadow: "var(--shop-shadow)",
          }}>
            <p style={{
              fontSize: 14, fontWeight: 600, color: "var(--shop-text)", margin: "0 0 12px",
              fontFamily: "'Kantumruy Pro', sans-serif",
            }}>Edit Profile</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={{
                  display: "block", fontSize: 12, fontWeight: 500, color: "var(--shop-text)",
                  marginBottom: 4, fontFamily: "'Kantumruy Pro', sans-serif",
                }}>Full Name</label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Full Name"
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: 8,
                    border: "1px solid var(--shop-divider)", background: "var(--bg-secondary)",
                    color: "var(--shop-text)", fontSize: 14, outline: "none",
                    fontFamily: "'Inter', sans-serif",
                  }} />
              </div>
              <div>
                <label style={{
                  display: "block", fontSize: 12, fontWeight: 500, color: "var(--shop-text)",
                  marginBottom: 4, fontFamily: "'Kantumruy Pro', sans-serif",
                }}>Phone</label>
                <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="Phone"
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: 8,
                    border: "1px solid var(--shop-divider)", background: "var(--bg-secondary)",
                    color: "var(--shop-text)", fontSize: 14, outline: "none",
                    fontFamily: "'Inter', sans-serif",
                  }} />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button onClick={() => setEditing(false)} style={{
                  flex: 1, padding: 10, borderRadius: 8,
                  border: "1px solid var(--shop-divider)", background: "transparent",
                  color: "var(--shop-muted)", fontWeight: 500, fontSize: 13, cursor: "pointer",
                  fontFamily: "'Kantumruy Pro', sans-serif",
                }}>Cancel</button>
                <button onClick={handleSave} disabled={saving} style={{
                  flex: 1, padding: 10, borderRadius: 8,
                  border: "none", background: "#71541A",
                  color: "#FFFFFF", fontWeight: 500, fontSize: 13, cursor: "pointer",
                  fontFamily: "'Kantumruy Pro', sans-serif",
                  opacity: saving ? 0.5 : 1,
                }}>
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Menu list */}
        <div style={{
          background: "var(--shop-surface)", borderRadius: 8,
          boxShadow: "var(--shop-shadow)",
          overflow: "hidden",
        }}>
          {MENU.map((item, i) => (
            <button key={i} onClick={() => router.push(item.href)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 12,
              padding: "14px 16px",
              background: "none", border: "none", cursor: "pointer",
              borderBottom: i < MENU.length - 1 ? "1px solid var(--shop-divider)" : "none",
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                background: "var(--shop-primary-tint)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {item.icon}
              </div>
              <span style={{
                flex: 1, textAlign: "left", fontSize: 14, fontWeight: 500,
                color: "var(--shop-text)", fontFamily: "'Kantumruy Pro', sans-serif",
              }}>{item.label}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--shop-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))}

          {/* Logout */}
          <button onClick={() => { if (confirm("Logout?")) { logout(); router.replace("/shop"); } }} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12,
            padding: "14px 16px",
            background: "none", border: "none", cursor: "pointer",
            borderTop: "1px solid var(--shop-divider)",
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8, flexShrink: 0,
              background: "rgba(239, 68, 68, 0.06)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </div>
            <span style={{
              flex: 1, textAlign: "left", fontSize: 14, fontWeight: 500, color: "#EF4444",
              fontFamily: "'Kantumruy Pro', sans-serif",
            }}>Logout</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--shop-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <p style={{
          textAlign: "center", fontSize: 11, color: "var(--shop-muted)", marginTop: 20,
          fontFamily: "'Kantumruy Pro', sans-serif",
        }}>Byme24 v2.0</p>
      </div>
    </div>
  );
}
