"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CouponCard } from "./CouponCard";
import type { EligibleCoupon } from "@/types";

interface PointsOffer {
  eligible: boolean;
  balance: number;
  min_points: number;
  use_points: number;
  value: number;
  reason: string | null;
}

/** The automatic promotion the cart already has (a chosen coupon replaces it; they don't add up). */
export interface AutoDeal { title: string; discount: number }

/**
 * Checkout: every deal for this cart, each with its own "Use now" (applied at once, no second step).
 *
 *   ⭐ Best deal          the biggest saving, counting the automatic promotion
 *   Applied automatically the promotion the cart already gets (a coupon would replace it)
 *   Available            other coupons, and turning loyalty points into a discount
 *   Not available yet    with the reason: "Spend $4.20 more", "Need 100 loyalty points"
 *
 * A code can still be typed. The server prices whatever is chosen.
 */
export function CouponSheet({ merchantId, appliedCode, auto, onApply, onClose }: {
  merchantId: number;
  appliedCode: string | null;
  auto?: AutoDeal | null;
  onApply: (code: string | null) => void;
  onClose: () => void;
}) {
  const [coupons, setCoupons] = useState<EligibleCoupon[] | null>(null);
  const [points, setPoints] = useState<PointsOffer | null>(null);
  const [typed, setTyped] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api.get<{ data: EligibleCoupon[]; points?: PointsOffer | null }>("/coupons/eligible", { params: { merchant_id: merchantId } })
      .then((r) => { if (live) { setCoupons(r.data); setPoints(r.points ?? null); } })
      .catch(() => { if (live) { setCoupons([]); setFailed(true); } });
    return () => { live = false; };
  }, [merchantId]);

  const use = (code: string | null) => { onApply(code); onClose(); };

  async function usePoints() {
    if (!points?.eligible) return;
    setBusy(true); setError("");
    try {
      const r = await api.post<{ data: { coupon: { code: string } } }>("/loyalty/redeem", { points: points.use_points });
      use(r.data.coupon.code);
    } catch (e: unknown) {
      setError((e instanceof Error && e.message) || "Couldn't use your points. Please try again.");
    } finally { setBusy(false); }
  }

  const autoSaving = auto?.discount ?? 0;
  const usable = (coupons ?? []).filter((c) => c.eligible);
  const unusable = (coupons ?? []).filter((c) => !c.eligible);
  // The best deal counts the automatic promotion: a coupon only "wins" if it saves more
  const topCoupon = usable[0] && usable[0].discount > autoSaving ? usable[0] : null;
  const others = usable.filter((c) => c !== topCoupon);

  const useButton = (c: EligibleCoupon) => {
    const applied = appliedCode === c.code;
    return applied ? (
      <>
        <span className="flex h-10 flex-1 items-center justify-center rounded-thumb bg-tint-positive text-[13px] font-extrabold text-tone-positive">✓ Applied</span>
        <button type="button" onClick={() => use(null)} className="fos-press h-10 rounded-thumb border-[1.5px] border-line px-4 text-[13px] font-extrabold text-caution-500">Remove</button>
      </>
    ) : (
      <button type="button" onClick={() => use(c.code)} data-testid={`use-${c.id}`}
        className="fos-press h-10 flex-1 rounded-thumb bg-grad-cta text-[14px] font-extrabold text-white">Use now</button>
    );
  };

  const saving = (c: EligibleCoupon) =>
    auto && c.discount <= autoSaving
      ? `Saves $${c.discount.toFixed(2)} · less than your automatic deal ($${autoSaving.toFixed(2)})`
      : `Saves $${c.discount.toFixed(2)}`;

  const heading = (t: string) => <h3 className="pt-1 text-[12px] font-extrabold uppercase tracking-wide text-ink-500">{t}</h3>;

  return (
    <div role="dialog" aria-modal="true" aria-label="Coupons and deals" className="fixed inset-0 z-[200] flex items-end bg-black/50" onClick={onClose}>
      <div className="mx-auto flex max-h-[88vh] w-full max-w-[480px] flex-col rounded-t-[24px] bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-gutter pb-2 pt-4">
          <h2 className="text-[17px] font-extrabold text-ink-900">Coupons &amp; deals</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="fos-press h-8 rounded-full px-3 text-[13px] font-bold text-ink-500">Close</button>
        </div>

        <div className="flex gap-2 px-gutter pb-2">
          <input value={typed} onChange={(e) => setTyped(e.target.value.replace(/\s/g, "").toUpperCase())} placeholder="Have a code? Type it here" aria-label="Coupon code"
            className="h-11 min-w-0 flex-1 rounded-thumb border-[1.5px] border-line bg-card px-3 font-mono text-[14px] uppercase tracking-wider text-ink-900" />
          <button type="button" disabled={!typed} onClick={() => use(typed)}
            className="fos-press h-11 rounded-thumb bg-navy-700 px-4 text-[14px] font-extrabold text-white disabled:opacity-40">Apply</button>
        </div>
        {error && <p role="alert" className="px-gutter pb-1 text-[13px] font-bold text-caution-500">{error}</p>}

        <div className="flex-1 space-y-3 overflow-y-auto px-gutter pb-4">
          {coupons === null ? (
            <p className="py-8 text-center text-[13px] text-ink-500">Finding your deals…</p>
          ) : (
            <>
              {topCoupon && (
                <section data-testid="best-deal" className="space-y-2">
                  {heading("⭐ Best deal")}
                  <div className="rounded-hero ring-2 ring-mango-500">
                    <CouponCard coupon={topCoupon} note={<span className="text-tone-positive">{saving(topCoupon)}</span>}>{useButton(topCoupon)}</CouponCard>
                  </div>
                </section>
              )}

              {auto && (
                <section className="space-y-2" data-testid="auto-deal">
                  {heading(topCoupon ? "Applied automatically" : "⭐ Best deal · applied automatically")}
                  <div className={`flex items-center gap-3 rounded-hero bg-card p-3.5 shadow-fos-sm ${topCoupon ? "" : "ring-2 ring-mango-500"}`}>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-tint-positive text-[18px]">🎉</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-extrabold text-ink-900">{auto.title}</span>
                      <span className="block text-[12px] font-bold text-tone-positive">Saves ${autoSaving.toFixed(2)} · nothing to do</span>
                    </span>
                    <span className="text-[12px] font-extrabold text-tone-positive">{appliedCode ? "" : "✓ On"}</span>
                  </div>
                  {appliedCode && <p className="text-[12px] text-ink-500">You chose a coupon instead. Remove it to get this deal back.</p>}
                </section>
              )}

              {(others.length > 0 || points?.eligible) && (
                <section className="space-y-2">
                  {heading("Available")}
                  {others.map((c) => (
                    <CouponCard key={c.id} coupon={c} note={<span className={auto && c.discount <= autoSaving ? "" : "text-tone-positive"}>{saving(c)}</span>}>{useButton(c)}</CouponCard>
                  ))}
                  {points?.eligible && (
                    <div className="rounded-hero bg-card shadow-fos-sm" data-testid="points-offer">
                      <div className="flex items-center gap-3 p-3.5">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-tint-gold text-[18px]">⭐</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-extrabold text-ink-900">Use {points.use_points} points · ${points.value.toFixed(2)} off</span>
                          <span className="block text-[12px] text-ink-500">You have {points.balance} points</span>
                        </span>
                      </div>
                      <div className="border-t border-line p-2.5">
                        <button type="button" disabled={busy} onClick={usePoints}
                          className="fos-press h-10 w-full rounded-thumb bg-grad-cta text-[14px] font-extrabold text-white disabled:opacity-60">{busy ? "Using points…" : "Use now"}</button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {(unusable.length > 0 || (points && !points.eligible)) && (
                <section className="space-y-2" data-testid="not-available">
                  {heading("Not available yet")}
                  {unusable.map((c) => <CouponCard key={c.id} coupon={c} dimmed note={c.reason} />)}
                  {points && !points.eligible && (
                    <div className="flex items-center gap-3 rounded-hero bg-card p-3.5 opacity-60 shadow-fos-sm">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-tint-gold text-[18px]">⭐</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-extrabold text-ink-900">Use loyalty points</span>
                        <span className="block text-[12px] font-bold text-caution-500">{points.reason}</span>
                      </span>
                    </div>
                  )}
                </section>
              )}

              {!topCoupon && !auto && others.length === 0 && !points?.eligible && unusable.length === 0 && !(points && !points.eligible) && (
                <p className="py-8 text-center text-[13px] text-ink-500">{failed ? "Couldn't load your deals. You can still type a code." : "No deals for this shop right now."}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
