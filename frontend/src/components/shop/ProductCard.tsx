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
    if (!onAddToCart || outOfStock) return;
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
        background: "var(--shop-surface, #FFFFFF)",
        borderRadius: "var(--shop-r-card, 16px)",
        overflow: "hidden",
        boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
        cursor: "pointer",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
    >
      {/* Image */}
      <div style={{ position: "relative", paddingTop: "100%", background: "var(--shop-primary-tint, #E8F0FF)" }}>
        {product.primary_image ? (
          <img
            src={product.primary_image}
            alt={product.name}
            loading="lazy"
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 32 }}>
            {product.icon_emoji || "🛍️"}
          </div>
        )}

        {discount > 0 && (
          <span style={{
            position: "absolute", top: 8, right: 8, background: "#DC2626",
            color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 8px",
            borderRadius: "var(--shop-r-pill, 999px)",
          }}>
            -{discount}%
          </span>
        )}

        {product.images && product.images.length > 1 && (
          <span style={{
            position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.5)",
            color: "#fff", fontSize: 9, fontWeight: 600, padding: "2px 6px",
            borderRadius: "var(--shop-r-pill, 999px)",
          }}>
            {product.images.length} 📷
          </span>
        )}

        {outOfStock && (
          <div style={{
            position: "absolute", inset: 0, background: "rgba(11,11,15,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 13, fontWeight: 600, letterSpacing: 0.3,
          }}>
            Out of Stock
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "10px 12px" }}>
        {product.merchant_name && (
          <p style={{ fontSize: 10, color: "var(--shop-muted, #8A8F9C)", marginBottom: 2 }}>{product.merchant_name}</p>
        )}

        <div style={{
          fontSize: 13, fontWeight: 500, color: "var(--shop-black, #0B0B0F)", lineHeight: 1.35,
          marginBottom: 4, overflow: "hidden", display: "-webkit-box",
          WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>
          {product.name}
        </div>

        {(product.rating_avg || 0) > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
            <span style={{ fontSize: 11 }}>⭐</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--shop-black, #0B0B0F)" }}>{(product.rating_avg || 0).toFixed(1)}</span>
            {(product.review_count || 0) > 0 && <span style={{ fontSize: 10, color: "var(--shop-muted, #8A8F9C)" }}>({product.review_count})</span>}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--shop-primary, #1E6BFF)" }}>
              ${product.base_price.toFixed(2)}
            </span>
            {discount > 0 && product.compare_price && (
              <span style={{ fontSize: 12, color: "var(--shop-muted, #8A8F9C)", textDecoration: "line-through" }}>
                ${product.compare_price.toFixed(2)}
              </span>
            )}
          </div>

          {onAddToCart && !outOfStock && (
            <button
              onClick={handleAdd}
              disabled={adding || added}
              style={{
                padding: "4px 10px", borderRadius: "var(--shop-r-pill, 999px)", border: "none",
                background: added ? "#16A34A" : "var(--shop-primary, #1E6BFF)",
                color: "#fff", fontSize: 12, fontWeight: 600,
                cursor: adding ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                transition: "background 0.2s",
              }}
            >
              {added ? "✓" : "+ Add"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
