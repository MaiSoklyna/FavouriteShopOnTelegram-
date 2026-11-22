"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { LoginGate } from "@/components/shop/LoginGate";
import { api } from "@/lib/api";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import {
  NOTIFICATION_TABS, groupByDay, mergeNotifications, notificationIcon, notificationLink, timeLabel,
  type NotificationTab,
} from "@/lib/notifications";
import type { Notification } from "@/types";
import { Icon } from "@/components/shop/Icon";

const PAGE = 30;

export default function ShopNotificationsPage() {
  const { user } = useAuth();

  if (!user) return <LoginGate><div /></LoginGate>;
  return <NotificationsContent />;
}

function NotificationsContent() {
  const router = useRouter();
  const [tab, setTab] = useState<NotificationTab>("all");
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [more, setMore] = useState(false);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const group = NOTIFICATION_TABS.find((t) => t.key === tab)?.group ?? null;

  const loadFirst = useCallback(async () => {
    const asked = tabRef.current;
    const g = NOTIFICATION_TABS.find((t) => t.key === asked)?.group;
    try {
      const rows = await api.get<Notification[]>("/notifications", { params: { limit: PAGE, ...(g ? { group: g } : {}) } });
      if (tabRef.current !== asked) return; // the tab changed while this was loading
      setItems((cur) => mergeNotifications(cur, rows));
      // only the first page decides whether there is more; a refresh must not reset a loaded list's "more"
      setMore((cur) => cur || rows.length >= PAGE);
    } catch { /* not signed in yet, or offline */ }
    // A stale answer for a tab we already left must not end the new tab's loading state
    finally { if (tabRef.current === asked) setLoading(false); }
  }, []);

  // A new tab starts from scratch
  useEffect(() => {
    setItems([]); setMore(false); setLoading(true);
    loadFirst();
  }, [tab, loadFirst]);
  useAutoRefresh(loadFirst, { interval: 15000 });

  async function loadMore() {
    const oldest = items[items.length - 1]?.id;
    if (!oldest) return;
    const asked = tabRef.current;
    setLoadingMore(true);
    try {
      const rows = await api.get<Notification[]>("/notifications", { params: { limit: PAGE, before: oldest, ...(group ? { group } : {}) } });
      if (tabRef.current !== asked) return; // switched tab meanwhile: these older rows belong to the other tab
      setItems((cur) => mergeNotifications(cur, rows));
      setMore(rows.length >= PAGE);
    } catch { /* keep what is shown */ }
    finally { setLoadingMore(false); }
  }

  async function open(n: Notification) {
    if (!n.is_read) {
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, is_read: true } : x))); // instant
      api.patch(`/notifications/${n.id}/read`).catch(() => {});
    }
    const href = notificationLink(n);
    if (href) router.push(href);
  }

  async function markAllRead() {
    setItems((cur) => cur.map((x) => ({ ...x, is_read: true })));
    api.post("/notifications/read-all").catch(() => {});
  }

  const unread = items.filter((n) => !n.is_read).length;
  const sections = useMemo(() => groupByDay(items), [items]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg, #F7F8FB)" }}>
      {/* Top Bar */}
      <div style={{
        background: "var(--shop-surface, #FFFFFF)", borderBottom: "1px solid var(--shop-divider, #ECEEF3)",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px" }}>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", margin: 0 }}>Notifications</h1>
          {unread > 0 && (
            <button type="button" onClick={markAllRead} style={{
              background: "none", border: "none", cursor: "pointer", color: "var(--fos-brand)",
              fontSize: 13, fontWeight: 700, padding: "6px 0",
            }}>
              Mark all read · {unread}
            </button>
          )}
        </div>
        <div role="tablist" aria-label="Notification types" style={{ display: "flex", gap: 8, padding: "0 16px 10px", overflowX: "auto" }}>
          {NOTIFICATION_TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} style={{
              flexShrink: 0, height: 32, padding: "0 14px", borderRadius: 999, cursor: "pointer", fontSize: 13, fontWeight: 700,
              border: tab === t.key ? "none" : "1.5px solid var(--shop-divider, #ECEEF3)",
              background: tab === t.key ? "var(--fos-brand)" : "var(--shop-surface, #FFFFFF)",
              color: tab === t.key ? "#FFFFFF" : "var(--shop-black, #0B0B0F)",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "8px 16px 80px" }}>
        {loading ? (
          <div style={{ paddingTop: 8 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ height: 80, background: "var(--shop-divider, #ECEEF3)", borderRadius: "var(--shop-r-card, 16px)", marginBottom: 8, animation: "pulse 1.5s infinite" }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", paddingTop: 80 }}>
            <div style={{
              width: 64, height: 64, borderRadius: "50%", background: "var(--fos-brand-tint)", color: "var(--fos-brand)",
              display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
            }}><Icon name="bell" size={28} /></div>
            <p style={{ color: "var(--shop-muted, #8A8F9C)", fontSize: 14 }}>
              {tab === "all" ? "No notifications yet" : `No ${NOTIFICATION_TABS.find((t) => t.key === tab)?.label.toLowerCase()} notifications`}
            </p>
            {tab === "all" && <p style={{ color: "var(--shop-muted, #8A8F9C)", fontSize: 12, marginTop: 4 }}>Order updates will show up here.</p>}
          </div>
        ) : (
          <>
            {sections.map((section) => (
              <section key={section.label} aria-label={section.label}>
                <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--shop-muted, #8A8F9C)", margin: "16px 4px 6px" }}>
                  {section.label}
                </h2>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {section.items.map((n) => {
                    const isUnread = !n.is_read;
                    const hasLink = !!notificationLink(n);
                    return (
                      <button
                        key={n.id} type="button" onClick={() => open(n)} data-unread={isUnread}
                        style={{
                          width: "100%", textAlign: "left", padding: "14px 12px",
                          background: isUnread ? "var(--fos-brand-tint)" : "transparent",
                          borderLeft: isUnread ? "3px solid var(--fos-brand)" : "3px solid transparent",
                          borderRight: "none", borderTop: "none",
                          borderBottom: isUnread ? "none" : "1px solid var(--shop-divider, #ECEEF3)",
                          cursor: isUnread || hasLink ? "pointer" : "default",
                          display: "flex", gap: 12, alignItems: "flex-start", transition: "background 0.2s",
                        }}
                      >
                        <div style={{
                          width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                          background: isUnread ? "var(--shop-surface, #FFFFFF)" : "var(--fos-brand-tint)", color: "var(--fos-brand)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          border: isUnread ? "2px solid var(--fos-brand)" : "1px solid transparent",
                        }}>
                          <Icon name={notificationIcon(n)} size={20} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3 }}>
                            <p style={{ fontSize: 14, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", margin: 0 }}>{n.title}</p>
                            {isUnread && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--fos-brand)", flexShrink: 0, marginTop: 5, marginLeft: 8 }} />}
                          </div>
                          <p style={{ fontSize: 13, color: "var(--shop-text, #4A4E5A)", margin: 0, lineHeight: "18px" }}>{n.body}</p>
                          <p style={{ fontSize: 11, color: "var(--shop-muted, #8A8F9C)", margin: "4px 0 0" }}>{timeLabel(n.sent_at)}</p>
                        </div>
                        {hasLink && <Icon name="chevron" size={16} className="shrink-0 self-center text-ink-500" />}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            {more && (
              <button type="button" onClick={loadMore} disabled={loadingMore} style={{
                display: "block", margin: "16px auto 0", height: 40, padding: "0 20px", borderRadius: 999, cursor: "pointer",
                border: "1.5px solid var(--shop-divider, #ECEEF3)", background: "var(--shop-surface, #FFFFFF)",
                fontSize: 13, fontWeight: 700, color: "var(--shop-black, #0B0B0F)",
              }}>{loadingMore ? "Loading…" : "Show older"}</button>
            )}
          </>
        )}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}
