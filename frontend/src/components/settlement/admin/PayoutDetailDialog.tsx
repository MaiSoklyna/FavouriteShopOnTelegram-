"use client";

import { useEffect, useState } from "react";
import {
  adminSettlements, downloadCsv, errorMessage, formatDate, formatMoney, type Payout,
} from "@/lib/settlements";
import { BTN, Dialog, FieldLabel, INPUT, KV, Notice, Spinner, StatusPill } from "../ui";
import { EarningsTable } from "../tables";

type Mode = "view" | "paid" | "failed" | "reverse";

/** Payout statement + the actions that settle it. */
export function PayoutDetailDialog({ payoutId, merchantName, onClose, onChanged, flash }: {
  payoutId: number | null;
  merchantName?: string;
  onClose: () => void;
  onChanged: () => void;
  flash: (msg: string, ok?: boolean) => void;
}) {
  const [payout, setPayout] = useState<Payout | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [cancel, setCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseConfirm, setReverseConfirm] = useState("");

  useEffect(() => {
    if (payoutId == null) return;
    setPayout(null); setMode("view"); setReference(""); setConfirmed(false); setReason(""); setCancel(false);
    setReverseReason(""); setReverseConfirm("");
    adminSettlements.payout(payoutId)
      .then(setPayout)
      .catch((err) => flash(errorMessage(err, "Could not load payout"), false));
  }, [payoutId, flash]);

  if (payoutId == null) return null;
  const open = payout && (payout.status === "pending" || payout.status === "processing");

  async function markPaid() {
    if (!payout) return;
    setBusy(true);
    try {
      const p = await adminSettlements.completePayout(payout.id, reference.trim());
      setPayout({ ...payout, ...p });
      setMode("view");
      flash(`Payout #${p.id} marked paid`);
      onChanged();
    } catch (err) {
      flash(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function markFailed() {
    if (!payout) return;
    setBusy(true);
    try {
      const p = await adminSettlements.failPayout(payout.id, reason.trim(), cancel);
      setPayout({ ...payout, ...p });
      setMode("view");
      flash(`Payout #${p.id} ${cancel ? "cancelled" : "marked failed"} — earnings released`);
      onChanged();
    } catch (err) {
      flash(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function reverse() {
    if (!payout) return;
    setBusy(true);
    try {
      const p = await adminSettlements.reversePayout(payout.id, reverseReason.trim());
      setPayout({ ...payout, ...p });
      setMode("view");
      flash(`Payout #${p.id} reversed — ${formatMoney(p.amount, p.currency)} back in the merchant's available balance`);
      onChanged();
    } catch (err) {
      flash(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  function exportStatement() {
    if (!payout?.items) return;
    downloadCsv(
      `payout-${payout.id}.csv`,
      ["Order", "Type", "Order total", "Commission rate %", "Commission", "Net", "Status", "Recorded"],
      payout.items.map((e) => [
        e.order_code ?? e.order_id, e.entry_type, e.gross_amount, e.commission_rate,
        e.commission_amount, e.net_amount, e.status, e.created_at,
      ]),
    );
  }

  const footer = !payout ? undefined : mode === "paid" ? (
    <>
      <button className={BTN.outline} onClick={() => setMode("view")}>Back</button>
      <button className={BTN.success} onClick={markPaid} disabled={!confirmed || reference.trim().length < 3 || busy}>
        {busy && <Spinner />} Confirm paid
      </button>
    </>
  ) : mode === "failed" ? (
    <>
      <button className={BTN.outline} onClick={() => setMode("view")}>Back</button>
      <button className={BTN.danger} onClick={markFailed} disabled={reason.trim().length < 3 || busy}>
        {busy && <Spinner />} {cancel ? "Cancel payout" : "Mark failed"}
      </button>
    </>
  ) : mode === "reverse" ? (
    <>
      <button className={BTN.outline} onClick={() => setMode("view")}>Back</button>
      <button
        className={BTN.danger}
        onClick={reverse}
        disabled={reverseReason.trim().length < 3 || reverseConfirm.trim().toUpperCase() !== "REVERSE" || busy}
      >
        {busy && <Spinner />} Reverse payout
      </button>
    </>
  ) : (
    <>
      {payout.status === "paid" && (
        <button className={`${BTN.outline} mr-auto text-danger`} onClick={() => setMode("reverse")}>Reverse payout</button>
      )}
      {payout.items && payout.items.length > 0 && (
        <button className={BTN.outline} onClick={exportStatement}>Export CSV</button>
      )}
      {open && <button className={BTN.outline} onClick={() => setMode("failed")}>Mark failed</button>}
      {open && <button className={BTN.success} onClick={() => setMode("paid")}>Mark paid</button>}
    </>
  );

  return (
    <Dialog open title={`Payout #${payoutId}${merchantName ? ` · ${merchantName}` : ""}`} onClose={onClose} footer={footer} wide>
      {!payout ? (
        <div className="flex justify-center py-10 text-text-muted"><Spinner /></div>
      ) : mode === "paid" ? (
        <div className="space-y-4">
          <div className="rounded-xl bg-bg-secondary px-4 py-3">
            <KV label="Amount"><span className="font-heading text-lg font-bold">{formatMoney(payout.amount, payout.currency)}</span></KV>
            <KV label="To account"><span className="font-mono">{payout.aba_account ?? "—"}</span></KV>
            <KV label="Holder name">{payout.aba_account_name ?? "—"}</KV>
          </div>
          <FieldLabel label="ABA transfer reference" hint="From the ABA transfer receipt">
            <input className={`${INPUT} font-mono`} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} autoFocus />
          </FieldLabel>
          <label className="flex items-start gap-2 text-[13px] text-text-secondary">
            <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I transferred exactly {formatMoney(payout.amount, payout.currency)} to {payout.aba_account ?? "this account"}.
          </label>
          <Notice tone="warning">This can&apos;t be undone. The merchant will see this payout as paid.</Notice>
        </div>
      ) : mode === "reverse" ? (
        <div className="space-y-4">
          <Notice tone="warning" title="Only if no money reached the merchant">
            Use this for a test payout, a payout marked paid by mistake, or a transfer the bank returned.
            Payout #{payout.id} stays in the history as <b>reversed</b>, and {formatMoney(payout.amount, payout.currency)} goes
            back to the merchant&apos;s available balance so it can be paid again.
          </Notice>
          <div className="rounded-xl bg-bg-secondary px-4 py-3">
            <KV label="Amount"><span className="font-semibold">{formatMoney(payout.amount, payout.currency)}</span></KV>
            <KV label="Recorded reference"><span className="font-mono">{payout.reference ?? "—"}</span></KV>
            <KV label="Marked paid">{formatDate(payout.paid_at)}</KV>
          </div>
          <FieldLabel label="Reason (kept in the audit log, shown to the merchant)">
            <textarea className={`${INPUT} min-h-[72px]`} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)}
              placeholder="Workflow test — no transfer was sent" autoFocus />
          </FieldLabel>
          <FieldLabel label='Type REVERSE to confirm'>
            <input className={`${INPUT} font-mono`} value={reverseConfirm} onChange={(e) => setReverseConfirm(e.target.value)} />
          </FieldLabel>
        </div>
      ) : mode === "failed" ? (
        <div className="space-y-4">
          <FieldLabel label="Reason">
            <textarea className={`${INPUT} min-h-[72px]`} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Transfer returned — account closed" autoFocus />
          </FieldLabel>
          <label className="flex items-start gap-2 text-[13px] text-text-secondary">
            <input type="checkbox" className="mt-0.5" checked={cancel} onChange={(e) => setCancel(e.target.checked)} />
            No transfer was sent — cancel instead of marking failed.
          </label>
          <Notice tone="info">The {payout.item_count} entries go back to the merchant&apos;s available balance and can be paid again.</Notice>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border px-3 py-1">
              <KV label="Status"><StatusPill status={payout.status} /></KV>
              <KV label="Amount"><span className="font-semibold">{formatMoney(payout.amount, payout.currency)}</span></KV>
              <KV label="Method">{payout.method === "manual_transfer" ? "Manual ABA transfer" : "ABA PayWay payout"}</KV>
              {payout.reference && <KV label="Reference"><span className="font-mono">{payout.reference}</span></KV>}
              {payout.failure_reason && <KV label="Reason"><span className="text-danger">{payout.failure_reason}</span></KV>}
              {payout.reversal_reason && <KV label="Reversal reason"><span className="text-warning">{payout.reversal_reason}</span></KV>}
            </div>
            <div className="rounded-lg border border-border px-3 py-1">
              <KV label="Account"><span className="select-all font-mono">{payout.aba_account ?? "—"}</span></KV>
              <KV label="Holder">{payout.aba_account_name ?? "—"}</KV>
              <KV label="Created">{formatDate(payout.created_at)}</KV>
              {payout.paid_at && <KV label="Paid">{formatDate(payout.paid_at)}</KV>}
              {payout.failed_at && <KV label="Closed">{formatDate(payout.failed_at)}</KV>}
              {payout.reversed_at && <KV label="Reversed">{formatDate(payout.reversed_at)}</KV>}
            </div>
          </div>
          {payout.note && <Notice tone="neutral">{payout.note}</Notice>}
          <div>
            <h3 className="mb-2 font-heading text-[13px] font-bold text-text">Covered entries ({payout.items?.length ?? 0})</h3>
            <div className="rounded-lg border border-border">
              <EarningsTable rows={payout.items ?? []} empty="No entries." />
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
