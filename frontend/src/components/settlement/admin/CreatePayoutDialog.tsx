"use client";

import { useEffect, useState } from "react";
import {
  adminSettlements, errorMessage, formatMoney,
  type MerchantBalance, type Payout, type PayoutAccount,
} from "@/lib/settlements";
import { BTN, Dialog, FieldLabel, INPUT, KV, Notice, Spinner } from "../ui";

/** Bundle a merchant's available earnings into one pending payout. */
export function CreatePayoutDialog({ merchant, onClose, onCreated, flash }: {
  merchant: MerchantBalance | null;
  onClose: () => void;
  onCreated: (p: Payout) => void;
  flash: (msg: string, ok?: boolean) => void;
}) {
  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!merchant) return;
    setAccount(null); setNote("");
    adminSettlements.account(merchant.merchant_id)
      .then(setAccount)
      .catch((err) => flash(errorMessage(err, "Could not load account"), false));
  }, [merchant, flash]);

  if (!merchant) return null;
  const currency = merchant.currency;
  const verified = account?.payout_verification_status === "verified";

  async function create() {
    if (!merchant) return;
    setSaving(true);
    try {
      const payout = await adminSettlements.createPayout(merchant.merchant_id, { currency, note: note.trim() || undefined });
      flash(`Payout #${payout.id} created for ${formatMoney(payout.amount, payout.currency)}`);
      onCreated(payout);
    } catch (err) {
      flash(errorMessage(err, "Could not create payout"), false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title={`Create payout · ${merchant.merchant_name ?? `#${merchant.merchant_id}`}`}
      onClose={onClose}
      footer={
        <>
          <button className={BTN.outline} onClick={onClose}>Cancel</button>
          <button className={BTN.primary} onClick={create} disabled={!verified || saving}>
            {saving && <Spinner />} Create payout
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-bg-secondary px-4 py-3 text-center">
          <div className="text-[11px] uppercase tracking-wide text-text-muted">Available to pay</div>
          <div className="font-heading text-3xl font-bold tabular-nums text-accent">
            {formatMoney(merchant.available_amount, currency)}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            The exact amount is computed when the payout is created and may include new deliveries or refund adjustments.
          </div>
        </div>

        {!account ? (
          <div className="flex justify-center py-4 text-text-muted"><Spinner /></div>
        ) : verified ? (
          <div className="rounded-lg border border-border px-3 py-1">
            <KV label="Pay to account"><span className="select-all font-mono">{account.aba_account}</span></KV>
            <KV label="Holder name">{account.aba_account_name}</KV>
          </div>
        ) : (
          <Notice tone="danger" title="Account not verified">Verify this merchant&apos;s ABA account before paying out.</Notice>
        )}

        <FieldLabel label="Note (optional)">
          <input className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Weekly settlement" />
        </FieldLabel>

        <Notice tone="info" title="Next steps">
          The payout is created as <b>pending</b>. Send the ABA transfer for the exact payout amount, then mark it paid with the transfer reference.
        </Notice>
      </div>
    </Dialog>
  );
}
