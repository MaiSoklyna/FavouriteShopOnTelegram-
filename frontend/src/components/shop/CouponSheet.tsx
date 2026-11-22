"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CouponCard } from "./CouponCard";
import type { EligibleCoupon } from "@/types";

/**
 * Checkout: pick a coupon for this cart. Usable ones come first (best discount on top), the rest say
 * what is missing ("Spend $4.20 more"). A code can also be typed. The server prices whatever is chosen.
 */
export function CouponSheet({ merchantId, appliedCode, onApply, onClose }: {
  merchantId: number;
  appliedCode: string | null;
  onApply: (code: string | null) => void;
  onClose: () => void;
}) {
  const [coupons, setCoupons] = useState<EligibleCoupon[] | null>(null);
  const [bestId, setBestId] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(appliedCode);
  const [typed, setTyped] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api.get<{ data: EligibleCoupon[]; best_id: number | null }>("/coupons/eligible", { params: { merchant_id: merchantId } })
      .then((r) => { if (live) { setCoupons(r.data); setBestId(r.best_id); } })
      .catch(() => { if (live) { setCoupons([]); setFailed(true); } });
    return () => { live = false; };
  }, [merchantId]);

  const code = typed.trim().toUpperCase() || picked;
  const changed = code !== appliedCode;

  return (
    <div role="dialog" aria-modal="true" aria-label="Choose a coupon" className="fixed inset-0 z-[200] flex items-end bg-black/50" onClick={onClose}>
      <div className="mx-auto flex max-h-[85vh] w-full max-w-[480px] flex-col rounded-t-[24px] bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-gutter pb-2 pt-4">
          <h2 className="text-[17px] font-extrabold text-ink-900">Coupons</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="fos-press h-8 rounded-full px-3 text-[13px] font-bold text-ink-500">Close</button>
        </div>

        <div className="px-gutter pb-2">
          <div className="flex gap-2">
            <input value={typed} onChange={(e) => { setTyped(e.target.value.replace(/\s/g, "")); }} placeholder="Have a code? Type it here" aria-label="Coupon code"
              className="h-11 min-w-0 flex-1 rounded-thumb border-[1.5px] border-line bg-card px-3 font-mono text-[14px] uppercase tracking-wider text-ink-900" />
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-gutter pb-3">
          {coupons === null ? (
            <p className="py-8 text-center text-[13px] text-ink-500">Finding your coupons…</p>
          ) : coupons.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-ink-500">{failed ? "Couldn't load coupons. You can still type a code." : "No coupons for this shop right now."}</p>
          ) : coupons.map((c) => (
            <button key={c.id} type="button" disabled={!c.eligible} onClick={() => { setPicked(picked === c.code ? null : c.code); setTyped(""); }}
              role="radio" aria-checked={picked === c.code && !typed} aria-label={`${c.title} ${c.discount_text}`}
              className={`block w-full rounded-hero text-left ${picked === c.code && !typed ? "ring-2 ring-navy-700" : ""}`}>
              <CouponCard coupon={c} dimmed={!c.eligible}
                note={c.eligible ? (c.id === bestId ? `Best deal · saves $${c.discount.toFixed(2)}` : `Saves $${c.discount.toFixed(2)}`) : c.reason}>
                {null}
              </CouponCard>
            </button>
          ))}
        </div>

        <div className="flex gap-2 border-t border-line bg-card p-3">
          {appliedCode && (
            <button type="button" onClick={() => { onApply(null); onClose(); }}
              className="fos-press h-12 rounded-thumb border-[1.5px] border-line px-4 text-[14px] font-extrabold text-caution-500">Remove</button>
          )}
          <button type="button" disabled={!code || !changed} onClick={() => { onApply(code); onClose(); }}
            className="fos-press h-12 flex-1 rounded-thumb bg-grad-cta text-[15px] font-extrabold text-white shadow-fos-cta disabled:opacity-50">
            {code ? (changed ? "Apply coupon" : "Applied") : "Choose a coupon"}
          </button>
        </div>
      </div>
    </div>
  );
}
