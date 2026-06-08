"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Product } from "@/types";

interface ProductCardProps {
  product: Product;
  onAddToCart?: (productId: number) => Promise<void>;
}

export function ProductCard({ product, onAddToCart }: ProductCardProps) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const discount = product.compare_price && product.compare_price > product.base_price
    ? Math.round((1 - product.base_price / product.compare_price) * 100)
    : 0;

  const outOfStock = product.stock === 0;

  async function handleAdd(e: React.MouseEvent) {
    e.stopPropagation();
    if (outOfStock) return;
    // Products with size/color must be configured on the detail page first.
    if (product.has_variants) {
      router.push(`/shop/product/${product.id}`);
      return;
    }
    if (!onAddToCart) return;
    setAdding(true);
    try {
      await onAddToCart(product.id);
      setAdded(true);
      setTimeout(() => setAdded(false), 1500);
    } catch { /* ignore */ }
    setAdding(false);
  }

  return (
    <div
      onClick={() => router.push(`/shop/product/${product.id}`)}
      style={{
        background: "var(--shop-surface)",
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: "0 4px 16px rgba(8, 29, 60, 0.06)",
        cursor: "pointer",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
    >
      {/* Image */}
      <div style={{ position: "relative", paddingTop: "100%", background: "var(--shop-divider)" }}>
        {product.primary_image ? (
          <img
            src={product.primary_image}
            alt={product.name}
            loading="lazy"
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--shop-muted)" strokeWidth="1.5">
              <rect x="2" y="2" width="20" height="20" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}

        {/* Badges - left aligned, stacked */}
        <div style={{
          position: "absolute", top: 8, left: 0,
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          {discount > 0 && (
            <span className="product-badge product-badge-discount">
              -{discount}% OFF
            </span>
          )}
        </div>

        {product.images && product.images.length > 1 && (
          <span style={{
            position: "absolute", top: 8, right: 8, background: "rgba(8,29,60,0.6)",
            color: "#fff", fontSize: 9, fontWeight: 600, padding: "2px 6px",
            borderRadius: 4, fontFamily: "'Inter', sans-serif",
          }}>
            {product.images.length}
          </span>
        )}

        {outOfStock && (
          <div style={{
            position: "absolute", inset: 0, background: "rgba(8,29,60,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 13, fontWeight: 600,
            fontFamily: "'Kantumruy Pro', sans-serif",
          }}>
            Out of Stock
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "8px 10px 12px" }}>
        {product.merchant_name && (
          <p style={{
            fontSize: 10, fontWeight: 600, color: "var(--shop-accent)",
            fontFamily: "'Kantumruy Pro', sans-serif",
            textTransform: "uppercase", lineHeight: "12px",
            marginBottom: 2,
          }}>
            {product.merchant_name}
          </p>
        )}

        <div style={{
          fontSize: 12, fontWeight: 500, color: "var(--shop-text)",
          fontFamily: "'Kantumruy Pro', sans-serif",
          lineHeight: "14px", marginBottom: 4,
          overflow: "hidden", display: "-webkit-box",
          WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>
          {product.name}
        </div>

        {(product.rating_avg || 0) > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="var(--shop-accent)" stroke="none">
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
            </svg>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--shop-text)", fontFamily: "'Kantumruy Pro', sans-serif" }}>
              {(product.rating_avg || 0).toFixed(1)}
            </span>
            <span style={{ fontSize: 10, color: "var(--shop-muted)" }}>&middot;</span>
            {(product.review_count || 0) > 0 && (
              <span style={{ fontSize: 10, color: "var(--shop-muted)", fontFamily: "'Inter', sans-serif" }}>
                {product.review_count} reviews
              </span>
            )}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{
              fontSize: 15, fontWeight: 600, color: "var(--shop-accent)",
              fontFamily: "'Kantumruy Pro', sans-serif",
            }}>
              ${product.base_price.toFixed(2)}
            </span>
            {discount > 0 && product.compare_price && (
              <span style={{
                fontSize: 10, color: "var(--shop-muted)",
                textDecoration: "line-through",
                fontFamily: "'Kantumruy Pro', sans-serif",
              }}>
                ${product.compare_price.toFixed(2)}
              </span>
            )}
          </div>

          {onAddToCart && !outOfStock && (
            <button
              onClick={handleAdd}
              disabled={adding || added}
              style={{
                padding: "6px 12px", borderRadius: 8, border: "none",
                background: added ? "#10B981" : "var(--shop-accent)",
                color: "#fff", fontSize: 12, fontWeight: 500,
                cursor: adding ? "not-allowed" : "pointer",
                fontFamily: "'Kantumruy Pro', sans-serif",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                transition: "background 0.2s",
              }}
            >
              {added ? "Added" : product.has_variants ? "Select" : "Add"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
