const STEPS = [
  { key: "pending", label: "Ordered", msg: "Your order has been placed" },
  { key: "confirmed", label: "Confirmed", msg: "Merchant confirmed your order" },
  { key: "processing", label: "Packaged", msg: "Order is being prepared" },
  { key: "shipped", label: "Shipped", msg: "Order is on the way" },
  { key: "delivered", label: "Delivered", msg: "Order delivered successfully" },
];

interface OrderTimelineProps {
  currentStatus: string;
}

export function OrderTimeline({ currentStatus }: OrderTimelineProps) {
  const stepIdx = STEPS.findIndex((s) => s.key === currentStatus);

  return (
    <div
      style={{
        background: "var(--shop-surface, #FFFFFF)",
        borderRadius: "var(--shop-r-card, 16px)",
        padding: 16,
        boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--shop-black, #0B0B0F)", marginBottom: 12, marginTop: 0 }}>Order Progress</h3>
      {STEPS.map((step, i) => {
        const done = i <= stepIdx;
        const isCurrent = i === stepIdx;
        return (
          <div key={step.key} style={{ display: "flex", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div
                style={{
                  width: 28, height: 28, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700,
                  background: done ? "var(--shop-primary, #1E6BFF)" : "var(--shop-divider, #ECEEF3)",
                  color: done ? "#fff" : "var(--shop-muted, #8A8F9C)",
                  border: isCurrent ? "2px solid var(--shop-primary-dark, #1751C4)" : "none",
                }}
              >
                {done ? "✓" : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ width: 2, height: 32, background: done ? "var(--shop-primary, #1E6BFF)" : "var(--shop-divider, #ECEEF3)" }} />
              )}
            </div>
            <div style={{ paddingBottom: 8 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--shop-black, #0B0B0F)", margin: 0 }}>{step.label}</p>
              <p style={{ fontSize: 11, color: "var(--shop-muted, #8A8F9C)", margin: "2px 0 0" }}>{step.msg}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
