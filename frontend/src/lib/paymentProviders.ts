import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Which online payment methods checkout offers. Cash on delivery is always on.
 *
 * Demo setup: Stripe Test Mode only. KHQR (ABA PayWay) code stays in the repo
 * and is switched back on by adding it to the env var, no code change:
 *
 *   NEXT_PUBLIC_PAYMENT_METHODS=stripe,khqr
 */
export type OnlineMethod = "stripe" | "khqr";
export type PaymentMethod = OnlineMethod | "cod";

const raw = process.env.NEXT_PUBLIC_PAYMENT_METHODS ?? "stripe";
export const ENABLED_ONLINE: OnlineMethod[] = raw
  .split(",")
  .map((s) => s.trim())
  .filter((s): s is OnlineMethod => s === "stripe" || s === "khqr");

export const isEnabled = (m: OnlineMethod) => ENABLED_ONLINE.includes(m);

/**
 * The online methods checkout may offer: switched on here AND confirmed by the server
 * (GET /payments/methods: it has the keys). Empty until the server answers, so checkout never offers a
 * method that can't be paid (2026-11-25: card was shown while production had no Stripe key).
 */
export function useOnlineMethods(): { methods: OnlineMethod[]; loaded: boolean } {
  const [state, setState] = useState<{ methods: OnlineMethod[]; loaded: boolean }>({ methods: [], loaded: false });
  useEffect(() => {
    let live = true;
    api.get<{ data: { methods: string[] } }>("/payments/methods")
      .then((r) => { if (live) setState({ methods: ENABLED_ONLINE.filter((m) => r.data.methods.includes(m)), loaded: true }); })
      .catch(() => { if (live) setState({ methods: [], loaded: true }); });
    return () => { live = false; };
  }, []);
  return state;
}

/** Shown wherever Stripe is offered. */
export const STRIPE_DEMO_NOTE = "Demo environment using Stripe Test Mode.";

export const STRIPE_TEST_CARDS = [
  { label: "Payment succeeds", number: "4242 4242 4242 4242" },
  { label: "Card declined", number: "4000 0000 0000 0002" },
  { label: "Insufficient funds", number: "4000 0000 0000 9995" },
];
