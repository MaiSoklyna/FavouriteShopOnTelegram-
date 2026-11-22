"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";

interface Summary {
  setup_needed: boolean;
  days: number;
  totals: { product_view: number; shop_view: number; search: number; add_to_cart: number; order_placed: number };
  funnel: { viewed: number; carted: number; ordered: number; view_to_cart_pct: number | null; cart_to_order_pct: number | null };
  daily: ({ date: string } & Summary["totals"])[];
  top_products: { product_id: number; name: string; views: number; carts: number; cart_rate_pct: number | null }[];
  top_searches: { query: string; searches: number; no_results: number }[];
}

const pct = (n: number | null) => (n === null ? "–" : `${n}%`);
const tick = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * What customers did: looks, searches, add to cart, orders, and where people drop off.
 * A shop sees its own customers; the platform sees everything (and what people search for).
 */
export function ActivityPanel({ days, showSearches }: { days: number; showSearches: boolean }) {
  const [data, setData] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null); setFailed(false);
    api.get<Summary>("/activity/summary", { params: { days } })
      .then((r) => { if (live) setData(r); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [days]);

  const box = { marginBottom: 24 } as const;
  if (failed) return <div className="admin-card" style={box}><p style={{ fontSize: 13, color: "var(--text-muted)" }}>Customer activity could not be loaded.</p></div>;
  if (!data) return <div className="admin-card" style={{ ...box, height: 120, opacity: 0.5 }} />;
  if (data.setup_needed) {
    return <div className="admin-card" style={box}><p style={{ fontSize: 13, color: "var(--text-muted)" }}>Activity tracking needs <code>supabase/migrations/033_activity_events.sql</code> to be run first.</p></div>;
  }

  const t = data.totals;
  const f = data.funnel;
  const cards: [string, number][] = [["Product views", t.product_view], ["Shop views", t.shop_view], ["Searches", t.search], ["Added to cart", t.add_to_cart], ["Orders placed", t.order_placed]];
  const stages: [string, number, string | null][] = [["Looked around", f.viewed, null], ["Added to cart", f.carted, pct(f.view_to_cart_pct)], ["Ordered", f.ordered, pct(f.cart_to_order_pct)]];
  const quiet = cards.every(([, n]) => n === 0);

  return (
    <div data-testid="activity" style={box}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Customer activity · last {data.days} days</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
        {cards.map(([label, n]) => (
          <div key={label} className="admin-card"><p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</p><p style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{n.toLocaleString()}</p></div>
        ))}
      </div>

      {quiet ? (
        <div className="admin-card"><p style={{ fontSize: 13, color: "var(--text-muted)" }}>No customer activity yet. It appears here as customers browse, search and shop.</p></div>
      ) : (
        <>
          <div className="admin-card" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Where customers drop off</h3>
            {stages.map(([label, n, rate], i) => (
              <div key={label} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: "var(--text)" }}>{label}</span>
                  <span style={{ color: "var(--text-muted)" }}>{n.toLocaleString()} {i > 0 && rate !== null ? `· ${rate} of the step before` : ""}</span>
                </div>
                <div style={{ height: 10, borderRadius: 6, background: "var(--bg-secondary)" }}>
                  <div style={{ height: 10, borderRadius: 6, background: "var(--info, #3B82F6)", width: `${f.viewed ? Math.max(n ? 2 : 0, (n / f.viewed) * 100) : 0}%` }} />
                </div>
              </div>
            ))}
            <p style={{ fontSize: 11, color: "var(--text-muted)" }}>Counted per customer (or per browser when signed out).</p>
          </div>

          <div className="admin-card" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Activity per day</h3>
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <LineChart data={data.daily} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={tick} interval={Math.max(0, Math.ceil(data.daily.length / 6) - 1)} stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} stroke="var(--text-muted)" tick={{ fontSize: 11 }} width={32} />
                  <Tooltip labelFormatter={(l) => tick(String(l))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="product_view" name="Product views" stroke="#3B82F6" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="add_to_cart" name="Added to cart" stroke="#F59E0B" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="order_placed" name="Orders" stroke="#22C55E" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
            <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", padding: "14px 16px 6px" }}>Most viewed products</h3>
              <table className="admin-table">
                <thead><tr><th>Product</th><th>Views</th><th>Carts</th><th>Cart rate</th></tr></thead>
                <tbody>
                  {data.top_products.length === 0 ? <tr><td colSpan={4} style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>No product views yet</td></tr> :
                    data.top_products.map((p) => <tr key={p.product_id}><td>{p.name}</td><td>{p.views}</td><td>{p.carts}</td><td>{pct(p.cart_rate_pct)}</td></tr>)}
                </tbody>
              </table>
            </div>
            {showSearches && (
              <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", padding: "14px 16px 6px" }}>What people search for</h3>
                <table className="admin-table">
                  <thead><tr><th>Search</th><th>Times</th><th>Found nothing</th></tr></thead>
                  <tbody>
                    {data.top_searches.length === 0 ? <tr><td colSpan={3} style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>No searches yet</td></tr> :
                      data.top_searches.map((s) => (
                        <tr key={s.query}><td>{s.query}</td><td>{s.searches}</td>
                          <td style={{ color: s.no_results ? "var(--danger)" : "var(--text-muted)", fontWeight: s.no_results ? 600 : 400 }}>{s.no_results}</td></tr>))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
