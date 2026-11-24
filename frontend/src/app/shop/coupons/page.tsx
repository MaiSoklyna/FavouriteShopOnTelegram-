"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { LoginGate } from "@/components/shop/LoginGate";
import { CouponCard } from "@/components/shop/CouponCard";
import { api } from "@/lib/api";
import { savePromo } from "@/lib/quote";
import { STATUS_LABEL } from "@/lib/coupons";
import type { PublicCoupon, WalletCoupon } from "@/types";
import { Icon } from "@/components/shop/Icon";

type Tab = "mine" | "get" | "history";
const TABS: { key: Tab; label: string }[] = [
  { key: "mine", label: "My coupons" },
  { key: "get", label: "Get more" },
  { key: "history", label: "Used & expired" },
];

export default function CouponsPage() {
  const { user } = useAuth();
  if (!user) return <LoginGate><div /></LoginGate>;
  return <CouponsContent />;
}

function CouponsContent() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("mine");
  const [wallet, setWallet] = useState<WalletCoupon[] | null>(null);
  const [offers, setOffers] = useState<PublicCoupon[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [mine, pub] = await Promise.all([
        api.get<{ data: WalletCoupon[] }>("/coupons/mine"),
        api.get<{ data: PublicCoupon[] }>("/coupons/public"),
      ]);
      setWallet(mine.data); setOffers(pub.data);
    } catch { setWallet((w) => w ?? []); setOffers((o) => o ?? []); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const available = useMemo(() => (wallet ?? []).filter((c) => c.status === "available"), [wallet]);
  const history = useMemo(() => (wallet ?? []).filter((c) => c.status !== "available"), [wallet]);
  const toGet = useMemo(() => (offers ?? []).filter((c) => !c.claimed && !c.auto_apply && c.usable), [offers]);

  async function claim(c: PublicCoupon) {
    setBusy(c.id); setError("");
    try { await api.post(`/coupons/${c.id}/claim`); await load(); }
    catch (e: unknown) { setError((e instanceof Error && e.message) || "Couldn't save that coupon."); }
    finally { setBusy(null); }
  }

  /** Go to the cart with this coupon ready to apply. */
  function use(c: { code: string; merchant_id: number | null }) {
    savePromo(c.code, c.merchant_id);
    router.push("/shop/cart");
  }

  const empty = (title: string, body: string) => (
    <div className="px-6 py-14 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-card text-ink-500 shadow-fos-sm"><Icon name="ticket" size={26} /></span>
      <p className="mt-3 text-[15px] font-extrabold text-ink-900">{title}</p>
      <p className="mx-auto mt-1 max-w-[30ch] text-caption text-ink-500">{body}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface pb-24">
      <div className="sticky top-0 z-10 bg-surface px-gutter pb-2 pt-4">
        <h1 className="text-display text-ink-900">Coupons</h1>
        <div role="tablist" className="fos-no-scrollbar -mx-gutter mt-3 flex gap-2 overflow-x-auto px-gutter">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`fos-press h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[13px] font-extrabold ${tab === t.key ? "bg-navy-700 text-white" : "border-[1.5px] border-line bg-card text-ink-900"}`}>
              {t.label}{t.key === "mine" && available.length > 0 ? ` · ${available.length}` : t.key === "get" && toGet.length > 0 ? ` · ${toGet.length}` : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 px-gutter pt-2">
        {error && <p role="alert" className="rounded-card bg-tint-caution px-3.5 py-3 text-[13px] font-bold text-caution-500">{error}</p>}

        {(tab === "mine" ? wallet : tab === "get" ? offers : wallet) === null ? (
          <p className="py-10 text-center text-[13px] text-ink-500">Loading…</p>
        ) : tab === "mine" ? (
          available.length === 0 ? empty("No coupons yet", "Claim one under Get more, or wait for a shop to send you something special.")
            : available.map((c) => (
              <CouponCard key={c.id} coupon={c}>
                <button type="button" onClick={() => use(c)} className="fos-press h-10 flex-1 rounded-thumb bg-grad-cta text-[13px] font-extrabold text-white">Use now</button>
              </CouponCard>
            ))
        ) : tab === "get" ? (
          toGet.length === 0 ? empty("You've got them all", "New coupons show up here when shops add them.")
            : toGet.map((c) => (
              <CouponCard key={c.id} coupon={c}>
                <button type="button" disabled={busy === c.id} onClick={() => claim(c)} className="fos-press h-10 flex-1 rounded-thumb bg-navy-700 text-[13px] font-extrabold text-white disabled:opacity-60">
                  {busy === c.id ? "Saving…" : "Save coupon"}
                </button>
              </CouponCard>
            ))
        ) : (
          history.length === 0 ? empty("Nothing here yet", "Coupons you've used or that have expired appear here.")
            : history.map((c) => <CouponCard key={c.id} coupon={c} dimmed note={STATUS_LABEL[c.status]} />)
        )}
      </div>
    </div>
  );
}
