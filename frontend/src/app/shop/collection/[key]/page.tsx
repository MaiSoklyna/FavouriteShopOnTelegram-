"use client";

import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { useHomeLocation } from "@/lib/useHomeLocation";
import { COLLECTIONS, isNewShop, useDiscoverShops } from "@/lib/useDiscoverShops";
import { EmptyState, Skeleton } from "@/components/shop";
import { ShopRow } from "@/components/shop/ShopRow";
import { Icon } from "@/components/shop/Icon";

const COVER: Record<string, string> = {
  navy: "bg-grad-hero text-white",
  gold: "bg-grad-gold text-[#4A3610]",
  night: "bg-[linear-gradient(135deg,#1F1147,#3B2A7A)] text-white",
  jade: "bg-[linear-gradient(135deg,#05603A,#12B76A)] text-white",
};

/** A rule-based collection of shops: cover header, one line, then the shops as list rows. */
export default function CollectionPage() {
  const { key } = useParams<{ key: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { location } = useHomeLocation(!!user);
  const { shops, loading } = useDiscoverShops(location);
  const def = COLLECTIONS.find((c) => c.key === key);
  const list = (shops ?? []).filter((s) => def?.match(s))
    .sort((a, b) => Number(b.is_open ?? false) - Number(a.is_open ?? false) || (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9));

  return (
    <div className="min-h-screen bg-surface pb-8">
      <div className={`relative px-gutter pb-5 pt-[max(14px,env(safe-area-inset-top))] ${COVER[def?.tone ?? "navy"]}`}>
        <button type="button" onClick={() => router.back()} aria-label="Back" className="fos-press grid h-10 w-10 place-items-center rounded-full bg-black/20">
          <Icon name="back" size={20} strokeWidth={2} />
        </button>
        <h1 className="mt-6 text-display">{def?.title ?? "Collection"}</h1>
        <p className="mt-1 text-[13px] font-semibold opacity-85">{def?.sub}{!loading && def ? ` · ${list.length} ${list.length === 1 ? "shop" : "shops"}` : ""}</p>
      </div>
      <div className="flex flex-col gap-2.5 px-gutter pt-4">
        {loading
          ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-hero" />)
          : list.length
            ? list.map((s) => <ShopRow key={s.id} shop={s} ribbon={isNewShop(s) ? "New" : undefined} />)
            : <EmptyState title="No shops here yet" action={{ label: "Back to Discover", href: "/shop/discover" }} />}
      </div>
    </div>
  );
}
