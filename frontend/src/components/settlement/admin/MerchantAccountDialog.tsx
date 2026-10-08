"use client";

import { useEffect, useState } from "react";
import {
  adminSettlements, errorMessage, formatDate,
  type MerchantBalance, type PayoutAccount,
} from "@/lib/settlements";
import { BTN, Dialog, FieldLabel, INPUT, KV, Notice, Spinner, StatusPill } from "../ui";

/**
 * Review a merchant's payout account: verify / reject, commission override,
 * and the ABA Split & Payout switch (inactive until ABA enables the feature).
 */
export function MerchantAccountDialog({ merchant, onClose, onChanged, flash }: {
  merchant: MerchantBalance | null;
  onClose: () => void;
  onChanged: () => void;
  flash: (msg: string, ok?: boolean) => void;
}) {
  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [rate, setRate] = useState("");
  const [nameMatches, setNameMatches] = useState(false);

  useEffect(() => {
    if (!merchant) return;
    setAccount(null); setRejecting(false); setReason(""); setNameMatches(false);
    setLoading(true);
    adminSettlements.account(merchant.merchant_id)
      .then((a) => { setAccount(a); setRate(a.commission_rate != null ? String(Number(a.commission_rate)) : ""); })
      .catch((err) => flash(errorMessage(err, "Could not load account"), false))
      .finally(() => setLoading(false));
  }, [merchant, flash]);

  async function update(key: string, body: Parameters<typeof adminSettlements.updateSettings>[1], done: string) {
    if (!merchant) return;
    setBusy(key);
    try {
      setAccount(await adminSettlements.updateSettings(merchant.merchant_id, body));
      flash(done);
      onChanged();
      setRejecting(false);
    } catch (err) {
      flash(errorMessage(err), false);
    } finally {
      setBusy(null);
    }
  }

  const status = account?.payout_verification_status;
  const rateValid = rate === "" || (/^\d{1,3}(\.\d{1,2})?$/.test(rate) && Number(rate) <= 100);

  return (
    <Dialog open={!!merchant} title={merchant?.merchant_name ?? "Merchant"} onClose={onClose}>
      {loading || !account ? (
        <div className="flex justify-center py-10 text-text-muted"><Spinner /></div>
      ) : (
        <div className="space-y-5">
          {/* Account */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-heading text-[13px] font-bold text-text">ABA payout account</h3>
              {status && <StatusPill status={status} />}
            </div>
            {account.aba_account ? (
              <div className="rounded-lg border border-border px-3 py-1">
                <KV label="Account number"><span className="select-all font-mono">{account.aba_account}</span></KV>
                <KV label="Holder name">{account.aba_account_name}</KV>
                {account.payout_verified_at && <KV label="Verified">{formatDate(account.payout_verified_at)}</KV>}
              </div>
            ) : (
              <Notice tone="neutral">The merchant hasn&apos;t added an ABA account yet.</Notice>
            )}
            {status === "rejected" && account.payout_rejection_reason && (
              <div className="mt-2"><Notice tone="danger" title="Rejected">{account.payout_rejection_reason}</Notice></div>
            )}
          </section>

          {/* Verify / reject */}
          {account.aba_account && status !== "verified" && !rejecting && (
            <section className="space-y-3">
              <label className="flex items-start gap-2 text-[13px] text-text-secondary">
                <input type="checkbox" className="mt-0.5" checked={nameMatches} onChange={(e) => setNameMatches(e.target.checked)} />
                I confirmed this account belongs to the shop owner (e.g. test transfer, holder name matches).
              </label>
              <div className="flex gap-2">
                <button
                  className={BTN.success}
                  disabled={!nameMatches || !!busy}
                  onClick={() => update("verify", { payout_verification_status: "verified" }, "Account verified")}
                >
                  {busy === "verify" && <Spinner />} Verify account
                </button>
                <button className={BTN.outline} disabled={!!busy} onClick={() => setRejecting(true)}>Reject</button>
              </div>
            </section>
          )}

          {rejecting && (
            <section className="space-y-3">
              <FieldLabel label="Rejection reason (shown to the merchant)">
                <textarea className={`${INPUT} min-h-[72px]`} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Holder name doesn't match the shop owner" />
              </FieldLabel>
              <div className="flex gap-2">
                <button
                  className={BTN.danger}
                  disabled={reason.trim().length < 3 || !!busy}
                  onClick={() => update("reject", { payout_verification_status: "rejected", payout_rejection_reason: reason.trim() }, "Account rejected")}
                >
                  {busy === "reject" && <Spinner />} Reject account
                </button>
                <button className={BTN.outline} onClick={() => setRejecting(false)}>Cancel</button>
              </div>
            </section>
          )}

          {status === "verified" && (
            <button
              className={BTN.outlineSm}
              disabled={!!busy}
              onClick={() => {
                if (window.confirm("Revoke verification? Payouts to this merchant will be blocked until re-verified.")) {
                  update("revoke", { payout_verification_status: "pending" }, "Verification revoked");
                }
              }}
            >
              Revoke verification
            </button>
          )}

          {/* Commission */}
          <section className="border-t border-border pt-4">
            <h3 className="mb-2 font-heading text-[13px] font-bold text-text">Commission</h3>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <FieldLabel
                  label="Override (%)"
                  hint={`Leave empty to use the platform default. Effective now: ${Number(account.effective_commission_rate)}%. Applies to orders paid after the change.`}
                  error={rateValid ? undefined : "0–100, up to 2 decimals"}
                >
                  <input className={INPUT} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.trim())} placeholder="default" />
                </FieldLabel>
              </div>
              <button
                className={`${BTN.primary} mb-[22px]`}
                disabled={!rateValid || !!busy}
                onClick={() => update(
                  "rate",
                  rate === "" ? { clear_commission_rate: true } : { commission_rate: rate },
                  "Commission updated",
                )}
              >
                {busy === "rate" && <Spinner />} Save
              </button>
            </div>
          </section>

          {/* ABA split */}
          <section className="border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-heading text-[13px] font-bold text-text">ABA Split &amp; Payout</h3>
                <p className="mt-0.5 text-xs text-text-muted">
                  Lets ABA pay this merchant directly at checkout. Has no effect until ABA enables Split &amp; Payout on the platform account.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={account.payout_enabled}
                disabled={status !== "verified" || !!busy}
                onClick={() => update("split", { payout_enabled: !account.payout_enabled },
                  account.payout_enabled ? "ABA split disabled" : "ABA split enabled")}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${account.payout_enabled ? "bg-success" : "bg-border"}`}
                title={status !== "verified" ? "Verify the account first" : undefined}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${account.payout_enabled ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
          </section>
        </div>
      )}
    </Dialog>
  );
}
