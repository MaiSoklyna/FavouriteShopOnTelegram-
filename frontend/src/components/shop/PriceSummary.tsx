interface PriceSummaryProps {
  subtotal: number;
  deliveryFee: number;
  discount?: number;
}

export function PriceSummary({ subtotal, deliveryFee, discount = 0 }: PriceSummaryProps) {
  const total = subtotal + deliveryFee - discount;

  return (
    <div
      style={{
        background: "var(--shop-surface, #FFFFFF)",
        borderRadius: "var(--shop-r-card, 16px)",
        padding: 16,
        boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
      }}
    >
      <Row label="Subtotal" value={`$${subtotal.toFixed(2)}`} />
      <Row
        label="Delivery"
        value={deliveryFee === 0 ? "FREE" : `$${deliveryFee.toFixed(2)}`}
        valueColor={deliveryFee === 0 ? "#16A34A" : undefined}
      />
      {discount > 0 && (
        <Row label="Discount" value={`-$${discount.toFixed(2)}`} valueColor="#16A34A" />
      )}
      <div
        style={{
          height: 1,
          background: "var(--shop-divider, #ECEEF3)",
          margin: "6px 0",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 17, color: "var(--shop-black, #0B0B0F)" }}>Total</span>
        <span style={{ fontWeight: 700, fontSize: 17, color: "var(--shop-primary, #1E6BFF)" }}>${total.toFixed(2)}</span>
      </div>
    </div>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "6px 0" }}>
      <span style={{ color: "var(--shop-text, #4A4E5A)" }}>{label}</span>
      <span style={{ fontWeight: 500, color: valueColor || "var(--shop-black, #0B0B0F)" }}>{value}</span>
    </div>
  );
}
