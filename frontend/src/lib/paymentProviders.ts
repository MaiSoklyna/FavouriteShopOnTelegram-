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

/** Shown wherever Stripe is offered. */
export const STRIPE_DEMO_NOTE = "Demo environment using Stripe Test Mode.";

export const STRIPE_TEST_CARDS = [
  { label: "Payment succeeds", number: "4242 4242 4242 4242" },
  { label: "Card declined", number: "4000 0000 0000 0002" },
  { label: "Insufficient funds", number: "4000 0000 0000 9995" },
];
