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
      <div style={{ minHeight: "100vh", paddingBottom: "calc(72px + var(--safe-bottom, 0px))", background: "var(--shop-bg)" }}>
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
    { href: "/shop/search", label: "Search", icon: "circle:11,11,8|M21 21l-4.35-4.35" },
    { href: "/shop/ai-chat", label: "Bot", isBot: true },
    { href: "/shop/cart", label: "Cart", icon: "M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z|M3 6h18|M16 10a4 4 0 01-8 0", badge: true },
    { href: "/shop/profile", label: "Profile", icon: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|circle:12,7,4" },
  ];

  return (
    <nav style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      height: `calc(72px + var(--safe-bottom, 0px))`,
      paddingBottom: "var(--safe-bottom, 0px)",
      background: "var(--shop-surface)",
      borderTop: "1px solid var(--shop-divider)",
      display: "flex", alignItems: "center", justifyContent: "space-around",
      padding: "0 8px 8px", zIndex: 100,
    }}>
      {tabs.map((tab) => {
        const active = isActive(tab.href);

        if (tab.isBot) {
          return (
            <button key={tab.href} onClick={() => router.push(tab.href)}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, cursor: "pointer", marginTop: -16, background: "none", border: "none", padding: 0 }}>
              <div style={{
                width: 56, height: 56,
                background: "linear-gradient(135deg, var(--shop-primary), var(--shop-primary-dark))",
                borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 6px 20px rgba(30,107,255,0.4)",
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M12 2a4 4 0 014 4v5H8V6a4 4 0 014-4z" />
                  <circle cx="9" cy="16" r="1" fill="white" stroke="none" />
                  <circle cx="15" cy="16" r="1" fill="white" stroke="none" />
                </svg>
              </div>
              <span style={{ fontSize: 10, color: "var(--shop-primary)", fontWeight: 600, marginTop: 4 }}>Bot</span>
            </button>
          );
        }

        return (
          <button key={tab.href} onClick={() => router.push(tab.href)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              cursor: "pointer", flex: 1, padding: "8px 0 0",
              background: "none", border: "none", position: "relative",
            }}>
            {tab.badge && count > 0 && (
              <span style={{
                position: "absolute", top: 5, right: 18,
                width: 16, height: 16, background: "var(--danger)", borderRadius: "50%",
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
            <span style={{ fontSize: 10, fontWeight: 500, color: active ? "var(--shop-primary)" : "var(--shop-muted)" }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
