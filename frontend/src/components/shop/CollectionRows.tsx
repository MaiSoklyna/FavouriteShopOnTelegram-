"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { PublicCollection } from "@/types";
import { ProductCard } from "./ProductCard";

/**
 * The shop's live collections, each as a sideways row of product cards with "See all".
 * Shows nothing while loading or when the shop has none (the page reads the same either way).
 */
export function CollectionRows({ merchantId, onAddToCart }: {
  merchantId: number;
  onAddToCart?: (productId: number) => Promise<void>;
}) {
  const [rows, setRows] = useState<PublicCollection[]>([]);
  useEffect(() => {
    let live = true;
    api.get<PublicCollection[]>(`/merchants/${merchantId}/collections`, { token: null })
      .then((r) => { if (live) setRows(r); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [merchantId]);

  if (rows.length === 0) return null;
  return (
    <div data-testid="shop-collections" className="mt-5 flex flex-col gap-5">
      {rows.map((c) => {
        const href = `/shop/merchant/${merchantId}/collections/${c.id}`;
        return (
          <section key={c.id} aria-label={c.title}>
            <div className="flex items-end justify-between gap-3 px-gutter">
              <div className="min-w-0">
                <h2 className="truncate text-section font-extrabold text-ink-900">{c.title}</h2>
                {c.description && <p className="truncate text-caption text-ink-500">{c.description}</p>}
              </div>
              <Link href={href} className="shrink-0 text-[13px] font-extrabold text-navy-700">
                See all{c.product_count > c.products.length ? ` (${c.product_count})` : ""}
              </Link>
            </div>
            <div className="fos-no-scrollbar mt-2.5 flex gap-3 overflow-x-auto px-gutter pb-1">
              {c.products.map((p) => (
                <div key={p.id} className="w-[158px] shrink-0">
                  <ProductCard product={p} onAddToCart={onAddToCart} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
