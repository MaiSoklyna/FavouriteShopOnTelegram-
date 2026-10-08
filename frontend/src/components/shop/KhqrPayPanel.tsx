"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface QrData {
  payment_status: string;
  amount?: string;
  qr_image?: string;
  deeplink?: string;
  expires_in?: number;
}

/**
 * Pay an unpaid ABA KHQR order from its order page (the "Pay now" link in
 * Telegram, or after choosing "Pay Later" at checkout). Polls the backend,
 * which confirms with PayWay, and calls onPaid once the order is paid.
 */
export function KhqrPayPanel({ orderId, total, onPaid }: { orderId: number; total: number; onPaid: () => void }) {
  const [qr, setQr] = useState<QrData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [timer, setTimer] = useState(0);

  const loadQr = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await api.post<{ data: QrData }>(`/payments/payway/orders/${orderId}/qr`);
      if (res.data.payment_status === "paid") { onPaid(); return; }
      setQr(res.data);
      setTimer(res.data.expires_in || 900);
    } catch (err: any) {
      setError(err?.detail || "Could not create the payment QR. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [orderId, onPaid]);

  // Countdown
  useEffect(() => {
    if (!qr || timer <= 0) return;
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [qr, timer]);

  // Poll for payment while a QR is showing
  useEffect(() => {
    if (!qr || timer <= 0) return;
    let stopped = false;
    const id = setInterval(async () => {
      try {
        const res = await api.get<{ data: { payment_status: string } }>(`/payments/payway/orders/${orderId}/status`);
        if (!stopped && res.data?.payment_status === "paid") {
          stopped = true;
          clearInterval(id);
          onPaid();
        }
      } catch { /* keep polling */ }
    }, 4000);
    return () => { stopped = true; clearInterval(id); };
  }, [qr, timer > 0, orderId, onPaid]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div style={{
      background: "var(--shop-surface, #FFFFFF)",
      borderRadius: "var(--shop-r-card, 16px)", padding: 20, marginBottom: 12,
      boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
      border: "1.5px solid #FFB74D", textAlign: "center",
    }}>
      <p style={{ fontSize: 15, fontWeight: 700, color: "#E65100", margin: 0 }}>⏳ Awaiting payment</p>
      <p style={{ fontSize: 13, color: "var(--shop-muted, #8A8F9C)", margin: "6px 0 14px" }}>
        This order goes to the shop once your ABA KHQR payment is received.
      </p>

      {qr && timer > 0 ? (
        <>
          {qr.qr_image && (
            <img src={qr.qr_image} alt="ABA KHQR"
              style={{ width: 220, maxWidth: "100%", margin: "0 auto 12px", borderRadius: 12, display: "block" }} />
          )}
          <p style={{ fontSize: 24, fontWeight: 700, color: "var(--shop-primary, #1E6BFF)", margin: 0 }}>${qr.amount}</p>
          <p style={{ fontSize: 12, color: "#E65100", fontWeight: 600, margin: "6px 0 12px" }}>
            Expires in {fmt(timer)} · this page updates automatically
          </p>
          {qr.deeplink && (
            <a href={qr.deeplink} style={{
              display: "block", padding: 12, marginBottom: 4,
              background: "var(--shop-primary, #1E6BFF)", color: "#FFFFFF",
              borderRadius: "var(--shop-r-input, 12px)", fontWeight: 600, fontSize: 14, textDecoration: "none",
            }}>
              Pay with ABA Mobile
            </a>
          )}
        </>
      ) : (
        <>
          {error && <p style={{ fontSize: 12, color: "#C62828", margin: "0 0 10px" }}>{error}</p>}
          {qr && timer <= 0 && <p style={{ fontSize: 12, color: "#C62828", margin: "0 0 10px" }}>QR expired</p>}
          <button onClick={loadQr} disabled={loading} style={{
            width: "100%", padding: 12, border: "none",
            background: "var(--shop-primary, #1E6BFF)", color: "#FFFFFF",
            borderRadius: "var(--shop-r-input, 12px)", fontWeight: 600, fontSize: 14,
            cursor: loading ? "wait" : "pointer", opacity: loading ? 0.6 : 1,
          }}>
            {loading ? "Generating QR…" : qr ? "Generate new QR" : `Pay $${total.toFixed(2)} with ABA KHQR`}
          </button>
        </>
      )}
    </div>
  );
}
