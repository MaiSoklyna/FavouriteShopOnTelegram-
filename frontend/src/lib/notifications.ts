import type { IconName } from "@/components/shop/Icon";
import type { Notification } from "@/types";

/** The app's tabs; `group` is what GET /notifications?group= expects (null = everything). */
export const NOTIFICATION_TABS = [
  { key: "all", label: "All", group: null },
  { key: "orders", label: "Orders", group: "orders" },
  { key: "promos", label: "Promos", group: "promos" },
  { key: "system", label: "System", group: "system" },
] as const;
export type NotificationTab = (typeof NOTIFICATION_TABS)[number]["key"];

/**
 * Where tapping a notification goes. New notifications carry their own `link`; older ones
 * (before migration 027) only have the order id in ref_id.
 */
export function notificationLink(n: Notification): string | null {
  if (n.link) return n.link;
  if ((n.type === "order_update" || n.type === "order") && n.ref_id) return `/shop/order/${n.ref_id}`;
  return null;
}

const KIND_ICON: Record<string, IconName> = {
  order_placed: "bag", order_paid: "check", order_status: "truck", order_cancelled: "alert",
  review_request: "star", new_order: "bag", payout: "bolt", promo: "tag", loyalty: "trophy", system: "gear",
};
const TYPE_ICON: Record<string, IconName> = { order_update: "box", order: "box", promo: "tag", system: "gear", loyalty: "star" };

export function notificationIcon(n: Notification): IconName {
  return (n.kind && KIND_ICON[n.kind]) || TYPE_ICON[n.type] || "bell";
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Today", "Yesterday", else "Nov 20". */
export function dayLabel(iso?: string, now = new Date()): string {
  if (!iso) return "Earlier";
  const d = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function timeLabel(iso?: string): string {
  return iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
}

/** Group a newest-first list into day sections, keeping the order. */
export function groupByDay(items: Notification[], now = new Date()): { label: string; items: Notification[] }[] {
  const out: { label: string; items: Notification[] }[] = [];
  for (const n of items) {
    const label = dayLabel(n.sent_at, now);
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(n);
    else out.push({ label, items: [n] });
  }
  return out;
}

/** Newer page + what is already shown, one entry per id, newest first. */
export function mergeNotifications(current: Notification[], incoming: Notification[]): Notification[] {
  const byId = new Map<number, Notification>();
  for (const n of current) byId.set(n.id, n);
  for (const n of incoming) byId.set(n.id, { ...byId.get(n.id), ...n });
  return [...byId.values()].sort((a, b) => b.id - a.id);
}
