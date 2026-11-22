"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { RATING_WORDS, StarInput, Stars } from "./Stars";
import type { Order } from "@/types";

/**
 * On a delivered order: rate the shop (once). Shows the form until the customer has reviewed,
 * then their review. The "How was your order?" notification lands here.
 */
export function ShopReviewCard({ order, shopName, onSubmitted }: { order: Order; shopName: string; onSubmitted: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Until the shop's details arrive the page falls back to "Shop"; say "the shop" rather than "How was Shop?"
  const name = shopName && shopName !== "Shop" ? shopName : "the shop";
  const mine = order.shop_review;
  if (mine) {
    return (
      <section id="shop-review" data-testid="shop-review-done" className="rounded-hero bg-card p-4 shadow-fos-sm">
        <h3 className="text-[14px] font-extrabold text-ink-900">Your review of {name}</h3>
        <Stars value={mine.rating} size={18} className="mt-1.5" />
        {mine.comment && <p className="mt-2 text-[13px] leading-5 text-ink-700">{mine.comment}</p>}
        <p className="mt-2 text-[11px] text-ink-500">Thanks for telling others how it went.</p>
      </section>
    );
  }

  async function submit() {
    if (rating < 1) { setError("Tap the stars to rate."); return; }
    setBusy(true); setError("");
    try {
      await api.post("/shop-reviews", { order_id: order.id, rating, comment: comment.trim() || undefined });
      onSubmitted();
    } catch (e: unknown) {
      setError((e instanceof Error && e.message) || "Could not send your review. Please try again.");
      setBusy(false);
    }
  }

  return (
    <section id="shop-review" data-testid="shop-review-form" className="rounded-hero bg-card p-4 shadow-fos-sm">
      <h3 className="text-[15px] font-extrabold text-ink-900">How was {name}?</h3>
      <p className="mt-0.5 text-caption text-ink-500">Your rating helps others choose.</p>
      <div className="mt-3 flex items-center gap-3">
        <StarInput value={rating} onChange={(n) => { setRating(n); setError(""); }} />
        <span className="text-[13px] font-extrabold text-gold-700" aria-live="polite">{RATING_WORDS[rating]}</span>
      </div>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={3}
        placeholder="Tell us more (optional)" aria-label="Your review"
        className="mt-3 w-full rounded-thumb border-[1.5px] border-line bg-surface p-3 text-[14px] text-ink-900" />
      {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-red-600">{error}</p>}
      <button type="button" onClick={submit} disabled={busy || rating < 1}
        className="fos-press mt-3 h-12 w-full rounded-thumb bg-grad-cta text-[15px] font-extrabold text-white shadow-fos-cta disabled:opacity-50">
        {busy ? "Sending…" : "Send review"}
      </button>
    </section>
  );
}
