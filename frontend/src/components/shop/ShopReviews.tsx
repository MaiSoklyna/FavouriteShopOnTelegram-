"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Stars } from "./Stars";
import type { ShopReview, ShopReviewSummary } from "@/types";

const PAGE = 5;

/** What customers said about a shop: the average, the spread of stars and the latest reviews. */
export function ShopReviews({ merchantId }: { merchantId: number }) {
  const [summary, setSummary] = useState<ShopReviewSummary | null>(null);
  const [reviews, setReviews] = useState<ShopReview[]>([]);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let live = true;
    api.get<{ summary: ShopReviewSummary; reviews: ShopReview[] }>(`/shop-reviews/shops/${merchantId}`, { params: { limit: PAGE } })
      .then((r) => { if (!live) return; setSummary(r.summary); setReviews(r.reviews); setMore(r.reviews.length >= PAGE); })
      .catch(() => {});
    return () => { live = false; };
  }, [merchantId]);

  const loadMore = useCallback(async () => {
    const last = reviews[reviews.length - 1]?.id;
    if (!last) return;
    setLoadingMore(true);
    try {
      const r = await api.get<{ reviews: ShopReview[] }>(`/shop-reviews/shops/${merchantId}`, { params: { limit: PAGE, before: last } });
      setReviews((cur) => [...cur, ...r.reviews]);
      setMore(r.reviews.length >= PAGE);
    } catch { /* keep what is shown */ }
    finally { setLoadingMore(false); }
  }, [merchantId, reviews]);

  if (!summary) return null;
  if (summary.count === 0) {
    return (
      <section data-testid="shop-reviews" className="mx-gutter mt-5 rounded-hero bg-card p-4 text-center shadow-fos-sm">
        <h2 className="text-section text-ink-900">Reviews</h2>
        <p className="mt-1 text-caption text-ink-500">No reviews yet. Order from this shop and tell others how it went.</p>
      </section>
    );
  }
  return (
    <section data-testid="shop-reviews" className="mx-gutter mt-5 rounded-hero bg-card p-4 shadow-fos-sm">
      <h2 className="text-section text-ink-900">Reviews</h2>
      <div className="mt-3 flex items-center gap-4">
        <div className="text-center">
          <div className="text-[36px] font-extrabold leading-9 tabular-nums text-ink-900">{summary.rating?.toFixed(1)}</div>
          <Stars value={summary.rating ?? 0} size={14} />
          <div className="mt-1 text-[11px] font-semibold text-ink-500">{summary.count} review{summary.count === 1 ? "" : "s"}</div>
        </div>
        <div className="flex-1 space-y-1" aria-label="Rating breakdown">
          {["5", "4", "3", "2", "1"].map((star) => {
            const n = summary.distribution[star] ?? 0;
            return (
              <div key={star} className="flex items-center gap-2 text-[11px] font-semibold text-ink-500">
                <span className="w-3 text-right tabular-nums">{star}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
                  <span className="block h-full rounded-full bg-gold-400" style={{ width: `${summary.count ? (n / summary.count) * 100 : 0}%` }} />
                </span>
                <span className="w-5 tabular-nums">{n}</span>
              </div>
            );
          })}
        </div>
      </div>

      <ul className="mt-4 divide-y divide-line">
        {reviews.map((r) => (
          <li key={r.id} className="py-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-extrabold text-ink-900">{r.reviewer}</span>
              <span className="text-[11px] text-ink-500">{r.created_at ? new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</span>
            </div>
            <Stars value={r.rating} size={12} className="mt-0.5" />
            {r.comment && <p className="mt-1 text-[13px] leading-5 text-ink-700">{r.comment}</p>}
          </li>
        ))}
      </ul>
      {more && (
        <button type="button" onClick={loadMore} disabled={loadingMore}
          className="fos-press mx-auto mt-2 block h-9 rounded-full border-[1.5px] border-line px-4 text-[12px] font-extrabold text-navy-700">
          {loadingMore ? "Loading…" : "Show more reviews"}
        </button>
      )}
    </section>
  );
}
