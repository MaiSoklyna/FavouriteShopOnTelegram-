"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { EmptyState, ProductCard, Skeleton } from "@/components/shop";
import { Icon } from "@/components/shop/Icon";
import { useCart } from "@/providers/CartProvider";
import type { PublicCollection } from "@/types";

/** One of a shop's collections: cover, title, description, then its products in the shop's order. */
export default function ShopCollectionPage() {
  const { id, cid } = useParams<{ id: string; cid: string }>();
  const router = useRouter();
  const { addToCart } = useCart();
  const [data, setData] = useState<PublicCollection | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null); setMissing(false);
    api.get<PublicCollection>(`/collections/${cid}`, { token: null })
      .then((c) => { if (!live) return; if (String(c.merchant_id) !== String(id)) setMissing(true); else setData(c); })
      .catch(() => { if (live) setMissing(true); });
    return () => { live = false; };
  }, [id, cid]);

  if (missing) {
    return (
      <div className="min-h-screen bg-surface px-gutter pt-16">
        <EmptyState title="This collection is not available" action={{ label: "Back to the shop", href: `/shop/merchant/${id}` }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface pb-8">
      <div className="relative overflow-hidden bg-grad-hero text-white">
        {data?.cover_url && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={data.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" />
          </>
        )}
        <div className="relative px-gutter pb-5 pt-[max(14px,env(safe-area-inset-top))]">
          <button type="button" onClick={() => router.back()} aria-label="Back" className="fos-press grid h-10 w-10 place-items-center rounded-full bg-black/25">
            <Icon name="back" size={20} strokeWidth={2} />
          </button>
          {data ? (
            <>
              <Link href={`/shop/merchant/${id}`} className="mt-6 inline-block text-[12px] font-extrabold uppercase tracking-wide opacity-85">
                {data.merchant?.name ?? "Shop"}
              </Link>
              <h1 className="mt-1 text-display">{data.title}</h1>
              <p className="mt-1 text-[13px] font-semibold opacity-90">
                {data.description ? `${data.description} · ` : ""}{data.product_count} {data.product_count === 1 ? "product" : "products"}
              </p>
            </>
          ) : (
            <div className="mt-6 h-16" />
          )}
        </div>
      </div>

      <div className="px-gutter pt-4">
        {!data ? (
          <div className="grid grid-cols-2 gap-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[230px] rounded-card" />)}</div>
        ) : (
          <div className="grid grid-cols-2 gap-3" data-testid="collection-products">
            {data.products.map((p) => <ProductCard key={p.id} product={p} onAddToCart={addToCart} />)}
          </div>
        )}
      </div>
    </div>
  );
}
