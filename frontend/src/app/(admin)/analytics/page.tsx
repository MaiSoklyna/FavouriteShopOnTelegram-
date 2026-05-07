"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { DashboardStats } from "@/types";

interface OrderAnalytics { daily: { date: string; orders: number; revenue: number }[]; statusBreakdown: Record<string, number>; totalOrders: number; }

export default function AnalyticsPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [orderData, setOrderData] = useState<OrderAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<DashboardStats>("/analytics/dashboard"),
      api.get<OrderAnalytics>("/analytics/orders"),
    ]).then(([s, o]) => { setStats(s); setOrderData(o); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 20 }}>{[1, 2, 3].map(i => <div key={i} style={{ height: 80, background: "var(--bg-secondary)", borderRadius: 12, marginBottom: 12, animation: "pulse 1.5s infinite" }} />)}<style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style></div>;

  const kpis = [
    { label: "Total Revenue", value: `$${stats?.totalRevenue?.toLocaleString() || 0}`, color: "var(--success)" },
    { label: "Total Orders", value: stats?.totalOrders || 0, color: "var(--info)" },
    { label: "Today Revenue", value: `$${stats?.todayRevenue?.toLocaleString() || 0}`, color: "var(--purple)" },
    { label: "Today Orders", value: stats?.todayOrders || 0, color: "var(--warning)" },
    { label: "Pending Orders", value: stats?.pendingOrders || 0, color: "var(--danger)" },
    { label: "Products", value: stats?.totalProducts || 0, color: "var(--text)" },
  ];

  const maxRevenue = Math.max(...(orderData?.daily?.map(d => d.revenue) || [1]));

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>Analytics</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        {kpis.map(k => (
          <div key={k.label} className="admin-card">
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{k.label}</p>
            <p style={{ fontSize: 24, fontWeight: 700, color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Status breakdown */}
      {orderData?.statusBreakdown && (
        <div className="admin-card" style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Order Status Breakdown</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {Object.entries(orderData.statusBreakdown).map(([status, count]) => (
              <div key={status} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className={`badge badge-${status}`}>{status}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Revenue chart (simple bar chart) */}
      {orderData?.daily && orderData.daily.length > 0 && (
        <div className="admin-card">
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>Daily Revenue (Last 30 days)</h3>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 160, overflowX: "auto", paddingBottom: 24, position: "relative" }}>
            {orderData.daily.slice(-30).map(d => (
              <div key={d.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "1 0 24px", minWidth: 24 }}>
                <div style={{ width: "100%", maxWidth: 20, background: "var(--info)", borderRadius: "4px 4px 0 0", height: `${Math.max(4, (d.revenue / maxRevenue) * 140)}px`, transition: "height 0.3s" }} title={`${d.date}: $${d.revenue.toFixed(0)}`} />
                <span style={{ fontSize: 8, color: "var(--text-muted)", marginTop: 4, transform: "rotate(-45deg)", transformOrigin: "top left", whiteSpace: "nowrap" }}>{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
