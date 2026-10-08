"use client";

import { useCallback, useEffect, useState } from "react";
import { adminSettlements, downloadCsv, errorMessage, type Payout, type PayoutStatus } from "@/lib/settlements";
import { BTN, INPUT, Pager, Panel, Tabs } from "../ui";
import { PayoutsTable } from "../tables";

const PAGE_SIZE = 25;
type Filter = "pending" | "paid" | "failed" | "cancelled" | "reversed" | "all";

export function PayoutsTab({ merchantNames, onOpen, refreshKey, flash }: {
  merchantNames: Record<number, string>;
  onOpen: (p: Payout) => void;
  refreshKey: number;
  flash: (msg: string, ok?: boolean) => void;
}) {
  const [filter, setFilter] = useState<Filter>("pending");
  const [merchantId, setMerchantId] = useState<string>("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await adminSettlements.payouts({
        status: filter === "all" ? undefined : (filter as PayoutStatus),
        merchant_id: merchantId ? Number(merchantId) : undefined,
        page,
        page_size: PAGE_SIZE,
      }));
    } catch (err) {
      flash(errorMessage(err, "Could not load payouts"), false);
    } finally {
      setLoading(false);
    }
  }, [filter, merchantId, page, flash]);

  useEffect(() => { load(); }, [load, refreshKey]);

  function exportCsv() {
    downloadCsv(
      `payouts-${filter}-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Payout", "Merchant", "Currency", "Amount", "Entries", "Status", "Account", "Holder", "Reference", "Created", "Paid", "Reason"],
      rows.map((p) => [
        p.id, merchantNames[p.merchant_id] ?? p.merchant_id, p.currency, p.amount, p.item_count, p.status,
        p.aba_account, p.aba_account_name, p.reference, p.created_at, p.paid_at, p.failure_reason,
      ]),
    );
  }

  return (
    <Panel
      title="Payouts"
      subtitle="Pending payouts are waiting for you to send the ABA transfer and record its reference."
      actions={
        <>
          <select className={`${INPUT} w-48 py-1.5 text-xs`} value={merchantId} onChange={(e) => { setMerchantId(e.target.value); setPage(1); }}>
            <option value="">All merchants</option>
            {Object.entries(merchantNames)
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <button className={BTN.outlineSm} onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
        </>
      }
    >
      <div className="px-4 pt-2">
        <Tabs<Filter>
          tabs={[
            { key: "pending", label: "Pending" },
            { key: "paid", label: "Paid" },
            { key: "failed", label: "Failed" },
            { key: "cancelled", label: "Cancelled" },
            { key: "reversed", label: "Reversed" },
            { key: "all", label: "All" },
          ]}
          value={filter}
          onChange={(k) => { setFilter(k); setPage(1); }}
        />
      </div>
      <PayoutsTable
        rows={rows}
        loading={loading}
        merchantNames={merchantNames}
        onOpen={onOpen}
        showFullAccount
        empty={filter === "pending" ? "No payouts waiting for transfer." : "No payouts."}
      />
      <Pager page={page} hasMore={rows.length === PAGE_SIZE} onChange={setPage} />
    </Panel>
  );
}
