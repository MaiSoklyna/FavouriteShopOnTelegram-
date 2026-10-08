"use client";

import { useMemo, useState } from "react";
import { downloadCsv, formatDate, formatMoney, isNonZero, type MerchantBalance } from "@/lib/settlements";
import { BTN, Panel, StatusPill, Table, INPUT, type Column } from "../ui";

export function BalancesTab({ balances, loading, onPay, onManage, onBackfill, backfilling }: {
  balances: MerchantBalance[];
  loading: boolean;
  onPay: (m: MerchantBalance) => void;
  onManage: (m: MerchantBalance) => void;
  onBackfill: () => void;
  backfilling: boolean;
}) {
  const [activeOnly, setActiveOnly] = useState(true);
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return balances
      // Any QR sales ever — keeps fully paid-out merchants visible
      .filter((b) => !activeOnly || isNonZero(b.gross_total) || isNonZero(b.owed_amount) || isNonZero(b.pending_amount))
      .filter((b) => !q || (b.merchant_name ?? "").toLowerCase().includes(q) || String(b.merchant_id) === q)
      .sort((a, b) => Number(b.owed_amount) - Number(a.owed_amount));
  }, [balances, activeOnly, search]);

  const columns: Column<MerchantBalance>[] = [
    {
      key: "merchant",
      header: "Merchant",
      render: (b) => (
        <div>
          <div className="font-semibold">{b.merchant_name ?? `#${b.merchant_id}`}</div>
          <div className="text-[11px] text-text-muted">
            {b.last_earning_at ? `Last sale ${formatDate(b.last_earning_at, false)}` : "No QR sales"}
          </div>
        </div>
      ),
    },
    {
      key: "account",
      header: "ABA account",
      render: (b) => (
        <div className="flex flex-col items-start gap-1">
          <StatusPill status={b.payout_verification_status ?? "unverified"} />
          {b.aba_account_masked && <span className="font-mono text-[11px] text-text-muted">{b.aba_account_masked}</span>}
        </div>
      ),
    },
    { key: "pending", header: "Pending", align: "right", render: (b) => <span className="text-warning">{formatMoney(b.pending_amount, b.currency)}</span> },
    { key: "available", header: "Available", align: "right", render: (b) => <span className="font-semibold text-success">{formatMoney(b.available_amount, b.currency)}</span> },
    { key: "in_payout", header: "In payout", align: "right", render: (b) => formatMoney(b.in_payout_amount, b.currency) },
    { key: "owed", header: "Owed", align: "right", render: (b) => <span className="font-bold">{formatMoney(b.owed_amount, b.currency)}</span> },
    { key: "paid", header: "Paid", align: "right", render: (b) => <span className="text-text-muted">{formatMoney(b.paid_amount, b.currency)}</span> },
    { key: "commission", header: "Commission", align: "right", render: (b) => <span className="text-text-muted">{formatMoney(b.commission_total, b.currency)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (b) => {
        const canPay = b.payout_verification_status === "verified" && Number(b.available_amount) > 0;
        return (
          <div className="flex justify-end gap-1.5">
            <button className={BTN.outlineSm} onClick={() => onManage(b)}>Account</button>
            <button
              className={BTN.primarySm}
              disabled={!canPay}
              onClick={() => onPay(b)}
              title={
                b.payout_verification_status !== "verified" ? "Verify the ABA account first"
                  : Number(b.available_amount) <= 0 ? "Nothing available to pay" : undefined
              }
            >
              Pay
            </button>
          </div>
        );
      },
    },
  ];

  function exportCsv() {
    downloadCsv(
      `merchant-balances-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Merchant ID", "Merchant", "Currency", "Verification", "Pending", "Available", "In payout", "Owed", "Paid", "Gross sales", "Commission"],
      rows.map((b) => [
        b.merchant_id, b.merchant_name, b.currency, b.payout_verification_status,
        b.pending_amount, b.available_amount, b.in_payout_amount, b.owed_amount,
        b.paid_amount, b.gross_total, b.commission_total,
      ]),
    );
  }

  return (
    <Panel
      title="Merchant balances"
      subtitle="Owed = available + in payout. Pending becomes available when the order is delivered."
      actions={
        <>
          <input className={`${INPUT} w-44 py-1.5 text-xs`} placeholder="Search merchant" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> With sales only
          </label>
          <button className={BTN.outlineSm} onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
          <button
            className={BTN.outlineSm}
            onClick={onBackfill}
            disabled={backfilling}
            title="Record earnings for QR orders paid before the ledger existed, or whose recording failed"
          >
            {backfilling ? "Syncing…" : "Sync paid orders"}
          </button>
        </>
      }
    >
      <Table
        columns={columns}
        rows={rows}
        rowKey={(b) => `${b.merchant_id}-${b.currency}`}
        loading={loading}
        empty={activeOnly ? "No merchant has QR sales yet." : "No merchants."}
      />
    </Panel>
  );
}
