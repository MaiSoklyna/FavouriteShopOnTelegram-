import type { Product } from "@/types";

/**
 * Same rule as the product detail page (`stock > 0` means in stock), so a
 * card and the full page always agree. Missing / null / negative / string
 * stock values all count as out of stock.
 */
export function isOutOfStock(product: Pick<Product, "stock">): boolean {
  return !(Number(product.stock) > 0);
}

/** Dimmed "Out of Stock" overlay for a product card's image area. */
export function OutOfStockOverlay({ compact = false }: { compact?: boolean }) {
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: "rgba(8,29,60,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontSize: compact ? 11 : 13, fontWeight: 600,
      fontFamily: "'Kantumruy Pro', sans-serif",
      backdropFilter: "blur(2px)",
      textAlign: "center", padding: 4,
    }}>
      Out of Stock
    </div>
  );
}
