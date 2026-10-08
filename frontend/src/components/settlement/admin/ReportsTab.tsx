"use client";

import { useCallback, useEffect, useState } from "react";
import {
  adminSettlements, downloadCsv, errorMessage, formatMoney,
  type ReportRow, type SettlementReport,
} from "@/lib/settlements";
import { BTN, FieldLabel, INPUT, Notice, Panel, Spinner, SummaryCard, Table, type Column } from "../ui";

const iso = (d: Date) => d.toISOString().slice(0, 10);

function preset(kind: "this_month" | "last_month" | "last_30" | "this_year"): [string, string] {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  switch (kind) {
    case "this_month": return [iso(new Date(Date.UTC(y, m, 1))), iso(now)];
    case "last_month": return [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))];
    case "last_30": return [iso(new Date(now.getTime() - 29 * 86400000)), iso(now)];
    case "this_year": return [iso(new Date(Date.UTC(y, 0, 1))), iso(now)];
  }
}

export function ReportsTab() {
  const [[from, to], setRange] = useState<[string, string]>(preset("this_month"));
  const [report, setReport] = useState<SettlementReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!from || !to || from > to) { setError("Choose a valid date range"); return; }
    setLoading(true); setError("");
    try {
      setReport(await adminSettlements.report(from, to));
    } catch (err) {
      setError(errorMessage(err, "Could not load report"));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const total = report?.totals.find((t) => t.currency === "USD") ?? report?.totals[0];
  const cur = total?.currency ?? "USD";

  const columns: Column<ReportRow>[] = [
    { key: "merchant", header: "Merchant", render: (r) => <span className="font-semibold">{r.merchant_name ?? `#${r.merchant_id}`}</span> },
    { key: "orders", header: "Orders", align: "right", render: (r) => r.orders },
    { key: "gross", header: "Sales", align: "right", render: (r) => formatMoney(r.gross, r.currency) },
    { key: "commission", header: "Commission", align: "right", render: (r) => <span className="text-success">{formatMoney(r.commission, r.currency)}</span> },
    { key: "net", header: "Merchant share", align: "right", render: (r) => formatMoney(r.net, r.currency) },
    { key: "paid_out", header: "Paid out", align: "right", render: (r) => formatMoney(r.paid_out, r.currency) },
    { key: "payouts", header: "Payouts", align: "right", render: (r) => r.payouts },
  ];

  function exportCsv() {
    if (!report) return;
    downloadCsv(
      `settlement-report-${from}-to-${to}.csv`,
      ["Merchant ID", "Merchant", "Currency", "Orders", "Sales", "Commission", "Merchant share", "Paid out", "Payouts"],
      [
        ...report.merchants.map((r) => [r.merchant_id, r.merchant_name, r.currency, r.orders, r.gross, r.commission, r.net, r.paid_out, r.payouts]),
        ...report.totals.map((t) => ["", "TOTAL", t.currency, t.orders, t.gross, t.commission, t.net, t.paid_out, t.payouts]),
      ],
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <FieldLabel label="From"><input type="date" className={INPUT} value={from} max={to} onChange={(e) => setRange([e.target.value, to])} /></FieldLabel>
          <FieldLabel label="To"><input type="date" className={INPUT} value={to} min={from} onChange={(e) => setRange([from, e.target.value])} /></FieldLabel>
          <div className="flex flex-wrap gap-1.5 pb-0.5">
            {([
              ["this_month", "This month"], ["last_month", "Last month"], ["last_30", "Last 30 days"], ["this_year", "This year"],
            ] as const).map(([k, label]) => (
              <button key={k} className={BTN.outlineSm} onClick={() => setRange(preset(k))}>{label}</button>
            ))}
          </div>
          <div className="ml-auto flex gap-2 pb-0.5">
            {loading && <span className="self-center text-text-muted"><Spinner /></span>}
            <button className={BTN.outlineSm} onClick={exportCsv} disabled={!report || report.merchants.length === 0}>Export CSV</button>
          </div>
        </div>
      </Panel>

      {error && <Notice tone="danger">{error}</Notice>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryCard label="QR sales" value={formatMoney(total?.gross, cur)} hint={`${total?.orders ?? 0} paid orders`} />
        <SummaryCard label="Platform commission" tone="success" value={formatMoney(total?.commission, cur)} />
        <SummaryCard label="Merchant share" tone="primary" value={formatMoney(total?.net, cur)} hint="Earned in period" />
        <SummaryCard label="Paid out" value={formatMoney(total?.paid_out, cur)} hint={`${total?.payouts ?? 0} payouts`} />
        <SummaryCard
          label="Earned − paid"
          tone="warning"
          value={formatMoney(Number(total?.net ?? 0) - Number(total?.paid_out ?? 0), cur)}
          hint="Positive = liability grew"
        />
      </div>

      <Panel
        title="By merchant"
        subtitle="Sales counted when paid; payouts when marked paid. Refund adjustments are included; reversed orders are not."
      >
        <Table columns={columns} rows={report?.merchants ?? []} rowKey={(r) => `${r.merchant_id}-${r.currency}`} loading={loading && !report} empty="No settlement activity in this period." />
      </Panel>
    </div>
  );
}
