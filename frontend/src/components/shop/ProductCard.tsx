"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Product } from "@/types";
import { lightHaptic } from "@/lib/haptics";
import { useWishlist } from "@/lib/useWishlist";
import { isOutOfStock, OutOfStockOverlay } from "./OutOfStock";
import { PriceTag } from "./PriceTag";
import { RatingPill } from "./Pill";
import { Icon } from "./Icon";

interface ProductCardProps {
  product: Product;
  onAddToCart?: (productId: number) => Promise<void>;
}

/**
 * 165.5 × auto in a 2-column grid. Image 1:1, mango discount badge,
 * heart (top-right), navy "+" add button (bottom-right of the image).
 */
export function ProductCard({ product, onAddToCart }: ProductCardProps) {
  const router = useRouter();
  const wish = useWishlist();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [popKey, setPopKey] = useState(0);

  const discount = product.compare_price && product.compare_price > product.base_price
    ? Math.round((1 - product.base_price / product.compare_price) * 100)
    : 0;
  const outOfStock = isOutOfStock(product);
  const hearted = wish.has(product.id);
  const open = () => router.push(`/shop/product/${product.id}`);

  async function handleAdd(e: React.MouseEvent) {
    e.stopPropagation();
    if (outOfStock || adding) return;
    // Products with size/color must be configured on the detail page first.
    if (product.has_variants) { open(); return; }
    if (!onAddToCart) { open(); return; }
    setAdding(true);
    try {
      await onAddToCart(product.id);
      lightHaptic();
      setAdded(true);
      setTimeout(() => setAdded(false), 1200);
    } catch { /* the cart provider surfaces its own errors */ }
    setAdding(false);
  }

  function handleHeart(e: React.MouseEvent) {
    e.stopPropagation();
    wish.toggle(product.id);
    setPopKey((k) => k + 1);
    lightHaptic();
  }

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === "Enter") open(); }}
      className="fos-press cursor-pointer overflow-hidden rounded-card bg-card shadow-fos-md"
    >
      {/* Image 1:1 on a tinted background */}
      <div className="relative aspect-square bg-surface">
        {product.primary_image ? (
          <img src={product.primary_image} alt={product.name} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-4xl">{product.icon_emoji || <Icon name="box" size={36} className="text-line" />}</div>
        )}

        {discount > 0 && (
          <span className="absolute left-2 top-2 rounded-full bg-mango-500 px-2 py-0.5 text-[11px] font-extrabold text-white">-{discount}%</span>
        )}

        <button
          type="button"
          aria-label={hearted ? "Remove from favourites" : "Add to favourites"}
          aria-pressed={hearted}
          onClick={handleHeart}
          className="absolute right-2 top-2 grid h-[30px] w-[30px] place-items-center rounded-full bg-card/90 before:absolute before:-inset-[7px] before:content-['']"
        >
          <svg key={popKey} className={popKey ? "fos-pop" : ""} width="16" height="16" viewBox="0 0 24 24" fill={hearted ? "#E5484D" : "none"} stroke={hearted ? "#E5484D" : "#0E1A2B"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
          </svg>
        </button>

        {!outOfStock && (
          <button
            type="button"
            aria-label={product.has_variants ? "Choose options" : "Add to cart"}
            disabled={adding}
            onClick={handleAdd}
            className="fos-press absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-md bg-navy-900 text-white before:absolute before:-inset-[6px] before:content-['']"
          >
            {added ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12l5 5 9-10" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
            )}
          </button>
        )}
        {outOfStock && <OutOfStockOverlay />}
      </div>

      <div className="px-3 pb-3 pt-2.5">
        <p className="truncate text-[13px] font-semibold text-ink-900">{product.name}</p>
        <PriceTag usd={product.base_price} oldUsd={discount > 0 ? product.compare_price : null} className="mt-1" />
        {(product.rating_avg || 0) > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <RatingPill rating={product.rating_avg} />
            {/* "N sold" pill is not shown: the products API has no sold count */}
          </div>
        )}
      </div>
    </div>
  );
}
