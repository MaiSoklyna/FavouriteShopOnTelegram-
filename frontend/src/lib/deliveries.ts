import type { DriverJob } from "@/types";

/** What the driver's screen says for each delivery status. */
export const DELIVERY_LABEL: Record<string, string> = {
  assigned: "New job",
  accepted: "Go to the shop",
  picked_up: "On the way to the customer",
  delivered: "Delivered",
  failed: "Not delivered",
  cancelled: "Cancelled",
  declined: "Declined",
};

/** What the customer's order page says. */
export const CUSTOMER_DELIVERY_LABEL: Record<string, string> = {
  assigned: "A driver was assigned",
  accepted: "Your driver is heading to the shop",
  picked_up: "Your driver is on the way to you",
  delivered: "Delivered",
  failed: "The delivery didn't work out. The shop will arrange another.",
};

/** The one primary action for a job (plus the secondary ones the screen adds), or null when there is nothing to do. */
export function nextAction(status: string): { action: "accept" | "pickup" | "deliver"; label: string } | null {
  if (status === "assigned") return { action: "accept", label: "Accept job" };
  if (status === "accepted") return { action: "pickup", label: "I picked it up" };
  if (status === "picked_up") return { action: "deliver", label: "Delivered" };
  return null;
}

export const isFinished = (status: string) => ["delivered", "failed", "cancelled", "declined"].includes(status);

/** Open the map app with directions to a place: by pin when we have one, else by address. */
export function directionsUrl(place: { lat?: number | null; lng?: number | null; address?: string | null }): string | null {
  if (place.lat != null && place.lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;
  if (place.address) return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.address)}`;
  return null;
}

/** tel: link that keeps only what a dialler accepts. */
export const telUrl = (phone?: string | null) => (phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null);

export const money = (n: number | string) => `$${Number(n).toFixed(2)}`;

export function jobTitle(job: DriverJob): string {
  return `${job.order.code} · ${job.order.item_count} ${job.order.item_count === 1 ? "item" : "items"}`;
}
