"use client";

import { useCallback, useEffect, useState } from "react";
import { adminSettlements, errorMessage, formatDate, type AuditEntry } from "@/lib/settlements";
import { INPUT, Pager, Panel, StatusPill, Table, type Column } from "../ui";

const PAGE_SIZE = 50;

const ACTION_TONE: Record<string, "success" | "danger" | "warning" | "info" | "neutral"> = {
  "payout.paid": "success",
  "payout.failed": "danger",
  "payout.cancelled": "neutral",
  "payout.reversed": "warning",
  "payout.created": "info",
  "earning.created": "neutral",
  "earning.ready": "info",
  "earning.reversed": "warning",
  "earning.adjustment_created": "warning",
  "payout_account.changed": "warning",
  "payout_settings.updated": "info",
};

function summarize(e: AuditEntry): string {
  const nv = e.new_value ?? {};
  const ov = e.old_value ?? {};
  if (e.action === "payout.reversed") {
    const n = Array.isArray(nv.released_earnings) ? nv.released_earnings.length : 0;
    return `Amount ${nv.amount ?? "—"} returned to balance · ${n} entr${n === 1 ? "y" : "ies"} released · was ref ${ov.reference ?? "—"}`;
  }
  if (e.action === "payout.paid") return `Ref ${nv.reference ?? "—"} · ${nv.amount ?? ""}`;
  if (e.action === "payout.created") return `Amount ${nv.amount ?? "—"} · ${nv.item_count ?? 0} entries`;
  if (e.action === "earning.created" || e.action === "earning.adjustment_created") {
    return `Order ${nv.order_id ?? "—"} · net ${nv.net_amount ?? "—"}`;
  }
  const keys = Array.from(new Set([...Object.keys(ov), ...Object.keys(nv)]));
  return keys
    .filter((k) => JSON.stringify(ov[k]) !== JSON.stringify(nv[k]))
    .map((k) => `${k.replace(/_/g, " ")}: ${fmt(ov[k])} → ${fmt(nv[k])}`)
    .join(" · ");
}

const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "∅" : String(v));

export function AuditTab({ merchantNames, flash }: {
  merchantNames: Record<number, string>;
  flash: (msg: string, ok?: boolean) => void;
}) {
  const [merchantId, setMerchantId] = useState("");
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await adminSettlements.audit({
        merchant_id: merchantId ? Number(merchantId) : undefined,
        entity_type: entityType || undefined,
        page,
        page_size: PAGE_SIZE,
      }));
    } catch (err) {
      flash(errorMessage(err, "Could not load audit log"), false);
    } finally {
      setLoading(false);
    }
  }, [merchantId, entityType, page, flash]);

  useEffect(() => { load(); }, [load]);

  const columns: Column<AuditEntry>[] = [
    { key: "time", header: "When", render: (e) => <span className="whitespace-nowrap text-xs">{formatDate(e.created_at)}</span> },
    { key: "action", header: "Action", render: (e) => <StatusPill status={e.action} tone={ACTION_TONE[e.action] ?? "neutral"} label={e.action} /> },
    {
      key: "entity",
      header: "Subject",
      render: (e) => (
        <div className="whitespace-nowrap text-xs">
          <span className="capitalize">{e.entity_type}</span> #{e.entity_id}
          {e.merchant_id != null && <div className="text-[11px] text-text-muted">{merchantNames[e.merchant_id] ?? `Merchant #${e.merchant_id}`}</div>}
        </div>
      ),
    },
    {
      key: "actor",
      header: "By",
      render: (e) => (
        <div className="whitespace-nowrap text-xs">
          <span className="capitalize">{e.actor_type.replace(/_/g, " ")}</span>
          {e.actor_id && <div className="max-w-[140px] truncate font-mono text-[11px] text-text-muted" title={e.actor_id}>{e.actor_id}</div>}
        </div>
      ),
    },
    {
      key: "detail",
      header: "Detail",
      render: (e) => (
        <div className="text-xs">
          <button className="text-left hover:text-accent" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
            {summarize(e) || "—"}
          </button>
          {e.note && <div className="mt-0.5 text-[11px] italic text-text-muted">“{e.note}”</div>}
          {expanded === e.id && (
            <pre className="mt-2 max-w-[520px] overflow-x-auto rounded-lg bg-bg-secondary p-2 text-[11px] leading-snug">
              {JSON.stringify({ before: e.old_value, after: e.new_value }, null, 2)}
            </pre>
          )}
        </div>
      ),
    },
  ];

  return (
    <Panel
      title="Audit log"
      subtitle="Every settlement change, in order. Entries are permanent and cannot be edited or deleted."
      actions={
        <>
          <select className={`${INPUT} w-44 py-1.5 text-xs`} value={merchantId} onChange={(e) => { setMerchantId(e.target.value); setPage(1); }}>
            <option value="">All merchants</option>
            {Object.entries(merchantNames)
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select className={`${INPUT} w-36 py-1.5 text-xs`} value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
            <option value="">All events</option>
            <option value="payout">Payouts</option>
            <option value="earning">Earnings</option>
            <option value="merchant">Accounts</option>
          </select>
        </>
      }
    >
      <Table columns={columns} rows={rows} rowKey={(e) => e.id} loading={loading} empty="No audit entries." />
      <Pager page={page} hasMore={rows.length === PAGE_SIZE} onChange={setPage} />
    </Panel>
  );
}
