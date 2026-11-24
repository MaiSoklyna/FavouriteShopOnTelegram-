"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { DashboardStats, AdminUser, ShopReview, ShopReviewSummary } from "@/types";
import { RatingSummary } from "@/components/admin/ShopReviewsPanel";
import { ShopOverview } from "@/components/admin/ShopOverview";
import { HiOutlineShoppingBag, HiOutlineClipboardList, HiOutlineCurrencyDollar, HiOutlineClock, HiOutlineUsers, HiOutlineTrendingUp } from "react-icons/hi";

export default function DashboardPage() {
  const { user, isSuperAdmin, isShopStaff } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchStats() {
    // Shops get their own overview (ShopOverview); these platform-wide cards are for super admins
    if (!isSuperAdmin) { setLoading(false); return; }
    try {
      const data = await api.get<DashboardStats>("/analytics/dashboard");
      setStats(data);
    } catch (err) {
      console.error("Failed to load stats:", err);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchStats(); }, [isSuperAdmin]);
  useAutoRefresh(fetchStats, { interval: 30000 });

  const adminUser = user as AdminUser;

  const cards = [
    { label: "Total Products", value: stats?.totalProducts ?? 0, icon: HiOutlineShoppingBag, color: "var(--info)" },
    { label: "Total Orders", value: stats?.totalOrders ?? 0, icon: HiOutlineClipboardList, color: "var(--success)" },
    { label: "Total Revenue", value: `$${(stats?.totalRevenue ?? 0).toLocaleString()}`, icon: HiOutlineCurrencyDollar, color: "var(--purple)" },
    { label: "Pending Orders", value: stats?.pendingOrders ?? 0, icon: HiOutlineClock, color: "var(--warning)" },
    { label: "Today's Orders", value: stats?.todayOrders ?? 0, icon: HiOutlineTrendingUp, color: "var(--info)" },
    { label: "Today's Revenue", value: `$${(stats?.todayRevenue ?? 0).toLocaleString()}`, icon: HiOutlineCurrencyDollar, color: "var(--success)" },
    // Discounts split by who paid: a shop's revenue already includes the platform-paid ones
    { label: isSuperAdmin ? "Shop-paid Discounts" : "Your Shop's Discounts", value: `$${(stats?.merchantFundedDiscounts ?? 0).toLocaleString()}`, icon: HiOutlineCurrencyDollar, color: "var(--warning)" },
    { label: isSuperAdmin ? "Platform-paid Discounts" : "Paid by Byme24", value: `$${(stats?.platformFundedDiscounts ?? 0).toLocaleString()}`, icon: HiOutlineCurrencyDollar, color: "var(--info)" },
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

      {!isSuperAdmin && <WorkQueue staff={isShopStaff} />}

      {!isSuperAdmin ? <ShopOverview /> : loading ? (
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

      {!isSuperAdmin && <ShopRatingCard />}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}

type QueueOrder = { id: number; order_code: string; customer_name?: string | null; total: number; created_at: string; delivery_type?: string };

/** The shop's work right now: new orders to accept and accepted orders to prepare. Staff see this first. */
function WorkQueue({ staff }: { staff: boolean }) {
  const [lists, setLists] = useState<{ pending: QueueOrder[]; confirmed: QueueOrder[] } | null>(null);
  const load = async () => {
    try {
      const [pending, confirmed] = await Promise.all([
        api.get<QueueOrder[]>("/orders/admin/list?status=pending&page_size=10"),
        api.get<QueueOrder[]>("/orders/admin/list?status=confirmed&page_size=10"),
      ]);
      setLists({ pending, confirmed });
    } catch { /* offline: keep what we have */ }
  };
  useEffect(() => { load(); }, []);
  useAutoRefresh(load, { interval: 30000 });
  if (!lists) return null;

  const column = (title: string, hint: string, rows: QueueOrder[], testid: string) => (
    <div data-testid={testid} style={{ flex: "1 1 280px", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{title} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>({rows.length})</span></span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{hint}</span>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>Nothing here.</p>
      ) : rows.map((o) => (
        <a key={o.id} href="/orders" style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 0", borderTop: "1px solid var(--border)", fontSize: 13, color: "var(--text)", textDecoration: "none" }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <strong>{o.order_code}</strong> · {o.customer_name || "Customer"}{o.delivery_type === "pickup" ? " · pickup" : ""}
          </span>
          <span style={{ whiteSpace: "nowrap", color: "var(--text-muted)" }}>${Number(o.total).toFixed(2)} · {timeAgo(o.created_at)}</span>
        </a>
      ))}
    </div>
  );

  return (
    <div data-testid="work-queue" style={{ marginBottom: 24, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, boxShadow: "var(--shadow-sm)" }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>{staff ? "Your tasks" : "Orders waiting for the shop"}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
        {column("New orders", "accept or reject", lists.pending, "queue-pending")}
        {column("To prepare", "accepted, not sent yet", lists.confirmed, "queue-confirmed")}
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** The shop's rating, the spread of stars and its latest reviews. */
function ShopRatingCard() {
  const [data, setData] = useState<{ summary: ShopReviewSummary; latest: ShopReview[] } | null>(null);
  useEffect(() => { api.get<{ summary: ShopReviewSummary; latest: ShopReview[] }>("/shop-reviews/merchant/summary").then(setData).catch(() => {}); }, []);
  if (!data) return null;
  return (
    <div data-testid="shop-rating-card" style={{ marginTop: 24, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Customer reviews</span>
        <a href="/reviews" style={{ fontSize: 13, color: "var(--info)" }}>See all</a>
      </div>
      {data.summary.count === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No reviews yet. Customers can rate your shop once their order is delivered.</p>
      ) : (
        <>
          <RatingSummary summary={data.summary} />
          {data.latest.slice(0, 3).map((r) => (
            <div key={r.id} style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 10, fontSize: 13 }}>
              <strong>{r.reviewer}</strong> <span style={{ color: "var(--warning)" }}>{"★".repeat(r.rating)}</span>
              {r.comment && <div style={{ color: "var(--text-muted)", marginTop: 2 }}>{r.comment}</div>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
