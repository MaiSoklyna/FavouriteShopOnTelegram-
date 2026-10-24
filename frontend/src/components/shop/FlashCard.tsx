import Link from "next/link";
import type { Product } from "@/types";
import { isOutOfStock } from "./OutOfStock";
import { PriceTag } from "./PriceTag";
import { Icon } from "./Icon";

/**
 * Flash-deal countdown: three navy boxes (h : m : s). The system stores no
 * deal end time, so without `endsAt` it renders "--" placeholders instead of
 * a made-up timer.
 */
export function Countdown({ endsAt }: { endsAt?: Date | null }) {
  const parts = ["--", "--", "--"];
  if (endsAt) {
    const s = Math.max(0, Math.floor((endsAt.getTime() - Date.now()) / 1000));
    parts[0] = String(Math.floor(s / 3600)).padStart(2, "0");
    parts[1] = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    parts[2] = String(s % 60).padStart(2, "0");
  }
  return (
    <div className="flex items-center gap-1" aria-label={endsAt ? "Time left" : "Deal timer not set"}>
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1">
          <span className="grid h-[22px] min-w-[24px] place-items-center rounded-[6px] bg-navy-900 px-1 text-[11px] font-bold tabular-nums text-white">{p}</span>
          {i < 2 && <span className="text-[11px] font-bold text-ink-900">:</span>}
        </span>
      ))}
    </div>
  );
}

/**
 * 128 wide: image 128², mango discount badge, price, progress bar.
 * The products API has no "sold" figure, so the bar is an empty track with a
 * "— sold" caption until it does.
 */
export function FlashCard({ product }: { product: Product }) {
  const discount = product.compare_price && product.compare_price > product.base_price
    ? Math.round((1 - product.base_price / product.compare_price) * 100) : 0;
  const out = isOutOfStock(product);

  return (
    <Link href={`/shop/product/${product.id}`} className="fos-press block w-[128px] shrink-0">
      <div className="relative h-[128px] w-[128px] overflow-hidden rounded-thumb bg-surface">
        {product.primary_image
          ? <img src={product.primary_image} alt={product.name} loading="lazy" className="h-full w-full object-cover" />
          : <div className="grid h-full w-full place-items-center text-3xl">{product.icon_emoji || <Icon name="box" size={32} className="text-line" />}</div>}
        {discount > 0 && (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-mango-500 px-2 py-0.5 text-[11px] font-extrabold text-white">-{discount}%</span>
        )}
        {out && <div className="absolute inset-0 grid place-items-center bg-navy-900/60 text-[11px] font-bold text-white">Out of stock</div>}
      </div>
      <PriceTag usd={product.base_price} size="sm" className="mt-2" />
      <div className="mt-1.5 h-1.5 w-full rounded-full bg-line" />
      <p className="mt-1 text-[10px] font-bold text-ink-500">— sold</p>
    </Link>
  );
}
