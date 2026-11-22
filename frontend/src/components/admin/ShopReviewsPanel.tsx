"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import type { ShopReview, ShopReviewSummary } from "@/types";
import { BrandLoader } from "@/components/ui/Spinner";

const stars = (n: number) => (
  <span aria-label={`${n} out of 5`} style={{ letterSpacing: 1 }}>
    {[1, 2, 3, 4, 5].map((i) => <span key={i} style={{ color: i <= n ? "var(--warning)" : "var(--border)" }}>★</span>)}
  </span>
);

/** The rating, the spread of stars and the latest reviews. Shared by the dashboard card and the Reviews page. */
export function RatingSummary({ summary }: { summary: ShopReviewSummary }) {
  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ textAlign: "center", minWidth: 96 }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>{summary.rating != null ? summary.rating.toFixed(1) : "—"}</div>
        <div style={{ margin: "4px 0" }}>{stars(Math.round(summary.rating ?? 0))}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{summary.count} review{summary.count === 1 ? "" : "s"}</div>
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        {["5", "4", "3", "2", "1"].map((s) => {
          const n = summary.distribution[s] ?? 0;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)", marginBottom: 3 }}>
              <span style={{ width: 10, textAlign: "right" }}>{s}</span>
              <span style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--bg-secondary)", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${summary.count ? (n / summary.count) * 100 : 0}%`, background: "var(--warning)" }} />
              </span>
              <span style={{ width: 22 }}>{n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Shop reviews for the admin: a shop sees its own (read-only); the platform sees all and can hide abusive ones. */
export function ShopReviewsPanel() {
  const { isSuperAdmin } = useAuth();
  const [summary, setSummary] = useState<ShopReviewSummary | null>(null);
  const [rows, setRows] = useState<ShopReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);

  const load = useCallback(async (before?: number) => {
    try {
      if (isSuperAdmin) {
        const r = await api.get<{ data: ShopReview[] }>("/shop-reviews/admin/list", { params: { limit: 30, ...(before ? { before } : {}) } });
        setRows((cur) => (before ? [...cur, ...r.data] : r.data)); setMore(r.data.length >= 30);
      } else {
        if (!before) setSummary((await api.get<{ summary: ShopReviewSummary }>("/shop-reviews/merchant/summary")).summary);
        const r = await api.get<{ data: ShopReview[] }>("/shop-reviews/merchant/list", { params: { limit: 20, ...(before ? { before } : {}) } });
        setRows((cur) => (before ? [...cur, ...r.data] : r.data)); setMore(r.data.length >= 20);
      }
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, [isSuperAdmin]);
  useEffect(() => { load(); }, [load]);

  async function toggle(r: ShopReview) {
    const next = !r.is_visible;
    setRows((cur) => cur.map((x) => (x.id === r.id ? { ...x, is_visible: next } : x)));
    try { await api.patch(`/shop-reviews/admin/${r.id}/visibility`, { is_visible: next }); }
    catch { setRows((cur) => cur.map((x) => (x.id === r.id ? { ...x, is_visible: !next } : x))); }
  }

  return (
    <div>
      {summary && <div className="admin-card" style={{ marginBottom: 16 }}><RatingSummary summary={summary} /></div>}
      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? <BrandLoader /> : rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No shop reviews yet. They appear once customers rate a delivered order.</div>
        ) : rows.map((r) => (
          <div key={r.id} data-testid={`shop-review-${r.id}`} style={{ display: "flex", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--border)", opacity: r.is_visible === false ? 0.55 : 1 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {stars(r.rating)}
                <strong style={{ fontSize: 13 }}>{r.reviewer}</strong>
                {isSuperAdmin && r.shop_name && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· {r.shop_name}</span>}
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}</span>
                {r.is_visible === false && <span className="badge badge-cancelled">Hidden</span>}
              </div>
              {r.comment && <p style={{ fontSize: 13, color: "var(--text)", marginTop: 4 }}>{r.comment}</p>}
            </div>
            {isSuperAdmin && (
              <button className={r.is_visible === false ? "btn-primary" : "btn-outline"} onClick={() => toggle(r)}>
                {r.is_visible === false ? "Show" : "Hide"}
              </button>
            )}
          </div>
        ))}
      </div>
      {more && rows.length > 0 && (
        <button className="btn-outline" style={{ display: "block", margin: "16px auto" }} onClick={() => load(rows[rows.length - 1].id)}>Show older</button>
      )}
    </div>
  );
}
