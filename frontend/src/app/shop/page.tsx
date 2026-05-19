"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { CategoryIcon } from "@/components/shop";
import type { Product, Category, Merchant, PromoCode, Notification } from "@/types";

export default function ShopHomePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [copiedPromo, setCopiedPromo] = useState("");
  const [heroIndex, setHeroIndex] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => { fetchData(); }, []);

  // Load unread notifications count (auth-gated; quietly ignore failures)
  useEffect(() => {
    if (!user) { setUnreadCount(0); return; }
    let cancelled = false;
    async function loadUnread() {
      try {
        const list = await api.get<Notification[]>("/notifications");
        if (!cancelled) setUnreadCount(list.filter(n => !n.is_read).length);
      } catch { /* not logged in or endpoint unavailable */ }
    }
    loadUnread();
    const id = setInterval(loadUnread, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user]);

  // Auto-rotate hero carousel — 3 fixed slides, independent of promos count
  useEffect(() => {
    const timer = setInterval(() => setHeroIndex(i => (i + 1) % 3), 4000);
    return () => clearInterval(timer);
  }, []);

  async function fetchData() {
    setLoadError(false);
    try {
      const [m, c, p] = await Promise.all([
        api.get<Merchant[]>("/merchants"),
        api.get<Category[]>("/categories"),
        api.get<Product[]>("/products", { params: { page_size: 20 } }),
      ]);
      setMerchants(m);
      setCategories(c);
      setProducts(p);
      // Load public active promos (no auth needed)
      try {
        const promoData = await api.get<PromoCode[]>("/promos/active");
        setPromos(promoData);
      } catch { /* promos endpoint may not exist yet */ }
    } catch (err) {
      console.error("Load error:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  function copyPromo(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedPromo(code);
      setTimeout(() => setCopiedPromo(""), 2000);
    });
  }

  if (loadError && !loading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--shop-bg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>📡</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--shop-black)", marginBottom: 6 }}>Can’t reach the shop right now</h2>
        <p style={{ fontSize: 13, color: "var(--shop-muted)", marginBottom: 20 }}>Check your connection and try again.</p>
        <button
          onClick={() => { setLoading(true); fetchData(); }}
          style={{ padding: "10px 24px", background: "var(--shop-primary)", color: "#fff", border: "none", borderRadius: "var(--shop-r-pill)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 16, background: "var(--shop-bg)", minHeight: "100vh" }}>
        {/* Top bar skeleton */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--shop-divider)", animation: "shopPulse 1.5s infinite" }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 14, width: 100, background: "var(--shop-divider)", borderRadius: 6, marginBottom: 6, animation: "shopPulse 1.5s infinite" }} />
            <div style={{ height: 10, width: 160, background: "var(--shop-divider)", borderRadius: 6, animation: "shopPulse 1.5s infinite" }} />
          </div>
        </div>
        {/* Search skeleton */}
        <div style={{ height: 52, background: "var(--shop-divider)", borderRadius: 12, marginBottom: 20, animation: "shopPulse 1.5s infinite" }} />
        {/* Hero skeleton */}
        <div style={{ height: 180, background: "var(--shop-divider)", borderRadius: 16, marginBottom: 20, animation: "shopPulse 1.5s infinite" }} />
        {/* Category skeleton */}
        <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--shop-divider)", animation: "shopPulse 1.5s infinite" }} />
              <div style={{ width: 40, height: 10, borderRadius: 4, background: "var(--shop-divider)", animation: "shopPulse 1.5s infinite" }} />
            </div>
          ))}
        </div>
        {/* Product grid skeleton */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ height: 220, background: "var(--shop-divider)", borderRadius: "var(--shop-r-card)", animation: "shopPulse 1.5s infinite" }} />
          ))}
        </div>
        <style>{`@keyframes shopPulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
      </div>
    );
  }

  // Group products by merchant
  const productsByMerchant: Record<number, Product[]> = {};
  products.forEach(p => {
    (productsByMerchant[p.merchant_id] ||= []).push(p);
  });

  // Popular categories: sort by product_count desc (fall back to sort_order)
  const popularCategories = [...categories].sort((a, b) =>
    (b.product_count ?? 0) - (a.product_count ?? 0) ||
    (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );

  // Featured shops: super_admin opts shops in via is_featured flag.
  // If none are flagged yet, fall back to the legacy top-3-by-product_count behavior
  // so the section never goes empty before the admin curates it.
  const explicitlyFeatured = merchants.filter(m => m.is_featured);
  const featuredShops = explicitlyFeatured.length > 0
    ? explicitlyFeatured
    : [...merchants].sort((a, b) => (b.product_count ?? 0) - (a.product_count ?? 0)).slice(0, 3);
  const featuredIds = new Set(featuredShops.map(m => m.id));

  // Hero carousel slides — three distinct cards that auto-rotate.
  function scrollTo(id: string) {
    if (typeof document !== "undefined") {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  const heroSlides = [
    {
      badge: "New Arrivals",
      title: "Discover Top Picks",
      subtitle: `${products.length} products from ${merchants.length} ${merchants.length === 1 ? "shop" : "shops"}`,
      cta: "Shop Now",
      bg: "linear-gradient(135deg, var(--shop-primary), var(--shop-primary-dark, #0040c0))",
      textAccent: "var(--shop-primary)",
      onClick: () => scrollTo("products-section"),
    },
    {
      badge: "Featured Shops",
      title: "Hand-Picked Sellers",
      subtitle: `${featuredShops.length} ${featuredShops.length === 1 ? "shop" : "shops"} curated for you`,
      cta: "Browse Shops",
      bg: "linear-gradient(135deg, #EC4899, #BE185D)",
      textAccent: "#BE185D",
      onClick: () => scrollTo("featured-shops"),
    },
    {
      badge: "Hot Deals",
      title: promos.length > 0 ? "Grab a Promo Code" : "Stay Tuned",
      subtitle: promos.length > 0
        ? `${promos.length} active promo${promos.length === 1 ? "" : "s"} — tap to copy`
        : "New deals are added every week",
      cta: promos.length > 0 ? "See Promos" : "Browse Now",
      bg: "linear-gradient(135deg, #F59E0B, #B45309)",
      textAccent: "#B45309",
      onClick: () => scrollTo(promos.length > 0 ? "promos-section" : "products-section"),
    },
  ];

  // Extract real user name from DB user record (first_name, username) or admin name
  const userName = (() => {
    if (!user) return null;
    const u = user as any;
    if (u.first_name) return u.first_name;
    if (u.name) return u.name.split(" ")[0];
    if (u.username) return u.username;
    return null;
  })();

  // Flash deal products (ones with compare_price > base_price)
  const flashDeals = products.filter(p => p.compare_price && p.compare_price > p.base_price);

  return (
    <div style={{ background: "var(--shop-bg)", minHeight: "100vh", paddingBottom: 80 }}>

      {/* ── Top Bar ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 16px 10px", background: "var(--shop-surface)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Avatar */}
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: "linear-gradient(135deg, #7C3AED, #EC4899)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 16, fontWeight: 700,
          }}>
            {userName ? userName.charAt(0).toUpperCase() : "G"}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--shop-black)" }}>
              Hi, {userName || "Guest"}
            </div>
            <div style={{ fontSize: 12, color: "var(--shop-muted)" }}>
              Find your favourite products
            </div>
          </div>
        </div>
        {/* Bell icon */}
        <button
          type="button"
          onClick={() => router.push("/shop/notifications")}
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
          style={{
            position: "relative", cursor: "pointer",
            background: "none", border: "none", padding: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--shop-black)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unreadCount > 0 && (
            <span style={{
              position: "absolute", top: 4, right: 4,
              minWidth: 16, height: 16, padding: "0 4px",
              background: "#EF4444", color: "#fff",
              borderRadius: 999, border: "2px solid var(--shop-surface)",
              fontSize: 10, fontWeight: 700, lineHeight: "12px",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Search Bar ── */}
      <div style={{ padding: "8px 16px 12px", background: "var(--shop-surface)" }}>
        <div
          onClick={() => router.push("/shop/search")}
          style={{
            height: 52, display: "flex", alignItems: "center", gap: 12,
            background: "var(--shop-bg)", borderRadius: "var(--shop-r-input)",
            border: "1.5px solid var(--shop-divider)", padding: "0 6px 0 16px",
            cursor: "pointer",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--shop-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <span style={{ flex: 1, fontSize: 14, color: "var(--shop-muted)" }}>
            Search products, brands...
          </span>
          {/* Bot trigger circle */}
          <div style={{
            width: 38, height: 38, borderRadius: "50%",
            background: "var(--shop-primary)", display: "flex",
            alignItems: "center", justifyContent: "center",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 16px" }}>

        {/* ── Hero Carousel ── */}
        <div style={{
          marginTop: 16, height: 180, borderRadius: "var(--shop-r-card)",
          background: heroSlides[heroIndex % 3].bg,
          position: "relative", overflow: "hidden", padding: 24,
          display: "flex", flexDirection: "column", justifyContent: "center",
          transition: "background 0.6s ease",
        }}>
          {/* Decorative circles */}
          <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
          <div style={{ position: "absolute", bottom: -20, right: 40, width: 80, height: 80, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />

          <span style={{
            display: "inline-block", width: "fit-content",
            padding: "4px 12px", borderRadius: "var(--shop-r-pill)",
            background: "rgba(255,255,255,0.2)", color: "#fff",
            fontSize: 11, fontWeight: 600, marginBottom: 10,
          }}>
            {heroSlides[heroIndex % 3].badge}
          </span>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 4, lineHeight: 1.2 }}>
            {heroSlides[heroIndex % 3].title}
          </h2>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", marginBottom: 16 }}>
            {heroSlides[heroIndex % 3].subtitle}
          </p>
          <button
            onClick={heroSlides[heroIndex % 3].onClick}
            style={{
              width: "fit-content", padding: "10px 24px",
              background: "#fff", color: heroSlides[heroIndex % 3].textAccent,
              border: "none", borderRadius: "var(--shop-r-pill)",
              fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}
          >
            {heroSlides[heroIndex % 3].cta}
          </button>
          {/* Dots — also clickable to jump */}
          <div style={{ position: "absolute", bottom: 14, right: 20, display: "flex", gap: 6 }}>
            {[0, 1, 2].map(i => (
              <button key={i} onClick={() => setHeroIndex(i)} aria-label={`Slide ${i + 1}`} style={{
                width: i === heroIndex % 3 ? 18 : 6, height: 6,
                borderRadius: 3, background: i === heroIndex % 3 ? "#fff" : "rgba(255,255,255,0.4)",
                transition: "all 0.3s ease", border: "none", padding: 0, cursor: "pointer",
              }} />
            ))}
          </div>
        </div>

        {/* ── Popular Categories ── */}
        {popularCategories.length > 0 && (
          <section className="shop-fade-up" style={{ marginTop: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: "var(--shop-black)" }}>
                  Popular Categories
                </h2>
                <p style={{ fontSize: 12, color: "var(--shop-muted)", marginTop: 2 }}>
                  Browse what shoppers love most
                </p>
              </div>
              <Link href="/shop/search" style={{ fontSize: 13, fontWeight: 600, color: "var(--shop-primary)", textDecoration: "none" }}>
                See all
              </Link>
            </div>
            <div style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" }}>
              {popularCategories.map(cat => (
                <Link
                  key={cat.id}
                  href={`/shop/search?category=${cat.id}`}
                  style={{
                    flexShrink: 0, display: "flex", flexDirection: "column",
                    alignItems: "center", gap: 8, textDecoration: "none",
                    minWidth: 64,
                  }}
                >
                  <div className="shop-icon-pop" style={{
                    width: 56, height: 56, borderRadius: "50%",
                    background: "var(--shop-primary-tint)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <CategoryIcon icon={cat.icon_emoji} size={28} fallback="box" alt={cat.name} />
                  </div>
                  <span style={{ fontSize: 12, color: "var(--shop-text)", fontWeight: 500, whiteSpace: "nowrap", textAlign: "center" }}>
                    {cat.name}
                  </span>
                  {(cat.product_count ?? 0) > 0 && (
                    <span style={{ fontSize: 10, color: "var(--shop-muted)" }}>
                      {cat.product_count}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── Promo Codes ── */}
        {promos.length > 0 && (
          <section id="promos-section" style={{ marginTop: 24, scrollMarginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: "var(--shop-black)" }}>
                🎁 Active Promos
              </h2>
            </div>
            <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" }}>
              {promos.slice(0, 5).map(p => {
                const shop = merchants.find(m => m.id === p.merchant_id);
                const shopName = shop?.name || "All shops";
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      copyPromo(p.code);
                      if (shop) router.push(`/shop/merchant/${shop.id}`);
                    }}
                    style={{
                      flexShrink: 0, padding: "14px 18px", borderRadius: "var(--shop-r-card)",
                      background: copiedPromo === p.code ? "var(--shop-primary-tint)" : "var(--shop-surface)",
                      border: `1.5px dashed ${copiedPromo === p.code ? "var(--shop-primary)" : "var(--shop-divider)"}`,
                      cursor: "pointer", textAlign: "left" as const, minWidth: 180,
                      boxShadow: "var(--shop-shadow)", transition: "all 0.2s ease",
                    }}
                  >
                    <p style={{
                      fontSize: 10, fontWeight: 700, color: "var(--shop-muted)",
                      textTransform: "uppercase", letterSpacing: 0.6,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      🏪 {shopName}
                    </p>
                    <p style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace", color: "var(--shop-primary)", letterSpacing: 1, marginTop: 4 }}>
                      {p.code}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--shop-muted)", marginTop: 4 }}>
                      {p.type === "percent" ? `${p.value}% off` : `$${p.value} off`}
                      {p.min_order ? ` (min $${p.min_order})` : ""}
                    </p>
                    <p style={{
                      fontSize: 11, marginTop: 6, fontWeight: 600,
                      color: copiedPromo === p.code ? "var(--shop-primary)" : "var(--shop-muted)",
                    }}>
                      {copiedPromo === p.code ? "Copied! Tap card to open shop" : "Tap to copy + open shop"}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Flash Deals ── */}
        {flashDeals.length > 0 && (
          <section style={{ marginTop: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: "var(--shop-black)" }}>
                ⚡ Flash Deals
              </h2>
              <Link href="/shop/search" style={{ fontSize: 13, fontWeight: 600, color: "var(--shop-primary)", textDecoration: "none" }}>
                See all
              </Link>
            </div>
            <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" }}>
              {flashDeals.slice(0, 8).map(p => {
                const discount = p.compare_price && p.compare_price > p.base_price
                  ? Math.round((1 - p.base_price / p.compare_price) * 100) : 0;
                return (
                  <Link
                    key={p.id}
                    href={`/shop/product/${p.id}`}
                    style={{
                      flexShrink: 0, width: 140, textDecoration: "none",
                      background: "var(--shop-surface)", borderRadius: "var(--shop-r-card)",
                      overflow: "hidden", boxShadow: "var(--shop-shadow)",
                    }}
                  >
                    <div style={{ position: "relative", width: 140, height: 140, background: "var(--shop-bg)" }}>
                      {p.primary_image ? (
                        <img src={p.primary_image} alt={p.name} loading="lazy"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>
                          {p.icon_emoji || "🛍️"}
                        </div>
                      )}
                      {discount > 0 && (
                        <span style={{
                          position: "absolute", top: 8, left: 8,
                          background: "#EF4444", color: "#fff",
                          fontSize: 11, fontWeight: 700, padding: "3px 8px",
                          borderRadius: "var(--shop-r-pill)",
                        }}>
                          -{discount}%
                        </span>
                      )}
                    </div>
                    <div style={{ padding: "10px 12px" }}>
                      <p style={{
                        fontSize: 12, color: "var(--shop-text)", fontWeight: 500,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {p.name}
                      </p>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--shop-primary)" }}>
                          ${p.base_price.toFixed(2)}
                        </span>
                        {p.compare_price && (
                          <span style={{ fontSize: 11, color: "var(--shop-muted)", textDecoration: "line-through" }}>
                            ${p.compare_price.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Featured Shops ── */}
        {featuredShops.length > 0 && (
          <section id="featured-shops" className="shop-fade-up" style={{ marginTop: 24, scrollMarginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: "var(--shop-black)" }}>
                  ⭐ Featured Shops
                </h2>
                <p style={{ fontSize: 12, color: "var(--shop-muted)", marginTop: 2 }}>
                  Hand-picked merchants for you
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" }}>
              {featuredShops.map(m => {
                const isFeatured = featuredIds.has(m.id);
                return (
                  <Link
                    key={m.id}
                    href={`/shop/merchant/${m.id}`}
                    className="shop-press"
                    style={{
                      flexShrink: 0, width: 168, padding: 16, position: "relative",
                      background: "var(--shop-surface)", borderRadius: "var(--shop-r-card)",
                      textDecoration: "none", boxShadow: "var(--shop-shadow)",
                      border: "1px solid var(--shop-divider)",
                    }}
                  >
                    {isFeatured && (
                      <span style={{
                        position: "absolute", top: 10, right: 10,
                        fontSize: 10, fontWeight: 700, color: "#fff",
                        background: "linear-gradient(135deg, #F59E0B, #EF4444)",
                        padding: "2px 8px", borderRadius: 999, letterSpacing: 0.4,
                      }}>
                        FEATURED
                      </span>
                    )}
                    {m.logo_url ? (
                      <img
                        src={m.logo_url}
                        alt={m.name}
                        style={{
                          width: 44, height: 44, borderRadius: 12,
                          objectFit: "cover", marginBottom: 10,
                          background: "var(--shop-primary-tint)",
                        }}
                      />
                    ) : (
                      <div style={{
                        width: 44, height: 44, borderRadius: 12,
                        background: "var(--shop-primary-tint)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        marginBottom: 10,
                      }}>
                        <CategoryIcon icon={m.icon_emoji} size={24} fallback="shop" alt={m.name} />
                      </div>
                    )}
                    <p style={{
                      fontSize: 14, fontWeight: 700, color: "var(--shop-black)",
                      marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {m.name}
                    </p>
                    {m.tagline && (
                      <p style={{
                        fontSize: 12, color: "var(--shop-muted)", lineHeight: 1.4,
                        overflow: "hidden", textOverflow: "ellipsis",
                        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any,
                      }}>
                        {m.tagline}
                      </p>
                    )}
                    <p style={{ fontSize: 11, color: "var(--shop-muted)", marginTop: 8, fontWeight: 500 }}>
                      {m.product_count || 0} products
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Products by Merchant ── */}
        <div id="products-section" style={{ scrollMarginTop: 16 }} />
        {merchants.map(m => {
          const mProducts = productsByMerchant[m.id];
          if (!mProducts || mProducts.length === 0) return null;
          return (
            <section key={m.id} style={{ marginTop: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: "var(--shop-black)", display: "flex", alignItems: "center", gap: 8 }}>
                  {m.logo_url ? (
                    <img
                      src={m.logo_url}
                      alt={m.name}
                      style={{ width: 24, height: 24, borderRadius: 6, objectFit: "cover" }}
                    />
                  ) : (
                    <CategoryIcon icon={m.icon_emoji} size={20} fallback="shop" alt={m.name} />
                  )}
                  {m.name}
                </h2>
                <Link href={`/shop/merchant/${m.id}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--shop-primary)", textDecoration: "none" }}>
                  See all
                </Link>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                {mProducts.slice(0, 4).map(p => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            </section>
          );
        })}

        {/* No products fallback */}
        {products.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>🛍️</div>
            <p style={{ fontSize: 16, fontWeight: 600, color: "var(--shop-black)", marginBottom: 4 }}>No products yet</p>
            <p style={{ fontSize: 13, color: "var(--shop-muted)" }}>Check back soon for new arrivals</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  const discount = product.compare_price && product.compare_price > product.base_price
    ? Math.round((1 - product.base_price / product.compare_price) * 100) : 0;

  return (
    <Link
      href={`/shop/product/${product.id}`}
      className="shop-press"
      style={{
        background: "var(--shop-surface)", borderRadius: "var(--shop-r-card)",
        overflow: "hidden", textDecoration: "none",
        boxShadow: "var(--shop-shadow)",
      }}
    >
      <div style={{ position: "relative", paddingTop: "100%", background: "var(--shop-bg)" }}>
        {product.primary_image ? (
          <img
            src={product.primary_image}
            alt={product.name}
            loading="lazy"
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%,-50%)", fontSize: 36,
          }}>
            {product.icon_emoji || "🛍️"}
          </div>
        )}
        {discount > 0 && (
          <span style={{
            position: "absolute", top: 8, left: 8,
            background: "#EF4444", color: "#fff",
            fontSize: 11, fontWeight: 700, padding: "3px 8px",
            borderRadius: "var(--shop-r-pill)",
          }}>
            -{discount}%
          </span>
        )}
        {product.stock === 0 && (
          <div style={{
            position: "absolute", inset: 0,
            background: "rgba(11,11,15,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 13, fontWeight: 600,
            backdropFilter: "blur(2px)",
          }}>
            Out of Stock
          </div>
        )}
      </div>
      <div style={{ padding: "10px 12px 14px" }}>
        {product.merchant_name && (
          <p style={{ fontSize: 11, color: "var(--shop-muted)", marginBottom: 3 }}>
            {product.merchant_name}
          </p>
        )}
        <div style={{
          fontSize: 13, fontWeight: 600, color: "var(--shop-black)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          marginBottom: 6, lineHeight: 1.3,
        }}>
          {product.name}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--shop-primary)" }}>
            ${product.base_price.toFixed(2)}
          </span>
          {discount > 0 && product.compare_price && (
            <span style={{ fontSize: 11, color: "var(--shop-muted)", textDecoration: "line-through" }}>
              ${product.compare_price.toFixed(2)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
