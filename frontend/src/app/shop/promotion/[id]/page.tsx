"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useCart } from "@/providers/CartProvider";
import { EmptyState, ProductCard, Skeleton } from "@/components/shop";
import { Icon } from "@/components/shop/Icon";
import { coversLabel, discountLabel, expiryDate, expiryLabel, type PromotionRow } from "@/lib/promotions";
import { savePromo } from "@/lib/quote";

/**
 * Promotion detail: the offer (discount, code, minimum, expiry), the shop it is
 * from, and exactly the products it covers. The code is saved for that shop's
 * checkout as soon as the page opens, so there is nothing to remember.
 */
export default function PromotionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { addToCart } = useCart();
  const [promo, setPromo] = useState<PromotionRow | null | undefined>(undefined);
  /** Loading failed (network) — not the same as the promotion being gone */
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setPromo(undefined);
    api.get<PromotionRow>(`/promotions/${id}`)
      .then((p) => {
        if (cancelled) return;
        setPromo(p);
        // Save the code only while it can be used; an off-day visit just shows when it's back
        if (p.offer && p.is_live !== false) savePromo(p.offer.code, p.merchant_id);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof Error && e.name === "ApiError" && /not found/i.test(e.message)) setPromo(null);
        else setFailed(true);
      });
    return () => { cancelled = true; };
  }, [id, attempt]);

  const back = (
    <button type="button" onClick={() => router.back()} aria-label="Back"
      className="fos-press absolute left-gutter top-[max(14px,env(safe-area-inset-top))] grid h-10 w-10 place-items-center rounded-full bg-black/30 text-white">
      <Icon name="back" size={20} strokeWidth={2} />
    </button>
  );

  if (failed) {
    return (
      <div className="relative min-h-screen bg-surface px-gutter pt-20 text-center">
        <div className="relative h-0 text-left">{back}</div>
        <EmptyState title="Couldn't load this promotion" body="Check your connection, then try again." />
        <button type="button" onClick={() => setAttempt((n) => n + 1)}
          className="fos-press inline-flex h-12 items-center rounded-thumb bg-grad-cta px-6 text-[15px] font-bold text-white shadow-fos-cta">Try again</button>
      </div>
    );
  }

  if (promo === undefined) {
    return (
      <div className="min-h-screen bg-surface">
        <Skeleton className="h-[200px] rounded-none" />
        <div className="px-gutter pt-4"><Skeleton className="h-[230px] rounded-hero" /></div>
      </div>
    );
  }

  if (promo === null) {
    return (
      <div className="relative min-h-screen bg-surface px-gutter pt-20">
        <div className="relative h-0">{back}</div>
        <EmptyState title="This promotion has ended" body="Have a look at what's on now." action={{ label: "Back to Home", href: "/shop" }} />
      </div>
    );
  }

  const offer = promo.offer;
  const discount = offer ? discountLabel({ type: offer.type, value: Number(offer.value) }) : null;
  const minOrder = offer?.min_order ? Number(offer.min_order) : 0;
  const ends = expiryLabel(promo.ends_at);
  const shop = promo.shop;
  const products = promo.products ?? [];
  const shopHref = `/shop/merchant/${promo.merchant_id}${offer ? `?promo=${encodeURIComponent(offer.code)}` : ""}`;

  async function copy() {
    if (!offer) return;
    try {
      await navigator.clipboard.writeText(offer.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard refused: the code is already saved for this shop's checkout */ }
  }

  return (
    <div className="min-h-screen bg-surface pb-[110px]">
      <div className="relative h-[200px] bg-[linear-gradient(135deg,#081D3C,#103562)]">
        {promo.image_url && <img src={promo.image_url} alt="" className="h-full w-full object-cover" />}
        {back}
      </div>

      <div className="relative z-[1] -mt-6 flex flex-col gap-3 px-gutter">
        {/* Offer */}
        <section className="rounded-hero bg-card p-4 shadow-fos-md">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#081D3C] px-2.5 text-[11px] font-extrabold text-gold-400">
              <Icon name="ticket" size={12} strokeWidth={2.2} />{coversLabel(promo)}
            </span>
            {ends && <span className="inline-flex h-6 items-center gap-1 rounded-full bg-tint-mango px-2.5 text-[11px] font-extrabold text-tone-mango"><Icon name="clock" size={12} strokeWidth={2.2} />{ends}</span>}
          </div>
          {promo.is_live === false && promo.next_start && (
            <p role="status" className="mt-2.5 rounded-md bg-[#081D3C] px-3 py-2 text-[13px] font-bold text-gold-400">
              Not on right now · starts {new Date(promo.next_start).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}. The code works from then.
            </p>
          )}
          {discount && <div className="mt-2.5 text-[38px] font-extrabold leading-[42px] tracking-[-0.02em] text-[#081D3C]">{discount}</div>}
          <h1 className="mt-1 text-[20px] font-extrabold leading-[26px] text-ink-900">{promo.title}</h1>
          {promo.subtitle && <p className="mt-1 text-body text-ink-500">{promo.subtitle}</p>}

          {promo.schedule_type && promo.schedule_type !== "once" && promo.schedule_text && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-tint-mango px-3 py-1 text-[12px] font-extrabold text-tone-mango">
              <Icon name="clock" size={13} strokeWidth={2.2} />{promo.schedule_text}
            </p>
          )}
          {offer && (
            <button type="button" onClick={copy} aria-label={`Copy promo code ${offer.code}`}
              className="fos-press mt-3.5 flex h-12 w-full items-center justify-between gap-2 rounded-md border-[1.5px] border-dashed border-gold-700 bg-[#FBF4E4] pl-3.5 pr-2">
              <span className="truncate font-mono text-[18px] font-extrabold tracking-[0.06em] text-[#081D3C]">{offer.code}</span>
              <span className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-extrabold ${copied ? "bg-jade-500 text-white" : "bg-[#081D3C] text-gold-400"}`}>
                <Icon name={copied ? "check" : "ticket"} size={13} strokeWidth={2.4} />{copied ? "Copied" : "Tap to copy"}
              </span>
            </button>
          )}

          <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
            <div className="rounded-md bg-surface px-3 py-2"><dt className="font-semibold text-ink-500">Minimum order</dt><dd className="font-extrabold text-ink-900">{minOrder ? `$${minOrder.toFixed(2)}` : "None"}</dd></div>
            <div className="rounded-md bg-surface px-3 py-2"><dt className="font-semibold text-ink-500">{promo.schedule_type && promo.schedule_type !== "once" ? "This run ends" : "Valid until"}</dt><dd className="font-extrabold text-ink-900">{expiryDate(promo.active_until ?? promo.ends_at) ?? "No end date"}</dd></div>
          </dl>
          <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-[17px] text-ink-500">
            <Icon name="check" size={14} strokeWidth={2.4} className="mt-px shrink-0 text-tone-jade" />
            {promo.is_live === false ? "On sale days it's applied at checkout" : promo.auto_apply ? "No code needed: it's applied automatically at checkout" : "The code is saved. It's applied at checkout"} when you order {promo.scope === "platform" ? "from any shop" : promo.scope === "shop" ? "from this shop" : "the products below from this shop"}.
          </p>
        </section>

        {/* Eligible shop */}
        {promo.scope === "platform" && (
          <div className="flex items-center gap-3 rounded-hero bg-card p-3.5 shadow-fos-sm">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-thumb bg-[#081D3C] text-gold-400"><Icon name="store" size={20} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-caption text-ink-500">Eligible shops</span>
              <span className="block text-[15px] font-extrabold text-ink-900">Every shop on Byme24</span>
            </span>
          </div>
        )}
        {shop && (
          <Link href={shopHref} className="fos-press flex items-center gap-3 rounded-hero bg-card p-3.5 shadow-fos-sm">
            <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-thumb bg-tint-navy text-[16px] font-extrabold text-navy-700">
              {shop.logo_url ? <img src={shop.logo_url} alt="" className="h-full w-full object-cover" /> : shop.icon_emoji || shop.name[0]?.toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-caption text-ink-500">Eligible shop</span>
              <span className="block truncate text-[15px] font-extrabold text-ink-900">{shop.name}</span>
            </span>
            <span className="shrink-0 rounded-full bg-gold-400 px-3.5 py-2 text-[12px] font-extrabold text-[#081D3C]">Shop now →</span>
          </Link>
        )}

        {/* Eligible products */}
        <div className="mt-3 flex items-baseline gap-2">
          <h2 className="text-section font-extrabold text-ink-900">Eligible products</h2>
          <span className="text-caption text-ink-500">{promo.scope === "platform" ? "Everything, in every shop" : promo.scope === "shop" ? "Everything in this shop" : `${products.length}`}</span>
        </div>
        {products.length === 0 ? (
          <EmptyState title="No products to show yet" body="The shop hasn't added the products for this offer." action={shop ? { label: "Visit the shop", href: shopHref } : undefined} />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {products.map((p) => <ProductCard key={p.id} product={p} onAddToCart={async (pid) => { await addToCart(pid); }} />)}
          </div>
        )}
      </div>
    </div>
  );
}
