"use client";

import { useEffect, useState } from "react";
import { errorMessage, formatDate, merchantSettlements, type PayoutAccount } from "@/lib/settlements";
import { BTN, FieldLabel, INPUT, KV, Notice, Panel, Spinner, StatusPill } from "./ui";

const STATUS_COPY: Record<PayoutAccount["payout_verification_status"], { tone: "neutral" | "warning" | "success" | "danger"; title: string; body: string }> = {
  unverified: {
    tone: "warning",
    title: "Add your ABA account",
    body: "We need your ABA account to send your earnings. Payouts start after we verify it.",
  },
  pending: {
    tone: "warning",
    title: "Verification in progress",
    body: "We're checking your account details. Earnings keep accumulating and are paid once verified.",
  },
  verified: {
    tone: "success",
    title: "Account verified",
    body: "Your earnings are paid to this account.",
  },
  rejected: {
    tone: "danger",
    title: "Account rejected",
    body: "Please correct your details and save again.",
  },
};

export function PayoutAccountCard({ account, onSaved, onError }: {
  account: PayoutAccount | null;
  onSaved: (a: PayoutAccount) => void;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ number?: string; name?: string }>({});

  useEffect(() => {
    setNumber(account?.aba_account ?? "");
    setName(account?.aba_account_name ?? "");
    setEditing(!account?.aba_account);
  }, [account]);

  if (!account) {
    return (
      <Panel title="Payout account">
        <div className="space-y-3 p-4">
          <div className="h-4 w-1/2 animate-pulse rounded bg-bg-secondary" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-bg-secondary" />
        </div>
      </Panel>
    );
  }

  const status = STATUS_COPY[account.payout_verification_status] ?? STATUS_COPY.unverified;
  const hadAccount = !!account.aba_account;

  function validate() {
    const e: typeof errors = {};
    const digits = number.replace(/\s/g, "");
    if (!/^\d{6,30}$/.test(digits)) e.number = "Enter the ABA account number (digits only)";
    if (name.trim().length < 2) e.name = "Enter the name exactly as on the ABA account";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    if (hadAccount && account?.payout_verification_status === "verified" &&
        !window.confirm("Changing your account pauses payouts until we verify the new one. Continue?")) {
      return;
    }
    setSaving(true);
    try {
      const updated = await merchantSettlements.updateAccount({
        aba_account: number.replace(/\s/g, ""),
        aba_account_name: name.trim(),
      });
      onSaved(updated);
      setEditing(false);
    } catch (err) {
      onError(errorMessage(err, "Could not save account"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Payout account"
      subtitle="Where we send your earnings"
      actions={<StatusPill status={account.payout_verification_status} />}
    >
      <div className="space-y-4 p-4">
        <Notice tone={status.tone} title={status.title}>
          {account.payout_verification_status === "rejected" && account.payout_rejection_reason
            ? `Reason: ${account.payout_rejection_reason}. ${status.body}`
            : status.body}
        </Notice>

        {editing ? (
          <div className="space-y-3">
            <FieldLabel label="ABA account number" error={errors.number} hint="Digits only, as shown in ABA Mobile">
              <input
                className={`${INPUT} font-mono`}
                inputMode="numeric"
                autoComplete="off"
                value={number}
                onChange={(e) => setNumber(e.target.value.replace(/[^\d ]/g, ""))}
                placeholder="000 000 000"
              />
            </FieldLabel>
            <FieldLabel label="Account holder name" error={errors.name} hint="Must match the name on the ABA account">
              <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="SOK DARA" />
            </FieldLabel>
            {hadAccount && (
              <p className="text-[11px] text-text-muted">Saving a new account sends it for re-verification and pauses payouts until approved.</p>
            )}
            <div className="flex gap-2">
              <button className={BTN.primary} onClick={save} disabled={saving}>
                {saving && <Spinner />} Save account
              </button>
              {hadAccount && (
                <button className={BTN.outline} onClick={() => { setEditing(false); setErrors({}); setNumber(account.aba_account ?? ""); setName(account.aba_account_name ?? ""); }}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <div>
            <KV label="Account number"><span className="font-mono">{account.aba_account}</span></KV>
            <KV label="Holder name">{account.aba_account_name}</KV>
            {account.payout_verified_at && <KV label="Verified on">{formatDate(account.payout_verified_at, false)}</KV>}
            <KV label="Commission rate">{Number(account.effective_commission_rate)}%</KV>
            <button className={`${BTN.outlineSm} mt-3`} onClick={() => setEditing(true)}>Change account</button>
          </div>
        )}
      </div>
    </Panel>
  );
}
