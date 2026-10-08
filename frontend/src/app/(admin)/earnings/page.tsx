"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import {
  errorMessage, formatDate, formatMoney, merchantSettlements,
  type Earning, type EarningStatus, type MerchantBalance, type Payout, type PayoutAccount,
} from "@/lib/settlements";
import { Notice, Pager, Panel, SummaryCard, Tabs, useFlash } from "@/components/settlement/ui";
import { EarningsTable, PayoutsTable } from "@/components/settlement/tables";
import { PayoutAccountCard } from "@/components/settlement/PayoutAccountCard";

const PAGE_SIZE = 20;

type EarningFilter = "all" | EarningStatus;
const EARNING_TABS: { key: EarningFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "ready", label: "Available" },
  { key: "paid", label: "Paid" },
  { key: "reversed", label: "Reversed" },
];

export default function MerchantEarningsPage() {
  const { isSuperAdmin } = useAuth();
  const { flash, flashNode } = useFlash();

  const [balances, setBalances] = useState<MerchantBalance[] | null>(null);
  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [loadError, setLoadError] = useState("");

  const [filter, setFilter] = useState<EarningFilter>("all");
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [earningsPage, setEarningsPage] = useState(1);
  const [earningsLoading, setEarningsLoading] = useState(true);

  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [payoutsPage, setPayoutsPage] = useState(1);
  const [payoutsLoading, setPayoutsLoading] = useState(true);

  useEffect(() => {
    if (isSuperAdmin) return;
    Promise.all([merchantSettlements.balance(), merchantSettlements.account()])
      .then(([b, a]) => { setBalances(b); setAccount(a); })
      .catch((err) => setLoadError(errorMessage(err, "Could not load your earnings")));
  }, [isSuperAdmin]);

  const loadEarnings = useCallback(async () => {
    setEarningsLoading(true);
    try {
      setEarnings(await merchantSettlements.earnings({
        status: filter === "all" ? undefined : filter, page: earningsPage, page_size: PAGE_SIZE,
      }));
    } catch (err) {
      flash(errorMessage(err, "Could not load earnings"), false);
    } finally {
      setEarningsLoading(false);
    }
  }, [filter, earningsPage, flash]);

  const loadPayouts = useCallback(async () => {
    setPayoutsLoading(true);
    try {
      setPayouts(await merchantSettlements.payouts({ page: payoutsPage, page_size: PAGE_SIZE }));
    } catch (err) {
      flash(errorMessage(err, "Could not load payouts"), false);
    } finally {
      setPayoutsLoading(false);
    }
  }, [payoutsPage, flash]);

  useEffect(() => { if (!isSuperAdmin) loadEarnings(); }, [loadEarnings, isSuperAdmin]);
  useEffect(() => { if (!isSuperAdmin) loadPayouts(); }, [loadPayouts, isSuperAdmin]);

  if (isSuperAdmin) {
    return (
      <div className="p-10 text-center text-text-secondary">
        This page is for shop owners. Use <a href="/settlements" className="font-semibold text-accent underline">Settlements</a> to manage all merchants.
      </div>
    );
  }

  const usd = balances?.find((b) => b.currency === "USD") ?? balances?.[0];
  const currency = usd?.currency ?? "USD";
  const lastPaid = payouts.find((p) => p.status === "paid");

  return (
    <div className="mx-auto max-w-6xl">
      {flashNode}
      <div className="mb-5">
        <h1 className="font-heading text-[22px] font-bold text-text">Earnings</h1>
        <p className="mt-1 text-[13px] text-text-secondary">
          Money customers paid by ABA KHQR, minus platform commission. Orders become payable once delivered.
        </p>
      </div>

      {loadError && <div className="mb-4"><Notice tone="danger" title="Couldn't load earnings">{loadError}</Notice></div>}

      {/* Balance cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Current balance"
          tone="primary"
          value={balances ? formatMoney(usd?.owed_amount, currency) : "—"}
          hint="Owed to you now"
        />
        <SummaryCard
          label="Available for payout"
          tone="success"
          value={balances ? formatMoney(usd?.available_amount, currency) : "—"}
          hint={usd && Number(usd.in_payout_amount) > 0 ? `${formatMoney(usd.in_payout_amount, currency)} being transferred` : "Included in next payout"}
        />
        <SummaryCard
          label="Pending earnings"
          tone="warning"
          value={balances ? formatMoney(usd?.pending_amount, currency) : "—"}
          hint="Paid orders awaiting delivery"
        />
        <SummaryCard
          label="Paid to you"
          value={balances ? formatMoney(usd?.paid_amount, currency) : "—"}
          hint={lastPaid ? `Last payout ${formatDate(lastPaid.paid_at, false)}` : "No payouts yet"}
        />
      </div>

      {account && account.payout_verification_status !== "verified" && usd && Number(usd.owed_amount) > 0 && (
        <div className="mb-5">
          <Notice tone="warning" title="Payouts on hold">
            You have {formatMoney(usd.owed_amount, currency)} waiting. We can pay it once your ABA account is verified.
          </Notice>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          <Panel title="Earnings history" subtitle="One entry per paid order">
            <div className="px-4 pt-2">
              <Tabs
                tabs={EARNING_TABS}
                value={filter}
                onChange={(k) => { setFilter(k); setEarningsPage(1); }}
              />
            </div>
            <EarningsTable rows={earnings} loading={earningsLoading} />
            <Pager page={earningsPage} hasMore={earnings.length === PAGE_SIZE} onChange={setEarningsPage} />
          </Panel>

          <Panel title="Payout history" subtitle="Transfers to your ABA account">
            <PayoutsTable rows={payouts} loading={payoutsLoading} />
            <Pager page={payoutsPage} hasMore={payouts.length === PAGE_SIZE} onChange={setPayoutsPage} />
          </Panel>
        </div>

        <div className="space-y-5">
          <PayoutAccountCard
            account={account}
            onSaved={(a) => { setAccount(a); flash("Account saved — sent for verification"); }}
            onError={(m) => flash(m, false)}
          />
          <Panel title="How payouts work">
            <ol className="list-decimal space-y-1.5 px-8 py-4 text-[13px] text-text-secondary">
              <li>Customer pays by ABA KHQR — the order shows as <b>Pending</b>.</li>
              <li>You deliver the order — it becomes <b>Available</b>.</li>
              <li>We transfer your available balance to your verified ABA account.</li>
              <li>The payout appears above with its bank reference.</li>
            </ol>
            {usd && (
              <div className="border-t border-border px-4 py-3 text-xs text-text-muted">
                Lifetime sales {formatMoney(usd.gross_total, currency)} · commission {formatMoney(usd.commission_total, currency)}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
