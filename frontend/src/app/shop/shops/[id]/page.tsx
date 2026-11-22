"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { useHomeLocation } from "@/lib/useHomeLocation";
import { isNewShop, useDiscoverShops, type DiscoverShop } from "@/lib/useDiscoverShops";
import { useShopCategories } from "@/lib/useShopCategories";
import { THEMES, shopCategoryLook } from "@/lib/shopTheme";
import { CategoryChips, EmptyState, LocationSheet, Skeleton } from "@/components/shop";
import { ShopRow } from "@/components/shop/ShopRow";
import { Icon } from "@/components/shop/Icon";

const SORTS = ["Nearest", "Top rated", "A–Z"] as const;
type Sort = (typeof SORTS)[number];

/**
 * Shops of one kind (Food & Beverage, Fashion, …): the shops the admin put in this category,
 * narrowed by subcategory chips and ordered by distance, rating or name.
 */
export default function ShopsByCategoryPage() {
  const { id } = useParams<{ id: string }>();
  const categoryId = Number(id);
  const router = useRouter();
  const { user } = useAuth();
  const { location, save: saveLocation } = useHomeLocation(!!user);
  const { categories, loading: loadingCats } = useShopCategories(false);
  const { shops, loading } = useDiscoverShops(location, Number.isFinite(categoryId) ? categoryId : null);
  const [sub, setSub] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>("Nearest");
  const [openOnly, setOpenOnly] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // ?sub=ID makes a subcategory link shareable (the shop page links here with it)
  useEffect(() => {
    const s = Number(new URLSearchParams(window.location.search).get("sub"));
    if (Number.isFinite(s) && s > 0) setSub(s);
  }, []);
  function pickSub(next: number | null) {
    setSub(next);
    window.history.replaceState(null, "", next == null ? window.location.pathname : `${window.location.pathname}?sub=${next}`);
  }

  const category = categories.find((c) => c.id === categoryId);
  const look = shopCategoryLook(category?.name);
  const theme = THEMES[look.theme];
  const subs = (category?.subcategories ?? []).filter((s) => (s.shop_count ?? 0) > 0);

  const all = useMemo(() => shops ?? [], [shops]);
  const anyOpenInfo = all.some((s) => s.is_open != null);
  const list = useMemo(() => {
    const byName = (a: DiscoverShop, b: DiscoverShop) => a.name.localeCompare(b.name);
    const nearest = (a: DiscoverShop, b: DiscoverShop) =>
      Number(b.is_open ?? false) - Number(a.is_open ?? false) || (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9) || byName(a, b);
    const rated = (a: DiscoverShop, b: DiscoverShop) => (b.rating ?? -1) - (a.rating ?? -1) || byName(a, b);
    return all
      .filter((s) => sub == null || s.shop_subcategory_id === sub)
      .filter((s) => !openOnly || s.is_open !== false)
      .sort(sort === "Nearest" ? (location ? nearest : byName) : sort === "Top rated" ? rated : byName);
  }, [all, sub, openOnly, sort, location]);

  const title = category?.name ?? (loadingCats ? "" : "Shops");
  const ready = !loading && !loadingCats;

  return (
    <div className="min-h-screen bg-surface">
      <div className="px-gutter pt-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => router.back()} aria-label="Back"
            className="fos-press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-card text-ink-900 shadow-fos-sm">
            <Icon name="back" size={20} strokeWidth={2.2} />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-[24px] font-extrabold leading-8 tracking-[-0.01em] text-ink-900">{title || " "}</h1>
          {/* Icon only, so the category name always fits; the area shows on hover/long-press and to screen readers */}
          <button type="button" onClick={() => setSheetOpen(true)} aria-label={location?.area ? `Delivering to ${location.area}. Change location` : "Set location"}
            title={location?.area ?? "Set location"}
            className="fos-press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-card shadow-fos-sm">
            <Icon name="pin" size={18} className={location ? "text-mango-500" : "text-ink-500"} strokeWidth={2.2} />
          </button>
        </div>

        {/* Category banner */}
        <div className="mt-4 flex items-center gap-3 rounded-hero p-3.5" style={{ background: theme.bg, color: theme.ink }}>
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-white/60"><Icon name={look.icon} size={26} strokeWidth={1.8} /></span>
          <span className="min-w-0">
            <span className="block text-[15px] font-extrabold">{category ? category.name : "Shops"}</span>
            <span className="block text-[12px] font-semibold opacity-80">
              {ready ? `${all.length} ${all.length === 1 ? "shop" : "shops"}${subs.length ? ` · ${subs.length} ${subs.length === 1 ? "type" : "types"}` : ""}` : "Loading shops…"}
            </span>
          </span>
        </div>
      </div>

      {subs.length > 0 && (
        <div className="sticky top-0 z-30 bg-surface px-gutter pb-2 pt-3">
          <CategoryChips items={subs} value={sub} onChange={pickSub} allLabel="All" total={all.length} />
        </div>
      )}

      <div className="flex flex-col gap-3 px-gutter pb-8 pt-3">
        {ready && all.length > 0 && (
          <div className="fos-no-scrollbar -mx-gutter flex items-center gap-2 overflow-x-auto px-gutter" role="radiogroup" aria-label="Sort shops">
            {SORTS.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={sort === s} onClick={() => setSort(s)}
                className={`fos-press h-8 shrink-0 rounded-full px-3 text-[12px] font-extrabold ${sort === s ? "bg-ink-900 text-white" : "bg-tint-neutral text-ink-500"}`}>
                {s}
              </button>
            ))}
            {anyOpenInfo && (
              <button type="button" aria-pressed={openOnly} onClick={() => setOpenOnly((v) => !v)}
                className={`fos-press ml-auto h-8 shrink-0 rounded-full px-3 text-[12px] font-extrabold ${openOnly ? "bg-positive-500 text-white" : "bg-tint-positive text-tone-positive"}`}>
                Open now
              </button>
            )}
          </div>
        )}

        {!ready ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-hero" />)
        ) : all.length === 0 ? (
          <EmptyState title="No shops here yet" body="Shops in this category will show up here soon." action={{ label: "Browse all shops", href: "/shop/discover" }} />
        ) : list.length === 0 ? (
          <EmptyState title="No shops match" body="Try another type, or turn off Open now." action={{ label: "Show all", onClick: () => { pickSub(null); setOpenOnly(false); } }} />
        ) : (
          list.map((s) => <ShopRow key={s.id} shop={s} ribbon={isNewShop(s) ? "New" : undefined} />)
        )}
      </div>

      {sheetOpen && (
        <LocationSheet current={location} onClose={() => setSheetOpen(false)}
          onConfirm={(loc) => { saveLocation(loc); setSheetOpen(false); }} />
      )}
    </div>
  );
}
