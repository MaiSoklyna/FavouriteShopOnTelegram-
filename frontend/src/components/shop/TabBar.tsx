"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/providers/CartProvider";

const ICON = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const TABS = [
  { key: "home", label: "Home", href: "/shop", match: (p: string) => p === "/shop",
    icon: <><path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></> },
  { key: "shop", label: "Shop", href: "/shop/categories", match: (p: string) => /^\/shop\/(categor|search|merchant)/.test(p),
    icon: <><path d="M3 9l1.5-5h15L21 9" /><path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" /><path d="M5 11v9h14v-9" /></> },
  { key: "cart", label: "Cart", href: "/shop/cart", match: (p: string) => p.startsWith("/shop/cart"), icon: null },
  { key: "orders", label: "Orders", href: "/shop/orders", match: (p: string) => p.startsWith("/shop/orders") || p.startsWith("/shop/order"),
    icon: <><path d="M6 2h9l4 4v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" /><path d="M14 2v5h5M9 13h6M9 17h6" /></> },
  { key: "me", label: "Me", href: "/shop/profile", match: (p: string) => p.startsWith("/shop/profile"),
    icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></> },
];

/**
 * 84px tab bar: white 86% + blur, 5 tabs, centre Cart raised -22px (56² r20,
 * gradient, mango count badge that bumps when the count changes). Active tab:
 * blue icon + label on a light-blue pill (navy-700 vs ink-500 alone was too close to see).
 */
export function TabBar() {
  const pathname = usePathname();
  const { count } = useCart();
  const [bump, setBump] = useState(0);
  const prev = useRef(count);

  useEffect(() => {
    if (count > prev.current) setBump((b) => b + 1);
    prev.current = count;
  }, [count]);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-[100] border-t border-line bg-white/[0.86] backdrop-blur-[20px]"
      style={{ height: "calc(84px + env(safe-area-inset-bottom))", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex h-[84px] max-w-[640px] items-start justify-around px-2 pt-2.5">
        {TABS.map((t) => {
          const active = t.match(pathname);
          if (t.key === "cart") {
            return (
              <Link key={t.key} href={t.href} aria-label={`Cart${count ? `, ${count} items` : ""}`} aria-current={active ? "page" : undefined} className="fos-press relative -mt-[22px] flex w-16 flex-col items-center">
                <span className={`relative grid h-14 w-14 place-items-center rounded-[20px] bg-grad-cta text-white shadow-fos-cta ${active ? "ring-4 ring-[#DCE7FB]" : ""}`}>
                  <svg width="26" height="26" viewBox="0 0 24 24" {...ICON} aria-hidden>
                    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" />
                  </svg>
                  {count > 0 && (
                    <span key={bump} className="fos-bump absolute -right-1.5 -top-1.5 grid h-5 min-w-[20px] place-items-center rounded-full border-2 border-white bg-mango-500 px-1 text-[10px] font-extrabold text-white">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </span>
                <span className={`mt-1 text-[10px] ${active ? "font-extrabold text-navy-500" : "font-bold text-ink-500"}`}>{t.label}</span>
              </Link>
            );
          }
          return (
            <Link key={t.key} href={t.href} aria-current={active ? "page" : undefined} className={`fos-press flex min-h-[44px] w-16 flex-col items-center gap-0.5 ${active ? "text-navy-500" : "text-ink-500"}`}>
              <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors duration-200 ${active ? "bg-[#DCE7FB]" : ""}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" {...ICON} strokeWidth={active ? 2.2 : 1.8} aria-hidden>{t.icon}</svg>
              </span>
              <span className={`text-[10px] ${active ? "font-extrabold" : "font-bold"}`}>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
