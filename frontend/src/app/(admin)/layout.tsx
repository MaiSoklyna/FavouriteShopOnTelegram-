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
} from "react-icons/hi";

const MENU = [
  { href: "/dashboard", label: "Dashboard", icon: HiOutlineHome },
  { href: "/products", label: "Products", icon: HiOutlineShoppingBag },
  { href: "/orders", label: "Orders", icon: HiOutlineClipboardList },
  { href: "/categories", label: "Categories", icon: HiOutlineTag },
  { href: "/promotions", label: "Promotions", icon: HiOutlineGift },
  { href: "/analytics", label: "Analytics", icon: HiOutlineChartBar },
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
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
          width: collapsed ? 64 : 240,
          background: "var(--sidebar-bg)",
          borderRight: "1px solid var(--border)",
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
        {/* Logo */}
        <div style={{ padding: "16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
          {!collapsed && <span style={{ fontWeight: 700, fontSize: 16, color: "var(--text)" }}>Favourite of Shop</span>}
          <button onClick={() => setCollapsed(!collapsed)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4 }}>
            {collapsed ? <HiOutlineMenu size={18} /> : <HiOutlineX size={14} />}
          </button>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "8px", overflowY: "auto" }}>
          {visibleMenu.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <a
                key={item.href}
                href={item.href}
                onClick={(e) => { e.preventDefault(); router.push(item.href); setSidebarOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                  borderRadius: 8, marginBottom: 2, textDecoration: "none", fontSize: 14,
                  color: active ? "var(--sidebar-active)" : "var(--sidebar-text)",
                  background: active ? "var(--accent-light)" : "transparent",
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
        <div style={{ padding: "12px", borderTop: "1px solid var(--border)" }}>
          {!collapsed && (
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              <div style={{ fontWeight: 600, color: "var(--text)" }}>{adminUser.name}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{adminUser.role === "super_admin" ? "Super Admin" : adminUser.merchant_name || "Admin"}</div>
            </div>
          )}
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={toggleTheme} style={{ flex: 1, padding: "6px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "var(--text-secondary)" }}>
              Theme
            </button>
            <button onClick={handleLogout} style={{ flex: 1, padding: "6px", background: "var(--danger-light)", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "var(--danger)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
              <HiOutlineLogout size={14} /> {!collapsed && "Logout"}
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 30 }} />
      )}

      {/* Main content */}
      <main style={{ flex: 1, marginLeft: collapsed ? 64 : 240, padding: "24px", minHeight: "100vh", transition: "margin-left 0.2s" }}>
        {/* Mobile header */}
        <div style={{ display: "none", marginBottom: 16, alignItems: "center", gap: 8 }} className="mobile-header">
          <button onClick={() => setSidebarOpen(true)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text)" }}>
            <HiOutlineMenu size={24} />
          </button>
          <span style={{ fontWeight: 600 }}>Favourite of Shop</span>
        </div>
        {children}
      </main>

      <style>{`
        .spinner { width:32px;height:32px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite }
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
