"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { promotionCard, type Promotion, type PromotionRow } from "@/lib/promotions";
import { PromotionCard } from "./PromotionCard";

/** The shop page's "Offers" rail: promotions for this shop (and platform-wide ones) shown at the 'shop_page' location. */
export function ShopOffers({ merchantId }: { merchantId: number }) {
  const [offers, setOffers] = useState<Promotion[]>([]);

  useEffect(() => {
    let alive = true;
    api.get<PromotionRow[]>("/promotions", { params: { location: "shop_page", merchant_id: merchantId } })
      .then((rows) => { if (alive) setOffers(rows.map(promotionCard)); })
      .catch(() => { /* no promotions table yet, or none here */ });
    return () => { alive = false; };
  }, [merchantId]);

  if (offers.length === 0) return null;

  return (
    <section className="mt-5">
      <h2 className="px-gutter text-section text-ink-900">Offers</h2>
      <div className="fos-no-scrollbar mt-2.5 flex snap-x items-start gap-3 overflow-x-auto scroll-px-4 px-gutter pb-2">
        {offers.map((p) => <PromotionCard key={p.id} promo={p} />)}
      </div>
    </section>
  );
}
