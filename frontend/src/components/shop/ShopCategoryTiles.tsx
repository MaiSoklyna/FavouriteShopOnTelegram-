import Link from "next/link";
import { Icon } from "./Icon";
import { THEMES, shopCategoryLook } from "@/lib/shopTheme";
import type { ShopCategory } from "@/types";

const shopsLabel = (n?: number) => `${n ?? 0} ${n === 1 ? "shop" : "shops"}`;

/** "Shop by category": one tile per kind of shop, each opening that category's shop list. */
export function ShopCategoryTiles({ categories }: { categories: ShopCategory[] }) {
  return (
    <div className="fos-no-scrollbar -mx-gutter flex snap-x gap-3 overflow-x-auto px-gutter pb-1">
      {categories.map((c) => {
        const look = shopCategoryLook(c.name);
        const t = THEMES[look.theme];
        return (
          <Link key={c.id} href={`/shop/shops/${c.id}`} className="fos-press flex w-[84px] shrink-0 snap-start flex-col items-center gap-1.5">
            <span className="grid h-[68px] w-[68px] place-items-center rounded-[22px] shadow-fos-sm" style={{ background: t.bg, color: t.ink }}>
              <Icon name={look.icon} size={30} strokeWidth={1.8} />
            </span>
            <span className="min-h-[32px] w-full text-center text-[12px] font-extrabold leading-4 text-ink-900">{c.name}</span>
            <span className="-mt-1 text-[11px] font-semibold text-ink-500">{shopsLabel(c.shop_count)}</span>
          </Link>
        );
      })}
    </div>
  );
}

/** Filter chips over a list of shops: "All" plus one chip per category (or subcategory). */
export function CategoryChips({ items, value, onChange, allLabel = "All", total }: {
  items: { id: number; name: string; shop_count?: number }[];
  value: number | null;
  onChange: (id: number | null) => void;
  allLabel?: string;
  total?: number;
}) {
  const chip = (active: boolean) =>
    `fos-press h-9 shrink-0 rounded-full px-3.5 text-[13px] font-extrabold ${active ? "bg-navy-700 text-white" : "border-[1.5px] border-line bg-card text-ink-900"}`;
  return (
    <div className="fos-no-scrollbar -mx-gutter flex gap-2 overflow-x-auto px-gutter" role="radiogroup" aria-label="Filter by category">
      <button type="button" role="radio" aria-checked={value === null} onClick={() => onChange(null)} className={chip(value === null)}>
        {allLabel}{total != null ? ` · ${total}` : ""}
      </button>
      {items.map((c) => (
        <button key={c.id} type="button" role="radio" aria-checked={value === c.id} onClick={() => onChange(c.id)} className={chip(value === c.id)}>
          {c.name}{c.shop_count != null ? ` · ${c.shop_count}` : ""}
        </button>
      ))}
    </div>
  );
}
