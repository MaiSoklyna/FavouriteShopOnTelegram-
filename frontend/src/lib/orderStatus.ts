/**
 * Customer-facing wording for an order's progress. The order row has one
 * `status` column (pending → confirmed → processing → shipped → delivered, or
 * cancelled) plus `created_at` and `paid_at`; there are no per-step
 * timestamps in the live database, so only those two steps show a time.
 */
import type { IconName } from "@/components/shop/Icon";

export interface TrackOrder {
  status: string;
  delivery_type?: string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  created_at?: string | null;
  paid_at?: string | null;
  merchant_name?: string | null;
}

export interface TrackStep {
  key: string;
  label: string;
  detail: string;
  icon: IconName;
  at?: string | null;
  /** What we're waiting on, shown instead of `detail` while this is the current step */
  waiting?: string;
  state: "done" | "current" | "todo";
}

const FLOW = ["pending", "confirmed", "processing", "shipped", "delivered"];
export const ACTIVE_STATUSES = FLOW.slice(0, 4);

export const isPickup = (o: TrackOrder) => o.delivery_type === "pickup";
/** A KHQR order waits for its payment before the shop sees it. */
export const awaitingPayment = (o: TrackOrder) =>
  o.payment_method === "khqr" && o.payment_status !== "paid" && o.status === "pending";

export function trackSteps(o: TrackOrder): TrackStep[] {
  const shop = o.merchant_name || "The shop";
  const pickup = isPickup(o);
  const steps: Omit<TrackStep, "state">[] = [
    { key: "pending", label: "Order placed", detail: "We sent your order to the shop", icon: "list", at: o.created_at },
  ];
  if (o.payment_method === "khqr") {
    steps.push({ key: "paid", label: "Paid with KHQR", detail: "Payment received", waiting: "Scan the KHQR above to pay", icon: "check", at: o.paid_at });
  }
  steps.push(
    { key: "confirmed", label: "Confirmed", detail: `${shop} accepted your order`, waiting: `Waiting for ${shop} to accept`, icon: "store" },
    { key: "processing", label: "Preparing", detail: "Your items are being packed", icon: "box" },
    pickup
      ? { key: "shipped", label: "Ready for pickup", detail: `Collect it at ${shop}`, icon: "bag" }
      : { key: "shipped", label: "On the way", detail: "A rider is bringing your order", icon: "truck" },
    pickup
      ? { key: "delivered", label: "Picked up", detail: "Enjoy your order", icon: "party" }
      : { key: "delivered", label: "Delivered", detail: "Enjoy your order", icon: "party" },
  );

  // The step happening now. A pending order is waiting on the next step
  // (payment, or the shop confirming); later statuses are the step itself.
  let current: number;
  if (o.status === "delivered") current = steps.length;
  else if (o.status === "pending") current = steps.findIndex((s) => s.key === (awaitingPayment(o) ? "paid" : "confirmed"));
  else current = steps.findIndex((s) => s.key === o.status);
  return steps.map((s, i) => ({ ...s, state: i < current ? "done" : i === current ? "current" : "todo" }));
}

export interface Headline {
  title: string;
  sub: string;
  icon: IconName;
  tone: "navy" | "mango" | "jade" | "ruby";
}

export function headline(o: TrackOrder): Headline {
  const shop = o.merchant_name || "the shop";
  const pickup = isPickup(o);
  if (o.status === "cancelled") return { title: "Order cancelled", sub: "Any stock was returned to the shop", icon: "close", tone: "ruby" };
  if (awaitingPayment(o)) return { title: "Waiting for payment", sub: `${shop} gets your order once it's paid`, icon: "clock", tone: "mango" };
  switch (o.status) {
    case "pending": return { title: "Waiting for the shop", sub: `${shop} will confirm shortly`, icon: "clock", tone: "navy" };
    case "confirmed": return { title: "Order confirmed", sub: `${shop} accepted your order`, icon: "store", tone: "navy" };
    case "processing": return { title: "Preparing your order", sub: `${shop} is packing your items`, icon: "box", tone: "navy" };
    case "shipped": return pickup
      ? { title: "Ready for pickup", sub: `Collect it at ${shop}`, icon: "bag", tone: "mango" }
      : { title: "On the way", sub: "Your rider is heading to you", icon: "truck", tone: "mango" };
    case "delivered": return { title: pickup ? "Picked up" : "Delivered", sub: "Thanks for shopping with Byme24", icon: "party", tone: "jade" };
    default: return { title: o.status, sub: "", icon: "list", tone: "navy" };
  }
}

/** 0..1 along the status flow — for the small bar on order cards. */
export function progress(o: TrackOrder): number {
  if (o.status === "cancelled") return 0;
  const i = FLOW.indexOf(o.status);
  return i < 0 ? 0 : (i + 1) / FLOW.length;
}

/** Short status word for pills. */
export function statusLabel(o: TrackOrder): string {
  if (awaitingPayment(o)) return "Unpaid";
  const map: Record<string, string> = {
    pending: "Placed", confirmed: "Confirmed", processing: "Preparing",
    shipped: isPickup(o) ? "Ready" : "On the way", delivered: isPickup(o) ? "Picked up" : "Delivered", cancelled: "Cancelled",
  };
  return map[o.status] ?? o.status;
}

/** "Today 14:05", "Yesterday 09:12", "Oct 21, 14:05". */
export function formatWhen(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}
