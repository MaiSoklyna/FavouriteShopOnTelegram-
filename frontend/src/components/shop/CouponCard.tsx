import type { ReactNode } from "react";
import { expiryText, limitText, minSpendText, shopText } from "@/lib/coupons";
import type { Coupon } from "@/types";

/** A coupon as a ticket: the discount on the left, the conditions on the right, an action underneath. */
export function CouponCard({ coupon, dimmed = false, note, children }: {
  coupon: Coupon;
  dimmed?: boolean;
  /** One line under the conditions, e.g. why it cannot be used yet. */
  note?: ReactNode;
  children?: ReactNode;
}) {
  const private_ = coupon.audience === "private";
  const facts = [minSpendText(coupon), expiryText(coupon.expires_at), limitText(coupon)].filter(Boolean);
  return (
    <article data-testid={`coupon-${coupon.id}`} className={`overflow-hidden rounded-hero bg-card shadow-fos-sm ${dimmed ? "opacity-60" : ""}`}>
      <div className="flex">
        <div className={`grid w-[96px] shrink-0 place-items-center px-2 py-4 text-center ${private_ ? "bg-grad-gold text-[#4A3610]" : "bg-grad-hero text-white"}`}>
          <span className="text-[20px] font-extrabold leading-6">{coupon.discount_text.replace(" off", "")}</span>
          <span className="text-[11px] font-bold uppercase tracking-wide opacity-80">off</span>
        </div>
        <div className="min-w-0 flex-1 border-l border-dashed border-line p-3">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[14px] font-extrabold text-ink-900">{coupon.title}</h3>
            {private_ && <span className="shrink-0 rounded-full bg-tint-mango px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase text-tone-mango">Just for you</span>}
          </div>
          <p className="truncate text-[12px] font-semibold text-ink-500">{shopText(coupon)}</p>
          <p className="mt-1 text-[11.5px] text-ink-500">{facts.join(" · ")}</p>
          <p className="mt-1 inline-block rounded-md bg-surface px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wider text-ink-700">{coupon.code}</p>
          {note && <p className="mt-1.5 text-[12px] font-bold text-caution-500">{note}</p>}
        </div>
      </div>
      {children && <div className="flex gap-2 border-t border-line p-2.5">{children}</div>}
    </article>
  );
}
