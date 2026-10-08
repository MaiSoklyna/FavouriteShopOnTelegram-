"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import {
  adminSettlements, errorMessage, formatMoney,
  type MerchantBalance, type Payout,
} from "@/lib/settlements";
import { Notice, SummaryCard, Tabs, useFlash } from "@/components/settlement/ui";
import { BalancesTab } from "@/components/settlement/admin/BalancesTab";
import { PayoutsTab } from "@/components/settlement/admin/PayoutsTab";
import { VerificationTab } from "@/components/settlement/admin/VerificationTab";
import { ReportsTab } from "@/components/settlement/admin/ReportsTab";
import { AuditTab } from "@/components/settlement/admin/AuditTab";
import { CreatePayoutDialog } from "@/components/settlement/admin/CreatePayoutDialog";
import { PayoutDetailDialog } from "@/components/settlement/admin/PayoutDetailDialog";
import { MerchantAccountDialog } from "@/components/settlement/admin/MerchantAccountDialog";

type Tab = "balances" | "payouts" | "verification" | "reports" | "audit";

export default function SettlementsPage() {
  const { isSuperAdmin } = useAuth();
  const { flash, flashNode } = useFlash();

  const [tab, setTab] = useState<Tab>("balances");
  const [balances, setBalances] = useState<MerchantBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [backfilling, setBackfilling] = useState(false);

  const [payFor, setPayFor] = useState<MerchantBalance | null>(null);
  const [manage, setManage] = useState<MerchantBalance | null>(null);
  const [openPayout, setOpenPayout] = useState<Payout | null>(null);

  const loadBalances = useCallback(async () => {
    try {
      // All merchants (not only owed) — also feeds verification + name lookups
      setBalances(await adminSettlements.balances(false));
      setLoadError("");
    } catch (err) {
      setLoadError(errorMessage(err, "Could not load balances"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isSuperAdmin) loadBalances(); }, [isSuperAdmin, loadBalances]);

  const refreshAll = useCallback(() => {
    loadBalances();
    setRefreshKey((k) => k + 1);
  }, [loadBalances]);

  const merchantNames = useMemo(() => {
    const names: Record<number, string> = {};
    for (const b of balances) names[b.merchant_id] = b.merchant_name ?? `#${b.merchant_id}`;
    return names;
  }, [balances]);

  const totals = useMemo(() => {
    const usd = balances.filter((b) => b.currency === "USD");
    const sum = (k: keyof MerchantBalance) => usd.reduce((s, b) => s + Math.round(Number(b[k] ?? 0) * 100), 0) / 100;
    return {
      owed: sum("owed_amount"),
      available: sum("available_amount"),
      inPayout: sum("in_payout_amount"),
      pending: sum("pending_amount"),
      commission: sum("commission_total"),
      paid: sum("paid_amount"),
      gross: sum("gross_total"),
      merchantsOwed: usd.filter((b) => Number(b.owed_amount) > 0).length,
    };
  }, [balances]);

  const pendingVerification = useMemo(
    () => new Set(balances.filter((b) => b.payout_verification_status === "pending").map((b) => b.merchant_id)).size,
    [balances],
  );

  async function backfill() {
    setBackfilling(true);
    try {
      const r = await adminSettlements.backfill();
      flash(r.created.length
        ? `Recorded ${r.created.length} missing earning${r.created.length > 1 ? "s" : ""}`
        : `All ${r.scanned} paid QR orders already recorded`);
      refreshAll();
    } catch (err) {
      flash(errorMessage(err, "Sync failed"), false);
    } finally {
      setBackfilling(false);
    }
  }

  if (!isSuperAdmin) {
    return <div className="p-10 text-center text-text-secondary">Super-admin access only.</div>;
  }

  return (
    <div className="mx-auto max-w-7xl">
      {flashNode}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-[22px] font-bold text-text">Settlements</h1>
          <p className="mt-1 text-[13px] text-text-secondary">
            Customer QR payments land in the platform ABA account. This is what each merchant is owed and how they get paid.
          </p>
        </div>
      </div>

      {loadError && <div className="mb-4"><Notice tone="danger" title="Couldn't load settlements">{loadError}</Notice></div>}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SummaryCard
          label="Owed to merchants"
          tone="primary"
          value={loading ? "—" : formatMoney(totals.owed)}
          hint={`${totals.merchantsOwed} merchant${totals.merchantsOwed === 1 ? "" : "s"}`}
        />
        <SummaryCard label="Ready to pay" tone="success" value={loading ? "—" : formatMoney(totals.available)} />
        <SummaryCard label="In open payouts" value={loading ? "—" : formatMoney(totals.inPayout)} hint="Awaiting transfer confirmation" />
        <SummaryCard label="Pending delivery" tone="warning" value={loading ? "—" : formatMoney(totals.pending)} />
        <SummaryCard label="Paid to merchants" value={loading ? "—" : formatMoney(totals.paid)} hint="All time" />
        <SummaryCard
          label="Commission earned"
          value={loading ? "—" : formatMoney(totals.commission)}
          hint={`All time · of ${formatMoney(totals.gross)} QR sales`}
        />
      </div>

      <Tabs<Tab>
        tabs={[
          { key: "balances", label: "Balances" },
          { key: "payouts", label: "Payouts" },
          { key: "verification", label: "Verification", count: pendingVerification },
          { key: "reports", label: "Reports" },
          { key: "audit", label: "Audit log" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "balances" && (
        <BalancesTab
          balances={balances}
          loading={loading}
          onPay={setPayFor}
          onManage={setManage}
          onBackfill={backfill}
          backfilling={backfilling}
        />
      )}
      {tab === "payouts" && (
        <PayoutsTab merchantNames={merchantNames} onOpen={setOpenPayout} refreshKey={refreshKey} flash={flash} />
      )}
      {tab === "verification" && <VerificationTab balances={balances} loading={loading} onReview={setManage} />}
      {tab === "reports" && <ReportsTab />}
      {tab === "audit" && <AuditTab merchantNames={merchantNames} flash={flash} />}

      {payFor && (
        <CreatePayoutDialog
          merchant={payFor}
          onClose={() => setPayFor(null)}
          flash={flash}
          onCreated={(p) => {
            setPayFor(null);
            refreshAll();
            setOpenPayout(p); // go straight to the transfer step
          }}
        />
      )}

      <MerchantAccountDialog merchant={manage} onClose={() => setManage(null)} onChanged={refreshAll} flash={flash} />

      {openPayout && (
        <PayoutDetailDialog
          payoutId={openPayout.id}
          merchantName={merchantNames[openPayout.merchant_id]}
          onClose={() => setOpenPayout(null)}
          onChanged={refreshAll}
          flash={flash}
        />
      )}
    </div>
  );
}
