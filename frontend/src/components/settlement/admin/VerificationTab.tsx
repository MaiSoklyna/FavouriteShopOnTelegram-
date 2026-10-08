"use client";

import { useMemo, useState } from "react";
import { formatMoney, type MerchantBalance, type VerificationStatus } from "@/lib/settlements";
import { BTN, Panel, StatusPill, Table, Tabs, type Column } from "../ui";

type Filter = "pending" | "rejected" | "verified" | "unverified";

export function VerificationTab({ balances, loading, onReview }: {
  balances: MerchantBalance[];
  loading: boolean;
  onReview: (m: MerchantBalance) => void;
}) {
  const [filter, setFilter] = useState<Filter>("pending");

  // One row per merchant (balances can have a row per currency)
  const merchants = useMemo(() => {
    const seen = new Map<number, MerchantBalance>();
    for (const b of balances) if (!seen.has(b.merchant_id)) seen.set(b.merchant_id, b);
    return Array.from(seen.values());
  }, [balances]);

  const counts = useMemo(() => {
    const c: Record<VerificationStatus, number> = { pending: 0, rejected: 0, verified: 0, unverified: 0 };
    for (const m of merchants) c[(m.payout_verification_status ?? "unverified") as VerificationStatus]++;
    return c;
  }, [merchants]);

  const rows = merchants
    .filter((m) => (m.payout_verification_status ?? "unverified") === filter)
    .sort((a, b) => Number(b.owed_amount) - Number(a.owed_amount));

  const columns: Column<MerchantBalance>[] = [
    { key: "merchant", header: "Merchant", render: (m) => <span className="font-semibold">{m.merchant_name ?? `#${m.merchant_id}`}</span> },
    {
      key: "account",
      header: "Account",
      render: (m) => (
        <div>
          <div className="font-mono text-xs">{m.aba_account_masked ?? "—"}</div>
          {m.aba_account_name && <div className="text-[11px] text-text-muted">{m.aba_account_name}</div>}
        </div>
      ),
    },
    { key: "status", header: "Status", render: (m) => <StatusPill status={m.payout_verification_status ?? "unverified"} /> },
    { key: "split", header: "ABA split", render: (m) => (m.payout_enabled ? <StatusPill status="on" tone="success" label="On" /> : <span className="text-text-muted">Off</span>) },
    { key: "owed", header: "Owed", align: "right", render: (m) => formatMoney(m.owed_amount, m.currency) },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (m) => (
        <button className={filter === "pending" ? BTN.primarySm : BTN.outlineSm} onClick={() => onReview(m)}>
          {filter === "pending" ? "Review" : "Open"}
        </button>
      ),
    },
  ];

  return (
    <Panel
      title="ABA account verification"
      subtitle="Confirm each payout account belongs to the shop owner before any money is sent. A merchant changing their account sends it back here."
    >
      <div className="px-4 pt-2">
        <Tabs<Filter>
          tabs={[
            { key: "pending", label: "Awaiting review", count: counts.pending },
            { key: "rejected", label: "Rejected", count: counts.rejected },
            { key: "verified", label: "Verified", count: counts.verified },
            { key: "unverified", label: "No account", count: counts.unverified },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(m) => m.merchant_id}
        loading={loading}
        empty={filter === "pending" ? "No accounts waiting for review." : "None."}
      />
    </Panel>
  );
}
