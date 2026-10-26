"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CartProvider, useCart } from "@/providers/CartProvider";
import { initTelegram } from "@/lib/telegram";
import { useAuth } from "@/providers/AuthProvider";
import { LaunchScreen } from "@/components/ui/Spinner";
import { IconChip, OrdersIcon, StoreIcon } from "@/components/brand/Icons";

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
      <ShopLaunch />
    </CartProvider>
  );
}

/** Splash then navy loading screen over the shop until auth settles (and at least the 600ms splash). */
function ShopLaunch() {
  const { loading } = useAuth();
  const [minElapsed, setMinElapsed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), 600);
    return () => clearTimeout(t);
  }, []);
  return loading || !minElapsed ? <LaunchScreen /> : null;
}

// Line-icon paths for tabs without a Byme24 glyph ("circle:cx,cy,r" draws a circle)
function PathIcon({ icon, size = 22 }: { icon: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {icon.split("|").map((d, i) => {
        if (!d.startsWith("circle:")) return <path key={i} d={d} />;
        const [cx, cy, r] = d.slice(7).split(",");
        return <circle key={i} cx={cx} cy={cy} r={r} />;
      })}
    </svg>
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

  const tabs: { href: string; label: string; Icon: (p: { size?: number }) => JSX.Element; badge?: boolean }[] = [
    { href: "/shop", label: "Home", Icon: StoreIcon },
    { href: "/shop/categories", label: "Category", Icon: (p) => <PathIcon {...p} icon="M3 3h7v7H3z|M14 3h7v7h-7z|M3 14h7v7H3z|M14 14h7v7h-7z" /> },
    { href: "/shop/search", label: "Search", Icon: (p) => <PathIcon {...p} icon="circle:11,11,8|M21 21l-4.35-4.35" /> },
    { href: "/shop/cart", label: "Cart", Icon: OrdersIcon, badge: true },
    { href: "/shop/profile", label: "Profile", Icon: (p) => <PathIcon {...p} icon="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|circle:12,7,4" /> },
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
      {tabs.map(({ href, label, Icon, badge }) => {
        const active = isActive(href);

        return (
          <button key={href} onClick={() => router.push(href)} aria-current={active ? "page" : undefined}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
              cursor: "pointer", flex: 1, padding: "8px 0",
              background: "none", border: "none", position: "relative",
              color: active ? "var(--shop-primary)" : "var(--shop-muted)",
            }}>
            {/* Active tab: gold glyph on a 56px navy chip, lifted above the bar */}
            <span style={{ height: 24, display: "flex", alignItems: "flex-end", justifyContent: "center", position: "relative" }}>
              {active ? (
                <IconChip style={{ marginTop: -36, border: "4px solid var(--shop-surface)", boxSizing: "content-box", boxShadow: "0 6px 16px rgba(8, 29, 60, 0.18)" }}>
                  <Icon size={26} />
                </IconChip>
              ) : (
                <Icon size={22} />
              )}
              {badge && count > 0 && (
                <span style={{
                  position: "absolute", top: active ? -36 : -6, right: active ? -14 : -10,
                  minWidth: 16, height: 16, padding: "0 3px", background: "var(--brand-gold-dark)",
                  borderRadius: 999,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, color: "white", fontWeight: 700, border: "2px solid var(--shop-surface)",
                }}>
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </span>
            <span style={{
              fontSize: 10, fontWeight: active ? 600 : 500,
              fontFamily: "'Kantumruy Pro', sans-serif",
            }}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
