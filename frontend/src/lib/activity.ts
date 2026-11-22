"use client";

import { api } from "@/lib/api";

/**
 * Tells the server what the customer just looked at, so shops and the platform can see interest and
 * where people drop off. Strictly fire-and-forget: it never waits, never throws and never shows anything,
 * so tracking can't slow down or break a page.
 *
 * Add to cart and orders are recorded by the server itself, so they are not sent from here.
 *
 * Privacy: no personal data is sent. A signed-out visitor is a random id this browser made up
 * (kept on the device only); a signed-in customer is known by their account.
 */

const SID_KEY = "fos_sid";
const RECENT_MS = 60_000;

type ActivityEvent =
  | { type: "product_view"; product_id: number }
  | { type: "shop_view"; merchant_id: number }
  | { type: "search"; query: string; result_count: number };

function sessionId(): string | null {
  try {
    let id = localStorage.getItem(SID_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(SID_KEY, id);
    }
    return id;
  } catch {
    return null; // storage blocked: the server then only counts signed-in customers
  }
}

// The same event twice in a minute (a double-mounting page, a quick back and forth) is sent once.
// The server also ignores repeats within half an hour; this only saves the request.
const recent = new Map<string, number>();

export function trackActivity(event: ActivityEvent): void {
  if (typeof window === "undefined") return;
  const key = JSON.stringify(event);
  const now = Date.now();
  const last = recent.get(key);
  if (last !== undefined && now - last < RECENT_MS) return;
  recent.set(key, now);
  const sid = sessionId();
  void api.post("/activity", { ...event, ...(sid ? { session_id: sid } : {}) }).catch(() => { /* best effort */ });
}
