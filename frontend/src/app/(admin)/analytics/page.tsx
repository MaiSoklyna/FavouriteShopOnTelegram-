"use client";

import { useState, useEffect, useMemo } from "react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { api } from "@/lib/api";
import type { DashboardStats } from "@/types";

interface DailyPoint {
  date: string;
  orders: number;
  revenue: number;
}

interface OrderAnalytics {
  daily: DailyPoint[];
  statusBreakdown: Record<string, number>;
  totalOrders: number;
}

type RangeKey = "7" | "30" | "90";

const RANGE_OPTIONS: { key: RangeKey; label: string; days: number }[] = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "#F59E0B",
  confirmed: "#3B82F6",
  processing: "#8B5CF6",
  shipped: "#0EA5E9",
  delivered: "#22C55E",
  cancelled: "#EF4444",
};

export default function AnalyticsPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [orderData, setOrderData] = useState<OrderAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("30");

  useEffect(() => {
    setLoading(true);
    const days = RANGE_OPTIONS.find(r => r.key === range)!.days;
    Promise.all([
      api.get<DashboardStats>("/analytics/dashboard"),
      api.get<OrderAnalytics>("/analytics/orders", { params: { days } }),
    ])
      .then(([s, o]) => { setStats(s); setOrderData(o); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [range]);

  // Build a continuous date series — fill in zero days so the chart is gap-free.
  const series = useMemo<DailyPoint[]>(() => {
    if (!orderData?.daily) return [];
    const days = RANGE_OPTIONS.find(r => r.key === range)!.days;
    const map = new Map(orderData.daily.map(d => [d.date, d]));
    const out: DailyPoint[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const found = map.get(iso);
      out.push({
        date: iso,
        revenue: found ? Number(found.revenue) || 0 : 0,
        orders: found ? Number(found.orders) || 0 : 0,
      });
    }
    return out;
  }, [orderData, range]);

  const totals = useMemo(() => {
    const revenue = series.reduce((s, d) => s + d.revenue, 0);
    const orders = series.reduce((s, d) => s + d.orders, 0);
    const aov = orders ? revenue / orders : 0;
    return { revenue, orders, aov };
  }, [series]);

  if (loading) {
    return (
      <div style={{ padding: 20 }}>
        {[1, 2, 3].map(i => (
          <div
            key={i}
            style={{
              height: 80, background: "var(--bg-secondary)",
              borderRadius: 12, marginBottom: 12,
              animation: "pulse 1.5s infinite",
            }}
          />
        ))}
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
      </div>
    );
  }

  const kpis = [
    { label: "Total Revenue", value: fmtMoney(stats?.totalRevenue), accent: "var(--success)" },
    { label: "Total Orders", value: stats?.totalOrders ?? 0, accent: "var(--info)" },
    { label: "Today Revenue", value: fmtMoney(stats?.todayRevenue), accent: "var(--purple, #8B5CF6)" },
    { label: "Today Orders", value: stats?.todayOrders ?? 0, accent: "var(--warning)" },
    { label: "Pending Orders", value: stats?.pendingOrders ?? 0, accent: "var(--danger)" },
    { label: "Products", value: stats?.totalProducts ?? 0, accent: "var(--text)" },
  ];

  const formatTick = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Show ~6 ticks regardless of range
  const tickStep = Math.max(1, Math.ceil(series.length / 6));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Analytics</h1>
        <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              style={{
                padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                background: range === opt.key ? "var(--accent)" : "var(--bg-secondary)",
                color: range === opt.key ? "#fff" : "var(--text-secondary)",
                border: "none", borderRight: opt.key !== "90" ? "1px solid var(--border)" : "none",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        {kpis.map(k => (
          <div key={k.label} className="admin-card">
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{k.label}</p>
            <p style={{ fontSize: 24, fontWeight: 700, color: k.accent }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Range summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        <SummaryCard label={`Revenue · ${range}d`} value={fmtMoney(totals.revenue)} />
        <SummaryCard label={`Orders · ${range}d`} value={totals.orders.toLocaleString()} />
        <SummaryCard label="Avg order value" value={fmtMoney(totals.aov)} />
      </div>

      {/* Status breakdown */}
      {orderData?.statusBreakdown && Object.keys(orderData.statusBreakdown).length > 0 && (
        <div className="admin-card" style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>
            Order Status Breakdown
          </h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {Object.entries(orderData.statusBreakdown).map(([status, count]) => (
              <div key={status} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  display: "inline-block", width: 10, height: 10, borderRadius: "50%",
                  background: STATUS_COLORS[status] || "var(--text-muted)",
                }} />
                <span style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "capitalize" }}>{status}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Revenue area chart */}
      <div className="admin-card" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
            Revenue · last {range} days
          </h3>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {series[0] && formatTick(series[0].date)} – {series.at(-1) && formatTick(series.at(-1)!.date)}
          </span>
        </div>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <AreaChart data={series} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--info, #3B82F6)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--info, #3B82F6)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatTick}
                interval={tickStep - 1}
                stroke="var(--text-muted)"
                tick={{ fontSize: 11 }}
              />
              <YAxis
                stroke="var(--text-muted)"
                tick={{ fontSize: 11 }}
                tickFormatter={v => `$${Number(v).toLocaleString()}`}
                width={70}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(label) => formatTick(String(label))}
                formatter={(value: number) => [fmtMoney(value), "Revenue"]}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="var(--info, #3B82F6)"
                strokeWidth={2}
                fill="url(#revFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Orders bar chart */}
      <div className="admin-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
            Orders · last {range} days
          </h3>
        </div>
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={series} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatTick}
                interval={tickStep - 1}
                stroke="var(--text-muted)"
                tick={{ fontSize: 11 }}
              />
              <YAxis
                stroke="var(--text-muted)"
                tick={{ fontSize: 11 }}
                allowDecimals={false}
                width={40}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(label) => formatTick(String(label))}
                formatter={(value: number) => [Number(value).toLocaleString(), "Orders"]}
              />
              <Bar dataKey="orders" fill="var(--success, #22C55E)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-card">
      <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{value}</p>
    </div>
  );
}

function fmtMoney(n: number | undefined | null): string {
  const v = Number(n || 0);
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

const tooltipStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};
