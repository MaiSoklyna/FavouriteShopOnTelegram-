"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { groupByDay, mergeNotifications, timeLabel } from "@/lib/notifications";
import type { Notification } from "@/types";
import { BrandLoader } from "@/components/ui/Spinner";

const PAGE = 30;

const KIND_EMOJI: Record<string, string> = {
  new_order: "🛍️", order_cancelled: "⚠️", payout: "💸", low_stock: "📦", review: "⭐", system: "⚙️",
};

/** A shop's inbox: new and cancelled orders, payouts. Tapping one opens what it is about. */
export default function InboxPage() {
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await api.get<Notification[]>("/notifications/merchant", { params: { limit: PAGE } });
      setItems((cur) => mergeNotifications(cur, rows));
      setMore((cur) => cur || rows.length >= PAGE);
    } catch { /* not a shop account, or offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, { interval: 15000 });

  async function loadMore() {
    const oldest = items[items.length - 1]?.id;
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const rows = await api.get<Notification[]>("/notifications/merchant", { params: { limit: PAGE, before: oldest } });
      setItems((cur) => mergeNotifications(cur, rows));
      setMore(rows.length >= PAGE);
    } catch { /* keep what is shown */ }
    finally { setLoadingMore(false); }
  }

  function open(n: Notification) {
    if (!n.is_read) {
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      api.patch(`/notifications/merchant/${n.id}/read`).catch(() => {});
    }
    if (n.link) router.push(n.link);
  }

  function markAllRead() {
    setItems((cur) => cur.map((x) => ({ ...x, is_read: true })));
    api.post("/notifications/merchant/read-all").catch(() => {});
  }

  const unread = items.filter((n) => !n.is_read).length;
  const sections = useMemo(() => groupByDay(items), [items]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Inbox</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{unread > 0 ? `${unread} unread` : "You're all caught up"}</p>
        </div>
        {unread > 0 && <button className="btn-outline" onClick={markAllRead}>Mark all read</button>}
      </div>

      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? <BrandLoader /> : items.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
            Nothing yet. New orders, cancellations and payouts will show up here.
          </div>
        ) : sections.map((section) => (
          <section key={section.label}>
            <div style={{ padding: "10px 16px", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted)", background: "var(--bg)" }}>
              {section.label}
            </div>
            {section.items.map((n) => (
              <button key={n.id} type="button" onClick={() => open(n)} data-unread={!n.is_read} style={{
                width: "100%", textAlign: "left", display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px",
                background: n.is_read ? "transparent" : "rgba(214, 186, 128, 0.12)", border: "none",
                borderBottom: "1px solid var(--border, rgba(0,0,0,0.06))", cursor: n.link || !n.is_read ? "pointer" : "default",
              }}>
                <span style={{ fontSize: 20, lineHeight: "24px" }}>{KIND_EMOJI[n.kind ?? ""] ?? "🔔"}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: n.is_read ? 500 : 700, fontSize: 14, color: "var(--text)" }}>{n.title}</span>
                  <span style={{ display: "block", fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{n.body}</span>
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{timeLabel(n.sent_at)}</span>
              </button>
            ))}
          </section>
        ))}
      </div>
      {more && (
        <button className="btn-outline" style={{ display: "block", margin: "16px auto" }} onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Show older"}
        </button>
      )}
    </div>
  );
}
