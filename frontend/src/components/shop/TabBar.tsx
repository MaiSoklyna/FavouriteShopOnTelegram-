"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/providers/CartProvider";
import { DeliveryIcon, OrdersIcon, ProfileIcon, PromoIcon, StoreIcon } from "@/components/brand/Icons";

const TABS = [
  { key: "home", label: "Home", href: "/shop", match: (p: string) => p === "/shop",
    Icon: StoreIcon },
  { key: "discover", label: "Discover", href: "/shop/discover", match: (p: string) => /^\/shop\/(discover|categor|search|merchant|collection|nearby)/.test(p),
    Icon: PromoIcon },
  { key: "cart", label: "Cart", href: "/shop/cart", match: (p: string) => p.startsWith("/shop/cart"), Icon: OrdersIcon },
  { key: "orders", label: "Orders", href: "/shop/orders", match: (p: string) => p.startsWith("/shop/orders") || p.startsWith("/shop/order"),
    Icon: DeliveryIcon },
  { key: "me", label: "Me", href: "/shop/profile", match: (p: string) => p.startsWith("/shop/profile"),
    Icon: ProfileIcon },
];

/**
 * 84px tab bar: navy #081D3C 94% + blur, 5 tabs with the Byme24 icons
 * (Home = Store, Discover = Promotion, Orders = Delivery, Me = Profile).
 * Centre Cart raised -22px: gold 56² circle with the Orders bag and a gold count
 * badge (navy ring) that bumps when the count changes. Active tab: gold icon + label.
 */
export function TabBar() {
  const pathname = usePathname();
  const { count } = useCart();
  const [bump, setBump] = useState(0);
  // On Rewards the balance card is the focus: the Cart button drops its glow and steps back a little
  const calm = pathname.startsWith("/shop/rewards");
  const prev = useRef(count);

  useEffect(() => {
    if (count > prev.current) setBump((b) => b + 1);
    prev.current = count;
  }, [count]);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-[100] border-t border-white/10 bg-navy-900/[0.94] backdrop-blur-[20px]"
      style={{ height: "calc(84px + env(safe-area-inset-bottom))", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex h-[84px] max-w-[640px] items-start justify-around px-2 pt-2.5">
        {TABS.map((t) => {
          const active = t.match(pathname);
          if (t.key === "cart") {
            return (
              <Link key={t.key} href={t.href} aria-label={`Cart${count ? `, ${count} items` : ""}`} aria-current={active ? "page" : undefined} className="fos-press relative -mt-[22px] flex w-16 flex-col items-center">
                <span className={`relative grid h-14 w-14 place-items-center rounded-full text-navy-900 ${calm ? "scale-90 bg-gold-400/80" : "bg-gold-400 shadow-[0_10px_24px_rgba(214,186,128,.35)]"} ${active ? "ring-4 ring-gold-400/30" : ""}`}>
                  <t.Icon size={26} strokeWidth={1.9} />
                  {count > 0 && (
                    <span key={bump} className="fos-bump absolute -right-1.5 -top-1.5 grid h-5 min-w-[20px] place-items-center rounded-full border-2 border-navy-900 bg-gold-400 px-1 text-[10px] font-extrabold text-navy-900">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </span>
                <span className={`mt-1 text-[10px] ${active ? "font-extrabold text-gold-400" : "font-bold text-white/60"}`}>{t.label}</span>
              </Link>
            );
          }
          return (
            <Link key={t.key} href={t.href} aria-current={active ? "page" : undefined} className={`fos-press flex min-h-[44px] w-16 flex-col items-center gap-0.5 ${active ? "text-gold-400" : "text-white/60"}`}>
              <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors duration-200 ${active ? "bg-gold-400/15" : ""}`}>
                <t.Icon size={24} strokeWidth={active ? 2 : 1.6} />
              </span>
              <span className={`text-[10px] ${active ? "font-extrabold" : "font-bold"}`}>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
