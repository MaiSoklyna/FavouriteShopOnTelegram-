"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { ShopRole } from "@/types";

/**
 * The shop's home page overview, from GET /merchant-dashboard: order summary for everyone,
 * sales, top products and recent activity for the roles allowed to see them (the server leaves
 * out what a role may not see, so this component only shows what it receives).
 */

type Daily = { date: string; revenue: number; orders: number };
type Summary = {
  role: ShopRole;
  period_days: number;
  orders: { waiting: number; in_progress: number; today: number; period: number; delivered: number; cancelled: number };
  sales: {
    today: number; period: number; previous_period: number; change_pct: number | null;
    paid_orders: number; average_order_value: number; daily: Daily[];
  } | null;
  top_products: { product_id: number | null; name: string; quantity: number; revenue: number }[] | null;
  recent_activity: { id: number; actor_name: string | null; action: string; target_label: string | null; created_at: string }[] | null;
};

const PERIODS = [7, 30, 90];
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const card: React.CSSProperties = {
  background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, boxShadow: "var(--shadow-sm)", minWidth: 0,
};

function Tile({ label, value, sub, testid }: { label: string; value: string | number; sub?: React.ReactNode; testid?: string }) {
  return (
    <div style={card} data-testid={testid}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export function ShopOverview() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setData(await api.get<Summary>(`/merchant-dashboard?days=${days}`)); setError(""); }
    catch (e: any) { setError(e?.detail || "Could not load the overview"); }
  }, [days]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, { interval: 60000 });

  if (error && !data) return <div style={{ ...card, color: "var(--text-muted)", fontSize: 13 }}>{error}</div>;
  if (!data) return <div style={{ ...card, height: 120, opacity: 0.5 }} />;

  const { orders, sales, top_products, recent_activity } = data;
  const change = sales?.change_pct;

  return (
    <div data-testid="shop-overview" style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Overview</h2>
        <div role="group" aria-label="Period" style={{ display: "flex", gap: 4 }}>
          {PERIODS.map((d) => (
            <button key={d} className={d === days ? "btn-primary" : "btn-outline"} style={{ padding: "4px 10px", fontSize: 12 }}
              aria-pressed={d === days} onClick={() => setDays(d)} data-testid={`period-${d}`}>
              {d} days
            </button>
          ))}
        </div>
      </div>

      {/* Orders: everyone */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 16 }} data-testid="order-summary">
        <Tile label="Waiting to accept" value={orders.waiting} sub={orders.waiting ? <Link href="/orders" style={{ color: "var(--info)" }}>Open orders</Link> : "All caught up"} />
        <Tile label="In progress" value={orders.in_progress} sub="Accepted, preparing or on the way" />
        <Tile label="Orders today" value={orders.today} />
        <Tile label={`Delivered (${data.period_days} days)`} value={orders.delivered} sub={`${orders.period} orders in total`} />
        <Tile label={`Cancelled (${data.period_days} days)`} value={orders.cancelled} />
      </div>

      {/* Sales: owners and managers */}
      {sales && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 16 }} data-testid="sales-summary">
            <Tile label="Sales today" value={money(sales.today)} />
            <Tile label={`Sales (${data.period_days} days)`} value={money(sales.period)}
              sub={change === null || change === undefined ? "No sales in the period before" :
                <span>{change >= 0 ? "▲" : "▼"} {Math.abs(change)}% vs the {data.period_days} days before</span>} />
            <Tile label="Average order" value={money(sales.average_order_value)} sub={`${sales.paid_orders} order${sales.paid_orders === 1 ? "" : "s"}, cancelled ones excluded`} />
          </div>
          <DailySales daily={sales.daily} />
        </>
      )}

      {(top_products || recent_activity) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
          {top_products && (
            <div style={card} data-testid="top-products">
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>Top products</div>
              {top_products.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No sales in this period yet.</p>
              ) : (
                <table className="admin-table" style={{ fontSize: 13 }}>
                  <thead><tr><th>#</th><th>Product</th><th style={{ textAlign: "right" }}>Sold</th><th style={{ textAlign: "right" }}>Revenue</th></tr></thead>
                  <tbody>
                    {top_products.map((p, i) => (
                      <tr key={`${p.product_id}-${p.name}`}>
                        <td>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{p.name}</td>
                        <td style={{ textAlign: "right" }}>{p.quantity}</td>
                        <td style={{ textAlign: "right" }}>{money(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {recent_activity && (
            <div style={card} data-testid="recent-activity">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Recent activity</span>
                <Link href="/activity" style={{ fontSize: 13, color: "var(--info)" }}>See all</Link>
              </div>
              {recent_activity.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Nothing yet. Changes your team makes appear here.</p>
              ) : recent_activity.map((e) => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 0", borderTop: "1px solid var(--border)", fontSize: 13 }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <strong>{e.actor_name || "Someone"}</strong> {describe(e.action)}{e.target_label ? ` · ${e.target_label}` : ""}
                  </span>
                  <span style={{ whiteSpace: "nowrap", color: "var(--text-muted)" }}>{ago(e.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Daily sales as thin bars with a hover tooltip; the period total is in the tile above. */
function DailySales({ daily }: { daily: Daily[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...daily.map((d) => d.revenue), 0);
  const W = 720, H = 160, PAD_B = 18;
  const step = W / Math.max(daily.length, 1);
  const barW = Math.max(2, Math.min(24, step - 2)); // 2px surface gap between bars
  const h = (v: number) => (max > 0 ? (v / max) * (H - PAD_B - 8) : 0);
  const label = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString([], { day: "numeric", month: "short" });
  const shown = hover !== null ? daily[hover] : null;

  return (
    <div style={card} data-testid="daily-sales">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Sales per day</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)", minHeight: 16 }} aria-live="polite">
          {shown ? `${label(shown.date)}: ${money(shown.revenue)} · ${shown.orders} order${shown.orders === 1 ? "" : "s"}` : "Hover a day for details"}
        </span>
      </div>
      {max === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No sales in this period yet.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" preserveAspectRatio="none"
          aria-label={`Sales per day, highest ${money(max)}`} onMouseLeave={() => setHover(null)}>
          <line x1={0} x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke="var(--border)" strokeWidth={1} />
          {daily.map((d, i) => {
            const bh = h(d.revenue);
            const x = i * step + (step - barW) / 2;
            const y = H - PAD_B - bh;
            return (
              <g key={d.date} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}
                aria-label={`${label(d.date)}: ${money(d.revenue)}, ${d.orders} orders`}>
                {/* hit target: the whole column, bigger than the bar */}
                <rect x={i * step} y={0} width={step} height={H - PAD_B} fill="transparent" />
                {bh > 0 && (
                  <path
                    d={`M${x},${H - PAD_B} V${y + Math.min(4, bh)} Q${x},${y} ${x + Math.min(4, barW / 2)},${y} H${x + barW - Math.min(4, barW / 2)} Q${x + barW},${y} ${x + barW},${y + Math.min(4, bh)} V${H - PAD_B} Z`}
                    fill="var(--info)" opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                )}
              </g>
            );
          })}
          {[0, daily.length - 1].map((i) => daily[i] && (
            <text key={i} x={i === 0 ? 0 : W} y={H - 4} fontSize={11} fill="var(--text-muted)" textAnchor={i === 0 ? "start" : "end"}>
              {label(daily[i].date)}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

const VERBS: Record<string, string> = {
  "product.created": "added a product", "product.updated": "edited a product", "product.price_changed": "changed a price",
  "product.deleted": "deleted a product", "order.accepted": "accepted an order", "order.rejected": "rejected an order",
  "order.status_changed": "updated an order", "order.driver_assigned": "assigned a driver",
  "order.driver_unassigned": "unassigned a driver", "product.variants_changed": "changed product options",
  "product.image_added": "added a product photo", "product.image_removed": "removed a product photo",
  "driver.added": "added a driver", "driver.updated": "edited a driver",
  "promotion.created": "created a promotion", "promotion.updated": "edited a promotion", "promotion.deleted": "deleted a promotion",
  "coupon.created": "created a coupon", "coupon.updated": "edited a coupon", "coupon.granted": "gave out a coupon",
  "collection.created": "created a collection", "collection.updated": "edited a collection",
  "collection.products_changed": "changed a collection's products", "collection.deleted": "deleted a collection",
  "shop.profile_updated": "updated the shop profile", "shop.settings_updated": "changed shop settings",
  "payout.account_updated": "changed the payout account",
  "staff.added": "added a team member", "staff.updated": "edited a team member", "staff.role_changed": "changed a role",
  "staff.deactivated": "deactivated a team member", "staff.reactivated": "reactivated a team member", "staff.removed": "removed a team member",
  "account.login": "signed in", "account.logout": "signed out",
};

function describe(action: string): string {
  return VERBS[action] || action.replace(/[._]/g, " ");
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
