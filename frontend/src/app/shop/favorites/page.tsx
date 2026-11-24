"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/providers/AuthProvider";
import { useCart } from "@/providers/CartProvider";
import { LoginGate } from "@/components/shop/LoginGate";
import { EmptyState, ProductCard } from "@/components/shop";
import { ShopRow } from "@/components/shop/ShopRow";
import { api } from "@/lib/api";
import { useFavorites } from "@/lib/useFavorites";
import type { Product } from "@/types";
import type { ShopCardData } from "@/components/shop/ShopCard";

type Tab = "products" | "shops";
type SavedProduct = Product & { available?: boolean };
type SavedShop = ShopCardData & { available?: boolean };

export default function FavoritesPage() {
  const { user } = useAuth();
  if (!user) return <LoginGate><div /></LoginGate>;
  return <FavoritesContent />;
}

function FavoritesContent() {
  const { addToCart } = useCart();
  const fav = useFavorites();
  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState<SavedProduct[] | null>(null);
  const [shops, setShops] = useState<SavedShop[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const [p, s] = await Promise.allSettled([
      api.get<{ data: SavedProduct[] }>("/favorites/products"),
      api.get<{ data: SavedShop[] }>("/favorites/shops"),
    ]);
    if (p.status === "fulfilled") setProducts(p.value.data); else setProducts((x) => x ?? []);
    if (s.status === "fulfilled") setShops(s.value.data); else setShops((x) => x ?? []);
    if (p.status === "rejected" && s.status === "rejected") setFailed(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  // A heart removed here leaves the list at once (the store has already told the server)
  const savedProducts = (products ?? []).filter((p) => fav.hasProduct(p.id));
  const savedShops = (shops ?? []).filter((s) => fav.hasShop(s.id));
  const loading = products === null || shops === null;

  const TABS: { key: Tab; label: string; n: number }[] = [
    { key: "products", label: "Products", n: savedProducts.length },
    { key: "shops", label: "Shops", n: savedShops.length },
  ];

  return (
    <div className="min-h-screen bg-surface">
      <div className="sticky top-0 z-10 flex h-14 items-center border-b border-line bg-card px-4">
        <h1 className="text-[17px] font-extrabold text-ink-900">Favorites</h1>
      </div>
      <div className="px-gutter pb-28 pt-4">
        <div role="tablist" aria-label="Favorites" className="grid grid-cols-2 gap-1 rounded-full border border-line bg-card p-1 shadow-fos-sm">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`fos-press h-10 whitespace-nowrap rounded-full text-[13px] ${tab === t.key ? "bg-navy-900 font-extrabold text-gold-400 shadow-fos-md" : "font-bold text-ink-500"}`}>
              {t.label}{!loading && t.n > 0 ? ` · ${t.n}` : ""}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="mt-4 grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-card bg-line" />)}</div>
        ) : failed ? (
          <EmptyState title="Couldn't load your favorites" body="Check your connection and try again." action={{ label: "Try again", onClick: load }} />
        ) : tab === "products" ? (
          savedProducts.length === 0 ? (
            <EmptyState title="No favorite products yet" body="Tap the heart on a product to save it here." action={{ label: "Browse products", href: "/shop" }} />
          ) : (
            <div data-testid="saved-products" className="mt-4 grid grid-cols-2 gap-3">
              {savedProducts.map((p) => p.available === false
                ? <UnavailableProduct key={p.id} product={p} onRemove={() => fav.toggleProduct(p.id)} />
                : <ProductCard key={p.id} product={p} onAddToCart={async (id) => { await addToCart(id); }} />)}
            </div>
          )
        ) : savedShops.length === 0 ? (
          <EmptyState title="No favorite shops yet" body="Tap the heart on a shop to find it again quickly." action={{ label: "Find shops", href: "/shop/discover" }} />
        ) : (
          <div data-testid="saved-shops" className="mt-4 flex flex-col gap-2.5">
            {savedShops.map((s) => s.available === false
              ? <UnavailableShop key={s.id} shop={s} onRemove={() => fav.toggleShop(s.id)} />
              : <ShopRow key={s.id} shop={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function UnavailableProduct({ product, onRemove }: { product: SavedProduct; onRemove: () => void }) {
  return (
    <div data-testid="unavailable" className="flex flex-col justify-between rounded-card bg-card p-3 shadow-fos-sm">
      <div>
        <p className="truncate text-[13px] font-semibold text-ink-500">{product.name}</p>
        <p className="mt-1 text-[12px] font-bold text-caution-500">No longer available</p>
      </div>
      <button type="button" onClick={onRemove} className="fos-press mt-4 h-9 rounded-full border-[1.5px] border-line text-[12px] font-extrabold text-ink-500">Remove</button>
    </div>
  );
}

function UnavailableShop({ shop, onRemove }: { shop: SavedShop; onRemove: () => void }) {
  return (
    <div data-testid="unavailable" className="flex items-center gap-3 rounded-hero bg-card p-3 shadow-fos-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-extrabold text-ink-500">{shop.name}</p>
        <p className="text-[12px] font-bold text-caution-500">Not taking orders right now</p>
      </div>
      <button type="button" onClick={onRemove} className="fos-press h-9 shrink-0 rounded-full border-[1.5px] border-line px-4 text-[12px] font-extrabold text-ink-500">Remove</button>
      <Link href={`/shop/merchant/${shop.id}`} className="sr-only">Open {shop.name}</Link>
    </div>
  );
}
