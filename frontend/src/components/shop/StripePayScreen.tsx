"use client";

import { useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { api } from "@/lib/api";
import { STRIPE_DEMO_NOTE, STRIPE_TEST_CARDS } from "@/lib/paymentProviders";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";

interface IntentData {
  payment_status: string;
  client_secret?: string;
  order_code?: string;
  amount?: string;
  currency?: string;
}

/**
 * Full-screen card payment (Stripe Test Mode). The backend creates the
 * PaymentIntent and is the only thing that marks the order paid; this screen
 * just confirms the card and then asks the backend for the result.
 */
export function StripePayScreen({ orderId, onPaid, onLater }: {
  orderId: number;
  onPaid: () => void;
  onLater: () => void;
}) {
  const stripePromise = useMemo(() => (publishableKey ? loadStripe(publishableKey) : null), []);
  const [intent, setIntent] = useState<IntentData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.post<{ data: IntentData }>(`/payments/stripe/orders/${orderId}/intent`)
      .then((res) => {
        if (cancelled) return;
        if (res.data?.payment_status === "paid") onPaid();
        else setIntent(res.data);
      })
      .catch((e: unknown) => !cancelled && setError((e instanceof Error && e.message) || "Could not start card payment"));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  return (
    <div className="min-h-screen bg-grad-hero px-gutter pb-10 pt-6 text-white">
      <h1 className="text-center text-[20px] font-extrabold">Pay by card</h1>
      <p className="mt-1 text-center text-caption text-white/70">
        {intent?.order_code ? `Order ${intent.order_code}` : "Secure checkout"}
        {intent?.amount ? ` · ${intent.currency?.toUpperCase()} ${intent.amount}` : ""}
      </p>

      <div className="mx-auto mt-4 max-w-[380px] rounded-card bg-amber-100 px-3 py-2 text-center text-caption font-bold text-amber-900">
        {STRIPE_DEMO_NOTE}
      </div>

      <div className="mx-auto mt-4 max-w-[380px] rounded-card bg-card p-4 text-ink-900 shadow-fos-sm">
        {error && <p className="text-[14px] font-semibold text-red-600" role="alert">{error}</p>}
        {!publishableKey && !error && (
          <p className="text-[14px] font-semibold text-red-600" role="alert">Card payment is not configured (missing publishable key).</p>
        )}
        {!intent && !error && publishableKey && <p className="text-[14px] text-ink-500">Preparing payment…</p>}
        {intent?.client_secret && stripePromise && (
          <Elements stripe={stripePromise} options={{ clientSecret: intent.client_secret }}>
            <CardForm orderId={orderId} amount={intent.amount} onPaid={onPaid} />
          </Elements>
        )}
      </div>

      <div className="mx-auto mt-4 max-w-[380px] rounded-card bg-white/10 p-3 text-caption text-white/80">
        <p className="mb-1 font-bold text-white">Test cards (any future date, any CVC)</p>
        {STRIPE_TEST_CARDS.map((c) => (
          <p key={c.number} className="flex justify-between tabular-nums"><span>{c.label}</span><span className="font-mono">{c.number}</span></p>
        ))}
      </div>

      <button type="button" onClick={onLater} className="fos-press mx-auto mt-3 block h-[52px] w-full max-w-[380px] rounded-thumb bg-white/10 text-[15px] font-bold text-white">
        Pay later
      </button>
    </div>
  );
}

function CardForm({ orderId, amount, onPaid }: { orderId: number; amount?: string; onPaid: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true); setMessage("");
    const { error } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { payment_method_data: { billing_details: { address: { country: "KH" } } } },
    });
    if (error) {
      // Declined / failed: the order stays pending, so the customer can try another card.
      setMessage(error.message || "Payment failed. Please try another card.");
      setBusy(false);
      return;
    }
    // Card accepted. Ask our backend (which re-checks with Stripe) — it is the source of truth.
    for (let i = 0; i < 8; i++) {
      try {
        const res = await api.get<{ data: { payment_status: string } }>(`/payments/stripe/orders/${orderId}/status`);
        if (res.data?.payment_status === "paid") { onPaid(); return; }
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
    setMessage("Payment is processing. Check your orders in a moment.");
    setBusy(false);
  }

  return (
    <form onSubmit={pay} className="flex flex-col gap-3">
      <PaymentElement options={{
        layout: "tabs",
        fields: { billingDetails: { address: { country: "never" } } },
        wallets: { link: "never" } as never,
      }} />
      {message && <p className="text-[14px] font-semibold text-red-600" role="alert">{message}</p>}
      <button type="submit" disabled={!stripe || busy}
        className="fos-press h-[52px] w-full rounded-thumb bg-grad-cta text-[16px] font-extrabold text-white shadow-fos-cta disabled:opacity-50">
        {busy ? "Processing…" : amount ? `Pay ${amount}` : "Pay"}
      </button>
    </form>
  );
}
