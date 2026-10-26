"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CartProvider, useCart } from "@/providers/CartProvider";
import { initTelegram } from "@/lib/telegram";
import { CartIcon, CategoryIcon, HomeIcon, ProfileIcon, SearchIcon } from "@/components/brand/Icons";

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

  const hideOn = ["/shop/checkout", "/shop/product/", "/shop/order/", "/shop/sell"];
  if (hideOn.some((p) => pathname.startsWith(p))) return null;

  const isActive = (href: string) => {
    if (href === "/shop") return pathname === "/shop";
    return pathname.startsWith(href);
  };

  const tabs = [
    { href: "/shop", label: "Home", Icon: HomeIcon },
    { href: "/shop/categories", label: "Category", Icon: CategoryIcon },
    { href: "/shop/search", label: "Search", Icon: SearchIcon },
    { href: "/shop/cart", label: "Cart", Icon: CartIcon, badge: true },
    { href: "/shop/profile", label: "Profile", Icon: ProfileIcon },
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
            <tab.Icon size={24} strokeWidth={active ? 1.9 : 1.6}
              style={{ color: active ? "var(--shop-primary)" : "var(--shop-muted)" }} />
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
