"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { Skeleton } from "./Skeleton";
import { expiryDate, expiryLabel, type Promotion } from "@/lib/promotions";
import { savePromo } from "@/lib/quote";

/** Every promotion card is this size, whatever it holds, so a rail of them lines up. */
const CARD = "h-[358px] w-[288px]";

/** A shop's accent colour when it is a usable hex, else the brand navy. */
function brandColor(color?: string | null): string {
  return color && /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : "#081D3C";
}

/**
 * The one promotion card. Every card has the same size and three fixed areas:
 *  - top (150px): the uploaded image, or a banner generated from the discount,
 *    title, shop logo and the shop's colour when there is no image
 *  - middle (60px): title and subtitle, clamped
 *  - bottom: promo code, expiry and the CTA, always in the same place
 * The code chip copies on tap; the code is also saved for that shop's checkout.
 */
export function PromotionCard({ promo }: { promo: Promotion }) {
  const [copied, setCopied] = useState(false);
  const offer = promo.offer;
  const ends = expiryLabel(promo.expiresAt);
  const until = expiryDate(promo.expiresAt);
  const remember = () => { if (promo.code) savePromo(promo.code.code, promo.code.merchantId); };
  const badge = !offer ? "Promotion" : promo.code?.merchantId == null ? "All shops" : "Shop deal";
  // Shop name only when the title doesn't already say it ("30% off at Bloom & Co.")
  const where = [promo.shopName && !promo.title.includes(promo.shopName) && `at ${promo.shopName}`, promo.covers].filter(Boolean).join(" · ");
  const subtitle = promo.subtitle || where;
  const color = brandColor(promo.brand?.color);
  const details = [
    promo.schedule,
    offer?.minOrder != null && `Min. order $${offer.minOrder.toFixed(2)}`,
    until && !promo.schedule && `Valid until ${until}`,
    offer?.auto && "Applied automatically",
  ].filter(Boolean).join(" · ");

  async function copy() {
    if (!offer) return;
    remember();
    try {
      await navigator.clipboard.writeText(offer.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard refused: the code is still saved for this shop's checkout */ }
  }

  return (
    <div className={`flex shrink-0 snap-start flex-col overflow-hidden rounded-hero bg-card shadow-fos-md ${CARD}`}>
      {/* Top: image or generated banner */}
      <Link href={promo.href} onClick={remember} aria-label={promo.title}
        className="relative block h-[150px] w-full shrink-0 overflow-hidden"
        style={promo.image ? undefined : { background: `linear-gradient(135deg, ${color} 0%, #081D3C 100%)` }}>
        {promo.image ? (
          <img src={promo.image} alt="" loading="lazy" className="h-full w-full bg-surface object-cover" />
        ) : (
          <>
            <span aria-hidden className="absolute -right-10 -top-12 h-40 w-40 rounded-full border-[18px] border-white/10" />
            <span aria-hidden className="absolute -bottom-14 right-16 h-28 w-28 rounded-full bg-gold-400/15" />
            <span className="absolute inset-x-3.5 bottom-3 flex items-end gap-3">
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-[30px] font-extrabold leading-[32px] tracking-[-0.02em] text-gold-400">
                  {offer?.discount ?? promo.title}
                </span>
                {promo.shopName && <span className="mt-0.5 block truncate text-[12px] font-bold text-white/80">{promo.shopName}</span>}
              </span>
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white text-[26px] ring-2 ring-gold-400/70">
                {promo.brand?.logo
                  ? <img src={promo.brand.logo} alt="" loading="lazy" className="h-full w-full object-cover" />
                  : promo.brand?.emoji || <Icon name={offer ? "ticket" : "gift"} size={24} strokeWidth={2} className="text-[#081D3C]" />}
              </span>
            </span>
          </>
        )}
        <span className="absolute inset-x-2.5 top-2.5 flex items-center justify-between gap-2">
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#081D3C]/85 px-2.5 text-[11px] font-extrabold text-gold-400">
            <Icon name={offer ? "ticket" : "gift"} size={12} strokeWidth={2.2} />{badge}
          </span>
          {ends && (
            <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#081D3C]/85 px-2.5 text-[11px] font-extrabold text-white">
              <Icon name="clock" size={12} strokeWidth={2.2} />{ends}
            </span>
          )}
        </span>
      </Link>

      <div className="flex flex-1 flex-col p-3.5">
        {/* Middle: title and subtitle */}
        <Link href={promo.href} onClick={remember} className="block h-[60px] min-w-0 shrink-0">
          <span className="block truncate text-[16px] font-extrabold leading-[22px] text-ink-900">
            {offer && promo.image ? `${offer.discount} · ${promo.title}` : promo.title}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[12px] font-semibold leading-[17px] text-ink-500">{subtitle}</span>
        </Link>

        {/* Bottom: code, expiry, CTA */}
        <div className="mt-2.5 flex shrink-0 flex-col">
          {offer ? (
            <button type="button" onClick={copy} aria-label={`Copy promo code ${offer.code}`}
              className="fos-press flex h-10 items-center justify-between gap-2 rounded-md border-[1.5px] border-dashed border-gold-700 bg-[#FBF4E4] pl-3 pr-1.5">
              <span className="truncate font-mono text-[15px] font-extrabold tracking-[0.06em] text-[#081D3C]">{offer.code}</span>
              <span className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-extrabold ${copied ? "bg-jade-500 text-white" : "bg-[#081D3C] text-gold-400"}`}>
                <Icon name={copied ? "check" : "ticket"} size={12} strokeWidth={2.4} />{copied ? "Copied" : "Tap to copy"}
              </span>
            </button>
          ) : (
            <span className="flex h-10 items-center gap-1.5 rounded-md border-[1.5px] border-dashed border-ink-500/30 px-3 text-[12px] font-bold text-ink-500">
              <Icon name="gift" size={14} strokeWidth={2.2} />No code needed
            </span>
          )}

          <span className="mt-2 block h-4 truncate text-[11px] font-semibold leading-4 text-ink-500">{details}</span>

          <Link href={promo.href} onClick={remember}
            className="fos-press mt-2.5 inline-flex h-9 w-full items-center justify-center gap-1 rounded-md bg-gold-400 px-3.5 text-[13px] font-extrabold text-[#081D3C]">
            {promo.cta}<span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export function PromotionCardSkeleton() {
  return <Skeleton className={`shrink-0 rounded-hero ${CARD}`} />;
}
