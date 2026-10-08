"use client";

import { formatDate, formatMoney, maskAccount, type Earning, type Payout } from "@/lib/settlements";
import { StatusPill, Table, type Column } from "./ui";

export function EarningsTable({ rows, loading, empty }: { rows: Earning[]; loading?: boolean; empty?: string }) {
  const columns: Column<Earning>[] = [
    {
      key: "order",
      header: "Order",
      render: (e) => (
        <div>
          <div className="font-semibold">
            {e.entry_type === "adjustment" ? "Adjustment" : e.order_code ?? (e.order_id ? `#${e.order_id}` : "—")}
          </div>
          {e.entry_type === "adjustment" && e.description && (
            <div className="max-w-[260px] truncate text-[11px] text-text-muted" title={e.description}>{e.description}</div>
          )}
        </div>
      ),
    },
    { key: "date", header: "Paid on", render: (e) => <span className="whitespace-nowrap">{formatDate(e.created_at, false)}</span> },
    { key: "gross", header: "Order total", align: "right", render: (e) => formatMoney(e.gross_amount, e.currency) },
    {
      key: "commission",
      header: "Commission",
      align: "right",
      render: (e) => (
        <span className="text-text-muted">
          {formatMoney(e.commission_amount, e.currency)}
          <span className="ml-1 text-[11px]">({Number(e.commission_rate)}%)</span>
        </span>
      ),
    },
    {
      key: "net",
      header: "You earn",
      align: "right",
      render: (e) => (
        <span className={`font-semibold ${Number(e.net_amount) < 0 ? "text-danger" : ""}`}>
          {formatMoney(e.net_amount, e.currency)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (e) => (
        <div className="flex items-center gap-1.5">
          <StatusPill status={e.status} label={e.status === "ready" && e.payout_id ? "In payout" : undefined} />
          {e.settlement_method === "aba_split" && <StatusPill status="info" tone="info" label="ABA split" />}
        </div>
      ),
    },
  ];
  return <Table columns={columns} rows={rows} rowKey={(e) => e.id} loading={loading} empty={empty ?? "No earnings yet."} />;
}

export function PayoutsTable({ rows, loading, empty, merchantNames, onOpen, showFullAccount }: {
  rows: Payout[];
  loading?: boolean;
  empty?: string;
  merchantNames?: Record<number, string>;
  onOpen?: (p: Payout) => void;
  showFullAccount?: boolean;
}) {
  const columns: Column<Payout>[] = [
    { key: "id", header: "Payout", render: (p) => <span className="font-semibold">#{p.id}</span> },
    ...(merchantNames
      ? [{ key: "merchant", header: "Merchant", render: (p: Payout) => merchantNames[p.merchant_id] ?? `#${p.merchant_id}` }]
      : []),
    { key: "created", header: "Created", render: (p) => <span className="whitespace-nowrap">{formatDate(p.created_at)}</span> },
    { key: "amount", header: "Amount", align: "right", render: (p) => <span className="font-semibold">{formatMoney(p.amount, p.currency)}</span> },
    { key: "orders", header: "Entries", align: "right", render: (p) => p.item_count },
    {
      key: "account",
      header: "To account",
      render: (p) => (
        <div className="whitespace-nowrap">
          <div className="font-mono text-xs">{showFullAccount ? p.aba_account ?? "—" : maskAccount(p.aba_account)}</div>
          {p.aba_account_name && <div className="text-[11px] text-text-muted">{p.aba_account_name}</div>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (p) => (
        <div>
          <StatusPill status={p.status} />
          {p.status === "paid" && p.reference && <div className="mt-0.5 font-mono text-[11px] text-text-muted">Ref {p.reference}</div>}
          {(p.status === "failed" || p.status === "cancelled") && p.failure_reason && (
            <div className="mt-0.5 max-w-[200px] truncate text-[11px] text-danger" title={p.failure_reason}>{p.failure_reason}</div>
          )}
          {p.status === "reversed" && p.reversal_reason && (
            <div className="mt-0.5 max-w-[200px] truncate text-[11px] text-warning" title={p.reversal_reason}>{p.reversal_reason}</div>
          )}
        </div>
      ),
    },
    { key: "paid", header: "Paid on", render: (p) => <span className="whitespace-nowrap">{formatDate(p.paid_at)}</span> },
  ];
  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(p) => p.id}
      loading={loading}
      empty={empty ?? "No payouts yet."}
      onRowClick={onOpen}
    />
  );
}
