"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CartProvider, useCart } from "@/providers/CartProvider";
import { initTelegram } from "@/lib/telegram";

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initTelegram();
  }, []);

  return (
    <CartProvider>
      <div style={{ minHeight: "100vh", paddingBottom: "calc(64px + var(--safe-bottom, 0px))", background: "var(--shop-bg)" }}>
        {children}
        <BottomNav />
      </div>
    </CartProvider>
  );
}

function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { count } = useCart();

  const hideOn = ["/shop/checkout", "/shop/product/", "/shop/order/"];
  if (hideOn.some((p) => pathname.startsWith(p))) return null;

  const isActive = (href: string) => {
    if (href === "/shop") return pathname === "/shop";
    return pathname.startsWith(href);
  };

  const tabs = [
    { href: "/shop", label: "Home", icon: "M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z|M9 21V12h6v9" },
    { href: "/shop/categories", label: "Category", icon: "M3 3h7v7H3z|M14 3h7v7h-7z|M3 14h7v7H3z|M14 14h7v7h-7z" },
    { href: "/shop/search", label: "Search", icon: "circle:11,11,8|M21 21l-4.35-4.35" },
    { href: "/shop/cart", label: "Cart", icon: "M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z|M3 6h18|M16 10a4 4 0 01-8 0", badge: true },
    { href: "/shop/profile", label: "Profile", icon: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|circle:12,7,4" },
  ];

  return (
    <nav style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      height: `calc(64px + var(--safe-bottom, 0px))`,
      paddingBottom: "var(--safe-bottom, 0px)",
      background: "var(--shop-surface)",
      borderTop: "1px solid var(--shop-divider)",
      display: "flex", alignItems: "center", justifyContent: "space-around",
      padding: "0 8px", zIndex: 100,
    }}>
      {tabs.map((tab) => {
        const active = isActive(tab.href);

        return (
          <button key={tab.href} onClick={() => router.push(tab.href)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
              cursor: "pointer", flex: 1, padding: "8px 0",
              background: "none", border: "none", position: "relative",
            }}>
            {tab.badge && count > 0 && (
              <span style={{
                position: "absolute", top: 2, right: 18,
                width: 16, height: 16, background: "#71541A",
                borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, color: "white", fontWeight: 700, border: "2px solid var(--shop-surface)",
              }}>
                {count > 99 ? "99+" : count}
              </span>
            )}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke={active ? "var(--shop-primary)" : "var(--shop-muted)"}
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {tab.icon?.split("|").map((d, i) =>
                d.startsWith("circle:") ? (
                  <circle key={i} cx={d.split(":")[1].split(",")[0]} cy={d.split(":")[1].split(",")[1]} r={d.split(":")[1].split(",")[2]} />
                ) : (
                  <path key={i} d={d} />
                )
              )}
            </svg>
            <span style={{
              fontSize: 10, fontWeight: active ? 600 : 500,
              color: active ? "var(--shop-primary)" : "var(--shop-muted)",
              fontFamily: "'Kantumruy Pro', sans-serif",
            }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
