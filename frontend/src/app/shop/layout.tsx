"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { CartProvider } from "@/providers/CartProvider";
import { initTelegram } from "@/lib/telegram";
import { TabBar } from "@/components/shop/TabBar";

// Screens that own the bottom of the screen (sticky action bars) — no tab bar there.
const HIDE_TAB_BAR_ON = ["/shop/checkout", "/shop/product/", "/shop/order/", "/shop/sell"];

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  useEffect(() => {
    initTelegram();
  }, []);

  const showTabBar = !HIDE_TAB_BAR_ON.some((p) => pathname.startsWith(p));

  return (
    <CartProvider>
      <div style={{ minHeight: "100vh", paddingBottom: showTabBar ? "calc(84px + env(safe-area-inset-bottom, 0px))" : 0, background: "var(--shop-bg)" }}>
        {children}
        {showTabBar && <TabBar />}
      </div>
    </CartProvider>
  );
}
