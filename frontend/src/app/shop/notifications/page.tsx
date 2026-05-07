"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { LoginGate } from "@/components/shop/LoginGate";
import { api } from "@/lib/api";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { Notification } from "@/types";

export default function ShopNotificationsPage() {
  const { user } = useAuth();

  if (!user) return <LoginGate><div /></LoginGate>;
  return <NotificationsContent />;
}

function NotificationsContent() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try { setNotifications(await api.get<Notification[]>("/notifications")); }
    catch { /* user might not have notifications */ }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);
  useAutoRefresh(load, { interval: 15000 });

  async function markRead(id: number) {
    await api.patch(`/notifications/${id}/read`);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  }

  const unread = notifications.filter(n => !n.is_read).length;

  const typeIcon: Record<string, string> = { promo: "🏷️", order: "📦", system: "⚙️", loyalty: "⭐" };
  const typeColor: Record<string, string> = {
    promo: "#F59E0B",
    order: "var(--shop-primary, #1E6BFF)",
    system: "var(--shop-muted, #8A8F9C)",
    loyalty: "#F59E0B",
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg, #F7F8FB)" }}>
      {/* Top Bar */}
      <div style={{
        height: 56, display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "var(--shop-surface, #FFFFFF)", borderBottom: "1px solid var(--shop-divider, #ECEEF3)",
        padding: "0 16px", position: "sticky", top: 0, zIndex: 10,
      }}>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", margin: 0 }}>
          Notifications
        </h1>
        {unread > 0 && (
          <span style={{
            background: "#C62828", color: "#FFFFFF",
            fontSize: 11, fontWeight: 700, padding: "3px 10px",
            borderRadius: "var(--shop-r-pill, 999px)",
          }}>
            {unread} new
          </span>
        )}
      </div>

      <div style={{ padding: "8px 16px 80px" }}>
        {loading ? (
          <div style={{ paddingTop: 8 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{
                height: 80, background: "var(--shop-divider, #ECEEF3)",
                borderRadius: "var(--shop-r-card, 16px)", marginBottom: 8,
                animation: "pulse 1.5s infinite",
              }} />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div style={{ textAlign: "center", paddingTop: 80 }}>
            <div style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "var(--shop-primary-tint, #E8F0FF)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, margin: "0 auto 16px",
            }}>&#128276;</div>
            <p style={{ color: "var(--shop-muted, #8A8F9C)", fontSize: 14 }}>No notifications yet</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {notifications.map(n => {
              const isUnread = !n.is_read;
              return (
                <button
                  key={n.id}
                  onClick={() => isUnread && markRead(n.id)}
                  style={{
                    width: "100%", textAlign: "left", padding: "14px 12px",
                    background: isUnread ? "var(--shop-primary-tint, #E8F0FF)" : "transparent",
                    borderLeft: isUnread ? "3px solid var(--shop-primary, #1E6BFF)" : "3px solid transparent",
                    borderRight: "none", borderTop: "none",
                    borderBottom: isUnread ? "none" : "1px solid var(--shop-divider, #ECEEF3)",
                    cursor: isUnread ? "pointer" : "default",
                    display: "flex", gap: 12, alignItems: "flex-start",
                    transition: "background 0.2s",
                  }}
                >
                  {/* Icon circle */}
                  <div style={{
                    width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                    background: isUnread
                      ? "var(--shop-surface, #FFFFFF)"
                      : "var(--shop-bg, #F7F8FB)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 20,
                    border: isUnread
                      ? `2px solid var(--shop-primary, #1E6BFF)`
                      : "1px solid var(--shop-divider, #ECEEF3)",
                  }}>
                    {typeIcon[n.type] || "📋"}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3 }}>
                      <p style={{
                        fontSize: 14, fontWeight: 700,
                        color: "var(--shop-black, #0B0B0F)", margin: 0,
                      }}>{n.title}</p>
                      {isUnread && (
                        <span style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: "var(--shop-primary, #1E6BFF)",
                          flexShrink: 0, marginTop: 5, marginLeft: 8,
                        }} />
                      )}
                    </div>
                    <p style={{
                      fontSize: 13, color: "var(--shop-text, #4A4E5A)", margin: 0,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{n.body}</p>
                    {n.sent_at && (
                      <p style={{
                        fontSize: 11, color: "var(--shop-muted, #8A8F9C)", marginTop: 4, margin: "4px 0 0",
                      }}>
                        {new Date(n.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}
