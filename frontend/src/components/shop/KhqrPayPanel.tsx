"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatKhr } from "@/lib/currency";
import { Icon } from "./Icon";
import { KhqrCard, PaidSuccess, type KhqrData } from "./Khqr";

/**
 * Pay an unpaid ABA KHQR order from its order page (the "Pay now" link in
 * Telegram, or after choosing "Pay Later" at checkout). Polls the backend,
 * which confirms with PayWay, shows the Paid moment, then calls onPaid.
 */
export function KhqrPayPanel({ orderId, total, onPaid }: { orderId: number; total: number; onPaid: () => void }) {
  const [qr, setQr] = useState<KhqrData | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [timer, setTimer] = useState(0);
  const [paid, setPaid] = useState(false);
  const [done, setDone] = useState(false);

  const loadQr = useCallback(async () => {
    setOpen(true); setLoading(true); setError(""); setQr(null);
    try {
      const res = await api.post<{ data: KhqrData }>(`/payments/payway/orders/${orderId}/qr`);
      if (res.data.payment_status === "paid") { setPaid(true); return; }
      setQr(res.data);
      setTimer(res.data.expires_in || 900);
    } catch (err: any) {
      setError(err?.detail || err?.message || "Could not create the payment QR. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

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
          setPaid(true);
        }
      } catch { /* keep polling */ }
    }, 4000);
    return () => { stopped = true; clearInterval(id); };
  }, [qr, timer > 0, orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback(() => { setDone(true); onPaid(); }, [onPaid]);

  // Paid: celebrate, then step aside while the order page reloads
  if (done) return null;
  if (paid) return <PaidSuccess amount={total} cta="Back to order" onDone={finish} />;

  if (!open) {
    return (
      <section className="flex items-center gap-3 rounded-hero bg-white p-3.5 shadow-fos-sm ring-2 ring-mango-500/40">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[#E1232E] text-[10px] font-black tracking-wide text-white">KHQR</span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-extrabold text-ink-900">Pay to send your order</div>
          <div className="truncate text-caption text-ink-500">${total.toFixed(2)} · {formatKhr(total)} · any bank app</div>
        </div>
        <button type="button" onClick={loadQr}
          className="fos-press h-10 shrink-0 rounded-full bg-grad-promo px-4 text-[13px] font-extrabold text-white">
          Pay now
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-hero bg-grad-hero p-4 pb-5 text-white shadow-fos-md">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-section">Scan to pay</h3>
        <button type="button" onClick={() => setOpen(false)} aria-label="Hide QR"
          className="fos-press grid h-8 w-8 place-items-center rounded-full bg-white/10"><Icon name="close" size={16} /></button>
      </div>
      <KhqrCard data={qr} loading={loading} error={error} timer={timer} onRetry={loadQr} />
    </section>
  );
}
