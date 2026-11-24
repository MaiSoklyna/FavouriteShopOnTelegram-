"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { discountLabel } from "@/lib/promotions";
import { savePromo } from "@/lib/quote";
import { Icon } from "./Icon";
import type { PromoCode } from "@/types";

/**
 * Shown on a shop page opened from a shop-deal card (?promo=CODE). The code is checked
 * against the live active codes for this shop before the banner says it's applied, and
 * it is saved so this shop's checkout uses it. Hides itself after 6 s or on close.
 */
export function PromoAppliedBanner({ merchantId }: { merchantId: number }) {
  const [promo, setPromo] = useState<PromoCode | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("promo");
    if (!code) return;
    let alive = true;
    api.get<PromoCode[]>("/promos/active")
      .then((rows) => {
        const p = rows.find((r) => r.code.toUpperCase() === code.toUpperCase() && r.merchant_id === merchantId);
        if (!alive || !p) return;
        savePromo(p.code, p.merchant_id);
        setPromo(p);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [merchantId]);

  useEffect(() => {
    if (!promo) return;
    const t = setTimeout(() => setOpen(false), 6000);
    return () => clearTimeout(t);
  }, [promo]);

  if (!promo || !open) return null;

  return (
    <div role="status"
      className="fos-pop fixed inset-x-4 top-[max(64px,calc(env(safe-area-inset-top)+56px))] z-[120] mx-auto flex max-w-sm items-center gap-3 rounded-card bg-[#081D3C] px-3.5 py-3 shadow-fos-lg ring-1 ring-gold-400/40">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gold-400 text-[#081D3C]"><Icon name="check" size={18} strokeWidth={2.6} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-bold text-white/70">Promotion applied</span>
        <span className="flex items-baseline gap-2">
          <span className="truncate font-mono text-[15px] font-extrabold tracking-[0.06em] text-gold-400">{promo.code}</span>
          <span className="shrink-0 text-[13px] font-extrabold text-white">{discountLabel(promo)}</span>
        </span>
        {promo.min_order ? <span className="block text-[11px] text-white/60">At checkout on orders from ${Number(promo.min_order).toFixed(2)}</span> : null}
      </span>
      <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="fos-press grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/70">
        <Icon name="close" size={16} strokeWidth={2.4} />
      </button>
    </div>
  );
}
