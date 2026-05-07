"use client";

import type { CartItem as CartItemType } from "@/types";

interface CartItemProps {
  item: CartItemType;
  onUpdateQuantity: (id: number, qty: number) => void;
  onRemove: (id: number) => void;
}

export function CartItemCard({ item, onUpdateQuantity, onRemove }: CartItemProps) {
  return (
    <div
      style={{
        display: "flex", gap: 12, background: "var(--shop-surface, #FFFFFF)",
        borderRadius: "var(--shop-r-card, 16px)", padding: 14,
        boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
      }}
    >
      {/* Image */}
      <div
        style={{
          width: 72, height: 72, borderRadius: "var(--shop-r-input, 12px)",
          background: "var(--shop-primary-tint, #E8F0FF)", flexShrink: 0, overflow: "hidden",
        }}
      >
        {item.primary_image ? (
          <img src={item.primary_image} alt={item.product_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "var(--shop-muted, #8A8F9C)" }}>
            {item.product_name?.[0]?.toUpperCase() || "?"}
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 500, color: "var(--shop-black, #0B0B0F)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>
            {item.product_name}
          </h3>
          {item.merchant_name && (
            <p style={{ fontSize: 12, color: "var(--shop-muted, #8A8F9C)", marginTop: 2, margin: "2px 0 0" }}>{item.merchant_name}</p>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
          {/* Price */}
          <span style={{ fontWeight: 700, fontSize: 16, color: "var(--shop-primary, #1E6BFF)" }}>
            ${item.line_total.toFixed(2)}
          </span>

          {/* Quantity stepper */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
              style={{
                width: 26, height: 26, borderRadius: "50%", border: "1px solid var(--shop-divider, #ECEEF3)",
                background: "var(--shop-surface, #FFFFFF)", cursor: "pointer", fontSize: 14,
                color: "var(--shop-muted, #8A8F9C)", display: "flex", alignItems: "center", justifyContent: "center",
                padding: 0, lineHeight: 1,
              }}
            >
              −
            </button>
            <span style={{ width: 22, textAlign: "center", fontWeight: 700, fontSize: 13, color: "var(--shop-black, #0B0B0F)" }}>
              {item.quantity}
            </span>
            <button
              onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
              style={{
                width: 26, height: 26, borderRadius: "50%", border: "1px solid var(--shop-primary, #1E6BFF)",
                background: "var(--shop-primary-tint, #E8F0FF)", cursor: "pointer", fontSize: 14,
                color: "var(--shop-primary, #1E6BFF)", display: "flex", alignItems: "center", justifyContent: "center",
                padding: 0, lineHeight: 1,
              }}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Remove action */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "flex-start" }}>
        <button
          onClick={() => onRemove(item.id)}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#DC2626", fontSize: 11, fontWeight: 500, padding: "2px 0",
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
