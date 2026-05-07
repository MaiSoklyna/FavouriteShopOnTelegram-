"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { DashboardStats, AdminUser } from "@/types";
import { HiOutlineShoppingBag, HiOutlineClipboardList, HiOutlineCurrencyDollar, HiOutlineClock, HiOutlineUsers, HiOutlineTrendingUp } from "react-icons/hi";

export default function DashboardPage() {
  const { user, isSuperAdmin } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchStats() {
    try {
      const data = await api.get<DashboardStats>("/analytics/dashboard");
      setStats(data);
    } catch (err) {
      console.error("Failed to load stats:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchStats(); }, []);
  useAutoRefresh(fetchStats, { interval: 30000 });

  const adminUser = user as AdminUser;

  const cards = [
    { label: "Total Products", value: stats?.totalProducts ?? 0, icon: HiOutlineShoppingBag, color: "var(--info)" },
    { label: "Total Orders", value: stats?.totalOrders ?? 0, icon: HiOutlineClipboardList, color: "var(--success)" },
    { label: "Total Revenue", value: `$${(stats?.totalRevenue ?? 0).toLocaleString()}`, icon: HiOutlineCurrencyDollar, color: "var(--purple)" },
    { label: "Pending Orders", value: stats?.pendingOrders ?? 0, icon: HiOutlineClock, color: "var(--warning)" },
    { label: "Today's Orders", value: stats?.todayOrders ?? 0, icon: HiOutlineTrendingUp, color: "var(--info)" },
    { label: "Today's Revenue", value: `$${(stats?.todayRevenue ?? 0).toLocaleString()}`, icon: HiOutlineCurrencyDollar, color: "var(--success)" },
  ];

  if (isSuperAdmin) {
    cards.push({ label: "Total Users", value: stats?.totalUsers ?? 0, icon: HiOutlineUsers, color: "var(--accent)" });
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
          Welcome back, {adminUser?.name || "Admin"}
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>
          {adminUser?.role === "super_admin" ? "Super Admin Dashboard" : adminUser?.merchant_name || "Merchant Dashboard"}
        </p>
      </div>

      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{ height: 100, background: "var(--bg-secondary)", borderRadius: 12, animation: "pulse 1.5s infinite" }} />
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 20,
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>{card.label}</span>
                  <Icon size={20} style={{ color: card.color }} />
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text)" }}>{card.value}</div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}
