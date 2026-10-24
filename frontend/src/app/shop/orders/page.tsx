"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { LoginGate } from "@/components/shop/LoginGate";
import type { Order } from "@/types";
import { Icon } from "@/components/shop/Icon";
import { EmptyState, OrderProgress, Pill, Skeleton } from "@/components/shop";
import { ACTIVE_STATUSES, awaitingPayment, formatWhen, headline, statusLabel } from "@/lib/orderStatus";
import { formatKhr } from "@/lib/currency";

interface ShopBrief { id: number; name: string; logo_url?: string | null; icon_emoji?: string | null }

const TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const inTab = (o: Order, tab: Tab) =>
  tab === "active" ? ACTIVE_STATUSES.includes(o.status)
    : tab === "completed" ? o.status === "delivered"
      : tab === "cancelled" ? o.status === "cancelled"
        : true;

export default function OrdersPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [shops, setShops] = useState<Record<number, ShopBrief>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");

  const fetchOrders = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try { setOrders(await api.get<Order[]>("/orders")); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useAutoRefresh(fetchOrders, { interval: 15000, enabled: !!user });

  // The order list carries only merchant_id — names and logos come from the public shop list
  useEffect(() => {
    api.get<ShopBrief[]>("/merchants")
      .then((rows) => setShops(Object.fromEntries(rows.map((m) => [m.id, m]))))
      .catch(() => {});
  }, []);

  if (!user) return <LoginGate><div /></LoginGate>;

  const filtered = orders.filter((o) => inTab(o, tab));
  const activeCount = orders.filter((o) => inTab(o, "active")).length;

  return (
    <div className="min-h-screen bg-surface">
      <div className="px-gutter pb-[110px] pt-6">
        <div className="flex items-baseline gap-2">
          <h1 className="text-display text-ink-900">Orders</h1>
          {activeCount > 0 && <span className="text-caption text-ink-500">{activeCount} active</span>}
        </div>

        <div className="fos-no-scrollbar -mx-gutter mt-4 flex gap-2 overflow-x-auto px-gutter" role="tablist">
          {TABS.map((t) => {
            const on = tab === t.key;
            const n = orders.filter((o) => inTab(o, t.key)).length;
            return (
              <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)}
                className={`fos-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-extrabold transition-colors ${
                  on ? "bg-navy-700 text-white shadow-fos-cta" : "bg-white text-ink-500 shadow-fos-sm"}`}>
                {t.label}
                <span className={`min-w-[20px] rounded-full px-1.5 text-[11px] tabular-nums ${on ? "bg-white/20" : "bg-surface"}`}>{n}</span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="mt-4 flex flex-col gap-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-[132px] rounded-hero" />)}
          </div>
        ) : filtered.length > 0 ? (
          <div className="mt-4 flex flex-col gap-3">
            {filtered.map((order) => <OrderCard key={order.id} order={order} shop={shops[order.merchant_id]} />)}
          </div>
        ) : orders.length === 0 ? (
          <EmptyState className="mt-6" title="No orders yet" action={{ label: "Start shopping", href: "/shop" }} />
        ) : (
          <p className="mt-16 text-center text-[14px] font-bold text-ink-500">Nothing here yet</p>
        )}
      </div>
    </div>
  );
}

function OrderCard({ order, shop }: { order: Order; shop?: ShopBrief }) {
  const name = shop?.name || order.merchant_name || "Shop";
  const track = { ...order, merchant_name: name };
  const active = ACTIVE_STATUSES.includes(order.status);
  const unpaid = awaitingPayment(order);
  const cancelled = order.status === "cancelled";
  const h = headline(track);

  return (
    <Link href={`/shop/order/${order.id}`} className="fos-press block rounded-hero bg-white p-3.5 shadow-fos-sm">
      <div className="flex items-center gap-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-surface text-[16px]">
          {shop?.logo_url
            ? <img src={shop.logo_url} alt="" className="h-full w-full object-cover" />
            : shop?.icon_emoji || <span className="text-[14px] font-extrabold text-navy-700">{name[0]?.toUpperCase()}</span>}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-extrabold text-ink-900">{name}</div>
          <div className="truncate text-caption text-ink-500">{order.order_code} · {formatWhen(order.created_at)}</div>
        </div>
        <Pill variant={cancelled ? "neutral" : order.status === "delivered" ? "jade" : "mango"} className={cancelled ? "!bg-[#FDECEC] !text-ruby-500" : ""}>
          {statusLabel(order)}
        </Pill>
      </div>

      {active && (
        <div className="mt-3 rounded-thumb bg-surface p-2.5">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-extrabold text-ink-900">
            <Icon name={h.icon} size={16} className={unpaid ? "text-[#B54708]" : "text-navy-700"} strokeWidth={2} />
            <span className="truncate">{h.title}</span>
          </div>
          <OrderProgress order={track} />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span>
          <span className="text-[17px] font-extrabold tabular-nums text-ink-900">${Number(order.total).toFixed(2)}</span>
          <span className="ml-1.5 text-caption tabular-nums text-ink-500">{formatKhr(Number(order.total))}</span>
        </span>
        {unpaid ? (
          <span className="inline-flex h-8 items-center rounded-full bg-grad-promo px-3.5 text-[12px] font-extrabold text-white">Pay now</span>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-[13px] font-extrabold text-navy-700">
            {active ? "Track" : "Details"}<Icon name="chevron" size={16} />
          </span>
        )}
      </div>
    </Link>
  );
}
