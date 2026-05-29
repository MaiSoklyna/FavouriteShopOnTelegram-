"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import type { AdminUser } from "@/types";
import {
  HiOutlineHome, HiOutlineShoppingBag, HiOutlineClipboardList,
  HiOutlineTag, HiOutlineUsers, HiOutlineChartBar,
  HiOutlineCog, HiOutlineTicket, HiOutlineStar,
  HiOutlineBell, HiOutlineGift, HiOutlineOfficeBuilding,
  HiOutlineLogout, HiOutlineMenu, HiOutlineX,
  HiOutlinePhotograph, HiOutlineChatAlt2,
} from "react-icons/hi";

const MENU = [
  { href: "/dashboard", label: "Dashboard", icon: HiOutlineHome },
  { href: "/products", label: "Products", icon: HiOutlineShoppingBag },
  { href: "/orders", label: "Orders", icon: HiOutlineClipboardList },
  { href: "/categories", label: "Categories", icon: HiOutlineTag },
  { href: "/banners", label: "Banners", icon: HiOutlinePhotograph, superOnly: true },
  { href: "/promotions", label: "Promotions", icon: HiOutlineGift },
  { href: "/analytics", label: "Analytics", icon: HiOutlineChartBar },
  { href: "/reviews", label: "Reviews", icon: HiOutlineChatAlt2 },
  { href: "/support", label: "Support", icon: HiOutlineTicket },
  { href: "/loyalty", label: "Loyalty", icon: HiOutlineStar },
  { href: "/notifications", label: "Notifications", icon: HiOutlineBell, adminOnly: false },
  { href: "/merchants", label: "Merchants", icon: HiOutlineOfficeBuilding, superOnly: true },
  { href: "/users", label: "Users", icon: HiOutlineUsers, superOnly: true },
  { href: "/settings", label: "Settings", icon: HiOutlineCog },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, isAdmin, isSuperAdmin, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!loading && !isAdmin) {
      router.replace("/login");
    }
  }, [loading, isAdmin, router]);

  if (loading || !user || !isAdmin) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#EAEFF3" }}>
        <div className="spinner" />
      </div>
    );
  }

  const adminUser = user as AdminUser;
  const visibleMenu = MENU.filter((m) => !("superOnly" in m && m.superOnly) || isSuperAdmin);

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  const toggleTheme = () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}>
      {/* Sidebar */}
      <aside
        className={`admin-sidebar${sidebarOpen ? " admin-sidebar--open" : ""}`}
        style={{
          width: collapsed ? 72 : 250,
          background: "#081D3C",
          display: "flex",
          flexDirection: "column",
          transition: "width 0.2s, transform 0.2s",
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 40,
        }}
      >
        {/* Logo area */}
        <div style={{
          padding: collapsed ? "16px 12px" : "20px 20px 16px",
          borderBottom: "1px solid rgba(234, 239, 243, 0.1)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <img src="/image.png" alt="Logo" style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 6, objectFit: "cover" }} />
          {!collapsed && (
            <span style={{
              fontWeight: 700, fontSize: 15, color: "#FFFFFF",
              fontFamily: "'Kantumruy Pro', sans-serif",
              lineHeight: "18px",
            }}>
              Byme24
            </span>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{
              marginLeft: "auto", background: "rgba(234, 239, 243, 0.1)",
              border: "none", cursor: "pointer", color: "rgba(234, 239, 243, 0.6)",
              padding: 6, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {collapsed ? <HiOutlineMenu size={16} /> : <HiOutlineX size={14} />}
          </button>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: collapsed ? "8px 6px" : "8px 12px", overflowY: "auto" }}>
          {visibleMenu.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <a
                key={item.href}
                href={item.href}
                onClick={(e) => { e.preventDefault(); router.push(item.href); setSidebarOpen(false); }}
                style={{
                  display: "flex", alignItems: "center",
                  gap: 10,
                  padding: collapsed ? "10px" : "10px 14px",
                  justifyContent: collapsed ? "center" : "flex-start",
                  borderRadius: 8, marginBottom: 2, textDecoration: "none",
                  fontSize: 14,
                  fontFamily: "'Kantumruy Pro', sans-serif",
                  color: active ? "#D6BA80" : "rgba(234, 239, 243, 0.6)",
                  background: active ? "rgba(214, 186, 128, 0.12)" : "transparent",
                  fontWeight: active ? 600 : 400,
                  transition: "all 0.15s",
                }}
              >
                <Icon size={18} />
                {!collapsed && item.label}
              </a>
            );
          })}
        </nav>

        {/* User + actions */}
        <div style={{ padding: collapsed ? "12px 8px" : "16px", borderTop: "1px solid rgba(234, 239, 243, 0.1)" }}>
          {!collapsed && (
            <div style={{ marginBottom: 10 }}>
              <div style={{
                fontWeight: 600, color: "#FFFFFF", fontSize: 13,
                fontFamily: "'Kantumruy Pro', sans-serif",
              }}>
                {adminUser.name}
              </div>
              <div style={{
                color: "#D6BA80", fontSize: 11,
                fontFamily: "'Kantumruy Pro', sans-serif",
              }}>
                {adminUser.role === "super_admin" ? "Super Admin" : adminUser.merchant_name || "Admin"}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={toggleTheme}
              title="Toggle theme"
              style={{
                flex: collapsed ? undefined : 1,
                width: collapsed ? "100%" : undefined,
                padding: "8px",
                background: "rgba(234, 239, 243, 0.1)",
                border: "none", borderRadius: 6, cursor: "pointer",
                fontSize: 12, color: "rgba(234, 239, 243, 0.6)",
                fontFamily: "'Kantumruy Pro', sans-serif",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              {!collapsed && "Theme"}
            </button>
            {!collapsed && (
              <button
                onClick={handleLogout}
                style={{
                  flex: 1, padding: "8px",
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "none", borderRadius: 6, cursor: "pointer",
                  fontSize: 12, color: "#EF4444",
                  fontFamily: "'Kantumruy Pro', sans-serif",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                }}
              >
                <HiOutlineLogout size={14} /> Logout
              </button>
            )}
            {collapsed && (
              <button
                onClick={handleLogout}
                title="Logout"
                style={{
                  width: "100%", padding: "8px",
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "none", borderRadius: 6, cursor: "pointer",
                  color: "#EF4444",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <HiOutlineLogout size={14} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(8, 29, 60, 0.6)", zIndex: 30 }} />
      )}

      {/* Main content */}
      <main style={{
        flex: 1,
        marginLeft: collapsed ? 72 : 250,
        padding: "24px",
        minHeight: "100vh",
        transition: "margin-left 0.2s",
        background: "var(--bg)",
      }}>
        {/* Mobile header */}
        <div style={{ display: "none", marginBottom: 16, alignItems: "center", gap: 10 }} className="mobile-header">
          <button onClick={() => setSidebarOpen(true)} style={{
            background: "#103562", border: "none", cursor: "pointer",
            color: "#FFFFFF", padding: 8, borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <HiOutlineMenu size={20} />
          </button>
          <img src="/image.png" alt="Logo" style={{ width: 24, height: 24, borderRadius: 6, objectFit: "cover" }} />
          <span style={{
            fontWeight: 600, color: "#081D3C", fontSize: 15,
            fontFamily: "'Kantumruy Pro', sans-serif",
          }}>
            Byme24
          </span>
        </div>
        {children}
      </main>

      <style>{`
        .spinner { width:32px;height:32px;border:3px solid rgba(234,239,243,0.3);border-top-color:#103562;border-radius:50%;animation:spin .6s linear infinite }
        @keyframes spin{to{transform:rotate(360deg)}}
        @media(max-width:768px){
          .mobile-header{display:flex!important}
          .admin-sidebar{transform:translateX(-100%)}
          .admin-sidebar.admin-sidebar--open{transform:translateX(0)}
          main{margin-left:0!important;padding:16px!important}
        }
      `}</style>
    </div>
  );
}
