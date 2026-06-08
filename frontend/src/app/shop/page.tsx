"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import type { Product, Category, CategoryBanner, Merchant, PromoCode, Notification } from "@/types";

export default function ShopHomePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [banners, setBanners] = useState<CategoryBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [copiedPromo, setCopiedPromo] = useState("");
  const [heroIndex, setHeroIndex] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => { fetchData(); }, []);

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
      try {
        const promoData = await api.get<PromoCode[]>("/promos/active");
        setPromos(promoData);
      } catch { /* promos endpoint may not exist yet */ }
      try {
        const bannerData = await api.get<CategoryBanner[]>("/category-banners", { params: { placement: "home" } });
        setBanners(bannerData);
      } catch { /* banners table may not exist yet */ }
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
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--h24-cloud)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--h24-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--h24-navy)", marginBottom: 6, fontFamily: "'Kantumruy Pro', sans-serif" }}>Can&apos;t reach the shop</h2>
        <p style={{ fontSize: 13, color: "var(--h24-grey)", marginBottom: 20 }}>Check your connection and try again.</p>
        <button
          onClick={() => { setLoading(true); fetchData(); }}
          className="btn-gold"
        >
          Retry
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--shop-bg)" }}>
        <div style={{ height: 108, background: "var(--h24-blue)", borderRadius: "0 0 20px 20px" }} />
        <div style={{ padding: 16 }}>
          <div style={{ height: 180, background: "var(--shop-divider)", borderRadius: 8, marginBottom: 20, animation: "pulse 1.5s infinite" }} />
          <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <div style={{ width: 64, height: 64, borderRadius: 8, background: "var(--shop-divider)", animation: "pulse 1.5s infinite" }} />
                <div style={{ width: 48, height: 10, borderRadius: 4, background: "var(--shop-divider)", animation: "pulse 1.5s infinite" }} />
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{ height: 220, background: "var(--shop-divider)", borderRadius: 8, animation: "pulse 1.5s infinite" }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const productsByMerchant: Record<number, Product[]> = {};
  products.forEach(p => {
    (productsByMerchant[p.merchant_id] ||= []).push(p);
  });

  const popularCategories = [...categories].sort((a, b) =>
    (b.product_count ?? 0) - (a.product_count ?? 0) ||
    (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );

  const explicitlyFeatured = merchants.filter(m => m.is_featured);
  const featuredShops = explicitlyFeatured.length > 0
    ? explicitlyFeatured
    : [...merchants].sort((a, b) => (b.product_count ?? 0) - (a.product_count ?? 0)).slice(0, 3);
  const featuredIds = new Set(featuredShops.map(m => m.id));

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
      bg: "linear-gradient(135deg, #103562, #081D3C)",
      onClick: () => scrollTo("products-section"),
    },
    {
      badge: "Featured Shops",
      title: "Hand-Picked Sellers",
      subtitle: `${featuredShops.length} ${featuredShops.length === 1 ? "shop" : "shops"} curated for you`,
      cta: "Browse Shops",
      bg: "linear-gradient(135deg, #71541A, #D6BA80)",
      onClick: () => scrollTo("featured-shops"),
    },
    {
      badge: "Hot Deals",
      title: promos.length > 0 ? "Grab a Promo Code" : "Stay Tuned",
      subtitle: promos.length > 0
        ? `${promos.length} active promo${promos.length === 1 ? "" : "s"} — tap to copy`
        : "New deals are added every week",
      cta: promos.length > 0 ? "See Promos" : "Browse Now",
      bg: "linear-gradient(135deg, #081D3C, #103562)",
      onClick: () => scrollTo(promos.length > 0 ? "promos-section" : "products-section"),
    },
  ];

  const userName = (() => {
    if (!user) return null;
    const u = user as any;
    if (u.first_name) return u.first_name;
    if (u.name) return u.name.split(" ")[0];
    if (u.username) return u.username;
    return null;
  })();

  const flashDeals = products.filter(p => p.compare_price && p.compare_price > p.base_price);

  return (
    <div style={{ background: "var(--shop-bg)", minHeight: "100vh", paddingBottom: 80 }}>

      {/* ── Navigation Header ── */}
      <div style={{
        background: "#103562",
        borderRadius: "0 0 20px 20px",
        padding: "12px 20px",
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        {/* Top row: logo/title + bell */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Logo */}
            <img
              src="/image.png"
              alt="Byme24"
              style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }}
            />
            <div>
              <div style={{
                fontSize: 16, fontWeight: 500, color: "#FFFFFF",
                fontFamily: "'Kantumruy Pro', sans-serif", lineHeight: "20px",
              }}>
                {userName ? `Hi, ${userName}` : "Byme24"}
              </div>
              <div style={{
                fontSize: 12, fontWeight: 400, color: "#D6BA80",
                fontFamily: "'Kantumruy Pro', sans-serif",
              }}>
                Find your favourite products
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push("/shop/notifications")}
            aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
            style={{
              position: "relative", cursor: "pointer",
              background: "rgba(234, 239, 243, 0.2)",
              border: "none", padding: 10, borderRadius: 20,
              width: 36, height: 36,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadCount > 0 && (
              <span style={{
                position: "absolute", top: -2, right: -2,
                minWidth: 16, height: 16, padding: "0 4px",
                background: "#D6BA80", color: "#081D3C",
                borderRadius: 999, border: "2px solid #103562",
                fontSize: 9, fontWeight: 700, lineHeight: "12px",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
        </div>

        {/* Search bar */}
        <div
          onClick={() => router.push("/shop/search")}
          style={{
            height: 36, display: "flex", alignItems: "center", gap: 8,
            background: "#EAEFF3", borderRadius: 20,
            padding: "8px 12px", cursor: "pointer",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(116, 109, 109, 0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <span style={{
            flex: 1, fontSize: 14, color: "rgba(116, 109, 109, 0.5)",
            fontFamily: "'Inter', sans-serif", fontWeight: 400,
          }}>
            Search Byme24
          </span>
        </div>
      </div>

      <div style={{ padding: "0 16px" }}>

        {/* ── Hero Carousel ── */}
        <div style={{
          marginTop: 16, height: 180, borderRadius: 8,
          background: heroSlides[heroIndex % 3].bg,
          position: "relative", overflow: "hidden", padding: 24,
          display: "flex", flexDirection: "column", justifyContent: "center",
          transition: "background 0.6s ease",
        }}>
          <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, borderRadius: "50%", background: "rgba(214,186,128,0.1)" }} />
          <div style={{ position: "absolute", bottom: -20, right: 40, width: 80, height: 80, borderRadius: "50%", background: "rgba(214,186,128,0.06)" }} />

          <span style={{
            display: "inline-block", width: "fit-content",
            padding: "4px 12px", borderRadius: "0 6px 6px 0",
            background: "#D6BA80", color: "#FFFFFF",
            fontSize: 10, fontWeight: 700, fontFamily: "'Inter', sans-serif",
            textTransform: "uppercase", letterSpacing: 0.5,
            marginBottom: 10, marginLeft: -24,
            paddingLeft: 24,
          }}>
            {heroSlides[heroIndex % 3].badge}
          </span>
          <h2 style={{
            fontSize: 22, fontWeight: 700, color: "#FFFFFF",
            marginBottom: 4, lineHeight: "28px",
            fontFamily: "'Kantumruy Pro', sans-serif",
          }}>
            {heroSlides[heroIndex % 3].title}
          </h2>
          <p style={{
            fontSize: 13, color: "rgba(255,255,255,0.7)",
            marginBottom: 16, fontFamily: "'Inter', sans-serif",
          }}>
            {heroSlides[heroIndex % 3].subtitle}
          </p>
          <button
            onClick={heroSlides[heroIndex % 3].onClick}
            style={{
              width: "fit-content", padding: "10px 24px",
              background: "#71541A", color: "#FFFFFF",
              border: "none", borderRadius: 8,
              fontWeight: 500, fontSize: 14, cursor: "pointer",
              fontFamily: "'Kantumruy Pro', sans-serif",
            }}
          >
            {heroSlides[heroIndex % 3].cta}
          </button>
          <div style={{ position: "absolute", bottom: 14, right: 20, display: "flex", gap: 6 }}>
            {[0, 1, 2].map(i => (
              <button key={i} onClick={() => setHeroIndex(i)} aria-label={`Slide ${i + 1}`} style={{
                width: i === heroIndex % 3 ? 18 : 6, height: 6,
                borderRadius: 3, background: i === heroIndex % 3 ? "#D6BA80" : "rgba(255,255,255,0.3)",
                transition: "all 0.3s ease", border: "none", padding: 0, cursor: "pointer",
              }} />
            ))}
          </div>
        </div>

        {/* ── Categories (image-based) ── */}
        {popularCategories.length > 0 && (
          <section className="shop-fade-up" style={{ marginTop: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{
                fontSize: 20, fontWeight: 600, color: "var(--shop-text)",
                fontFamily: "'Kantumruy Pro', sans-serif", lineHeight: "26px",
              }}>
                Popular Categories
              </h2>
              <Link href="/shop/categories" style={{
                fontSize: 12, fontWeight: 500, color: "#D6BA80",
                textDecoration: "none", fontFamily: "'Kantumruy Pro', sans-serif",
              }}>
                See all
              </Link>
            </div>
            <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" }}>
              {popularCategories.map(cat => (
                <Link
                  key={cat.id}
                  href={`/shop/category/${cat.id}`}
                  style={{
                    flexShrink: 0, display: "flex", flexDirection: "column",
                    alignItems: "center", gap: 6, textDecoration: "none",
                    minWidth: 72,
                  }}
                >
                  <div className="shop-icon-pop" style={{
                    width: 64, height: 64, borderRadius: 8,
                    background: "var(--shop-divider)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    overflow: "hidden",
                  }}>
                    {(cat.image_url || (cat.icon_emoji && /^https?:\/\//i.test(cat.icon_emoji))) ? (
                      <img src={cat.image_url || cat.icon_emoji!} alt={cat.name}
                        style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    ) : cat.icon_emoji ? (
                      <span style={{ fontSize: 28, lineHeight: 1 }}>{cat.icon_emoji}</span>
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--shop-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" />
                        <rect x="14" y="3" width="7" height="7" />
                        <rect x="3" y="14" width="7" height="7" />
                        <rect x="14" y="14" width="7" height="7" />
                      </svg>
                    )}
                  </div>
                  <span style={{
                    fontSize: 12, color: "var(--shop-text)", fontWeight: 500,
                    fontFamily: "'Kantumruy Pro', sans-serif",
                    whiteSpace: "nowrap", textAlign: "center",
                    lineHeight: "14px",
                  }}>
                    {cat.name}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── Become a Seller CTA ── */}
        <section className="shop-fade-up" style={{ marginTop: 24 }}>
          <Link
            href="/shop/sell"
            className="shop-press"
            style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: 18, borderRadius: 12, textDecoration: "none",
              background: "linear-gradient(135deg, #71541A 0%, #D6BA80 100%)",
              position: "relative", overflow: "hidden",
              boxShadow: "0 6px 18px rgba(113,84,26,0.28)",
            }}
          >
            <div style={{ position: "absolute", top: -28, right: -28, width: 110, height: 110, borderRadius: "50%", background: "rgba(255,255,255,0.12)" }} />
            <div style={{ position: "absolute", bottom: -34, right: 44, width: 90, height: 90, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
            <div style={{
              width: 52, height: 52, borderRadius: 12, flexShrink: 0,
              background: "rgba(255,255,255,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l1.5-5h15L21 9" />
                <path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" />
                <path d="M5 11v9h14v-9" />
                <path d="M9 20v-5h6v5" />
              </svg>
            </div>
            <div style={{ flex: 1, position: "relative" }}>
              <span style={{
                display: "inline-block", padding: "2px 8px", borderRadius: 999,
                background: "rgba(255,255,255,0.22)", color: "#FFFFFF",
                fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
                fontFamily: "'Inter', sans-serif", marginBottom: 6,
              }}>
                Start selling
              </span>
              <h3 style={{
                fontSize: 17, fontWeight: 700, color: "#FFFFFF", margin: 0,
                fontFamily: "'Kantumruy Pro', sans-serif", lineHeight: "22px",
              }}>
                Become a Seller on Byme24
              </h3>
              <p style={{
                fontSize: 12, color: "rgba(255,255,255,0.85)", margin: "2px 0 0",
                fontFamily: "'Inter', sans-serif",
              }}>
                Open your shop in minutes — reach thousands of buyers.
              </p>
            </div>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, position: "relative" }}>
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>
        </section>

        {/* ── Promo Codes ── */}
        {promos.length > 0 && (
          <section id="promos-section" style={{ marginTop: 24, scrollMarginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{
                fontSize: 20, fontWeight: 600, color: "var(--shop-text)",
                fontFamily: "'Kantumruy Pro', sans-serif",
              }}>
                Active Promos
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
                      flexShrink: 0, padding: "14px 18px", borderRadius: 8,
                      background: copiedPromo === p.code ? "var(--shop-primary-tint)" : "var(--shop-surface)",
                      border: `1.5px dashed ${copiedPromo === p.code ? "var(--shop-primary)" : "var(--shop-divider)"}`,
                      cursor: "pointer", textAlign: "left" as const, minWidth: 180,
                      boxShadow: "var(--shop-shadow)", transition: "all 0.2s ease",
                    }}
                  >
                    <p style={{
                      fontSize: 10, fontWeight: 600, color: "var(--shop-accent)",
                      textTransform: "uppercase", letterSpacing: 0.6,
                      fontFamily: "'Kantumruy Pro', sans-serif",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {shopName}
                    </p>
                    <p style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace", color: "var(--shop-primary)", letterSpacing: 1, marginTop: 4 }}>
                      {p.code}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--shop-muted)", marginTop: 4, fontFamily: "'Inter', sans-serif" }}>
                      {p.type === "percent" ? `${p.value}% off` : `$${p.value} off`}
                      {p.min_order ? ` (min $${p.min_order})` : ""}
                    </p>
                    <p style={{
                      fontSize: 11, marginTop: 6, fontWeight: 500,
                      color: copiedPromo === p.code ? "var(--shop-primary)" : "var(--shop-muted)",
                      fontFamily: "'Kantumruy Pro', sans-serif",
                    }}>
                      {copiedPromo === p.code ? "Copied! Tap to open shop" : "Tap to copy + open shop"}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Promotional Banners ── */}
        {banners.filter(b => b.image_url).length > 0 && (
          <section style={{ marginTop: 24 }}>
            <div style={{
              display: "flex", gap: 12, overflowX: "auto",
              paddingBottom: 8, scrollbarWidth: "none",
              scrollSnapType: "x mandatory",
            }}>
              {banners.filter(b => b.image_url).map(banner => (
                <Link
                  key={banner.id}
                  href={`/shop/category/${banner.category_id}`}
                  className="shop-press"
                  style={{
                    flexShrink: 0,
                    width: 320, height: 176, borderRadius: 8,
                    position: "relative", overflow: "hidden",
                    textDecoration: "none",
                    scrollSnapAlign: "start",
                  }}
                >
                  <img
                    src={banner.image_url!}
                    alt={banner.title}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                  <div style={{
                    position: "absolute", inset: 0,
                    background: "linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.6) 100%)",
                  }} />
                  <div style={{ position: "absolute", bottom: 16, left: 16, right: 16 }}>
                    <h3 style={{
                      fontSize: 22, fontWeight: 700, color: "#EAEFF3",
                      fontFamily: "'Kantumruy Pro', sans-serif",
                      lineHeight: "28px", marginBottom: 4,
                    }}>
                      {banner.title}
                    </h3>
                    {banner.subtitle && (
                      <p style={{
                        fontSize: 13, color: "rgba(255,255,255,0.8)",
                        fontFamily: "'Inter', sans-serif", lineHeight: "18px",
                      }}>
                        {banner.subtitle}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── Flash Deals ── */}
        {flashDeals.length > 0 && (
          <section style={{ marginTop: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{
                fontSize: 20, fontWeight: 600, color: "var(--shop-text)",
                fontFamily: "'Kantumruy Pro', sans-serif",
              }}>
                Flash Deals
              </h2>
              <Link href="/shop/search" style={{
                fontSize: 12, fontWeight: 500, color: "#D6BA80",
                textDecoration: "none", fontFamily: "'Kantumruy Pro', sans-serif",
              }}>
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
                      background: "var(--shop-surface)", borderRadius: 8,
                      overflow: "hidden", boxShadow: "var(--shop-shadow)",
                    }}
                  >
                    <div style={{ position: "relative", width: 140, height: 140, background: "var(--shop-divider)" }}>
                      {p.primary_image ? (
                        <img src={p.primary_image} alt={p.name} loading="lazy"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--shop-muted)" strokeWidth="1.5">
                            <rect x="2" y="2" width="20" height="20" rx="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <path d="M21 15l-5-5L5 21" />
                          </svg>
                        </div>
                      )}
                      {discount > 0 && (
                        <div style={{
                          position: "absolute", top: 8, left: 0,
                          display: "flex", flexDirection: "column", gap: 2,
                        }}>
                          <span className="product-badge product-badge-discount">
                            -{discount}% OFF
                          </span>
                        </div>
                      )}
                    </div>
                    <div style={{ padding: "8px 10px" }}>
                      {p.merchant_name && (
                        <p style={{
                          fontSize: 10, fontWeight: 600, color: "var(--shop-accent)",
                          fontFamily: "'Kantumruy Pro', sans-serif",
                          textTransform: "uppercase", lineHeight: "12px",
                          marginBottom: 2,
                        }}>
                          {p.merchant_name}
                        </p>
                      )}
                      <p style={{
                        fontSize: 12, color: "var(--shop-text)", fontWeight: 500,
                        fontFamily: "'Kantumruy Pro', sans-serif",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        lineHeight: "14px",
                      }}>
                        {p.name}
                      </p>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
                        <span style={{
                          fontSize: 15, fontWeight: 600, color: "var(--shop-accent)",
                          fontFamily: "'Kantumruy Pro', sans-serif",
                        }}>
                          ${p.base_price.toFixed(2)}
                        </span>
                        {p.compare_price && (
                          <span style={{
                            fontSize: 10, color: "var(--shop-muted)",
                            textDecoration: "line-through",
                            fontFamily: "'Kantumruy Pro', sans-serif",
                          }}>
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
              <h2 style={{
                fontSize: 20, fontWeight: 600, color: "var(--shop-text)",
                fontFamily: "'Kantumruy Pro', sans-serif",
              }}>
                Featured Shops
              </h2>
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
                      background: "var(--shop-surface)", borderRadius: 8,
                      textDecoration: "none", boxShadow: "var(--shop-shadow)",
                      border: "1px solid var(--shop-divider)",
                    }}
                  >
                    {isFeatured && (
                      <span className="product-badge product-badge-featured" style={{
                        position: "absolute", top: 10, right: 10,
                        borderRadius: "0 6px 6px 0",
                      }}>
                        FEATURED
                      </span>
                    )}
                    {m.logo_url ? (
                      <img
                        src={m.logo_url}
                        alt={m.name}
                        style={{
                          width: 44, height: 44, borderRadius: 8,
                          objectFit: "cover", marginBottom: 10,
                          background: "var(--shop-divider)",
                        }}
                      />
                    ) : (
                      <div style={{
                        width: 44, height: 44, borderRadius: 8,
                        background: "var(--shop-divider)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        marginBottom: 10,
                      }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--shop-primary)" strokeWidth="1.5">
                          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                          <polyline points="9,22 9,12 15,12 15,22" />
                        </svg>
                      </div>
                    )}
                    <p style={{
                      fontSize: 14, fontWeight: 700, color: "var(--shop-text)",
                      fontFamily: "'Kantumruy Pro', sans-serif",
                      marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {m.name}
                    </p>
                    {m.tagline && (
                      <p style={{
                        fontSize: 12, color: "var(--shop-muted)", lineHeight: 1.4,
                        fontFamily: "'Inter', sans-serif",
                        overflow: "hidden", textOverflow: "ellipsis",
                        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any,
                      }}>
                        {m.tagline}
                      </p>
                    )}
                    <p style={{
                      fontSize: 11, color: "var(--shop-muted)", marginTop: 8, fontWeight: 500,
                      fontFamily: "'Kantumruy Pro', sans-serif",
                    }}>
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
                <h2 style={{
                  fontSize: 20, fontWeight: 600, color: "var(--shop-text)",
                  fontFamily: "'Kantumruy Pro', sans-serif",
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  {m.logo_url ? (
                    <img
                      src={m.logo_url}
                      alt={m.name}
                      style={{ width: 24, height: 24, borderRadius: 6, objectFit: "cover" }}
                    />
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--shop-primary)" strokeWidth="1.5">
                      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                      <polyline points="9,22 9,12 15,12 15,22" />
                    </svg>
                  )}
                  {m.name}
                </h2>
                <Link href={`/shop/merchant/${m.id}`} style={{
                  fontSize: 12, fontWeight: 500, color: "#D6BA80",
                  textDecoration: "none", fontFamily: "'Kantumruy Pro', sans-serif",
                }}>
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

        {products.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{
              width: 64, height: 64, borderRadius: "50%", background: "var(--shop-divider)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--shop-primary)" strokeWidth="1.5">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
              </svg>
            </div>
            <p style={{ fontSize: 16, fontWeight: 600, color: "var(--shop-text)", marginBottom: 4, fontFamily: "'Kantumruy Pro', sans-serif" }}>No products yet</p>
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
        background: "var(--shop-surface)", borderRadius: 8,
        overflow: "hidden", textDecoration: "none",
        boxShadow: "var(--shop-shadow)",
      }}
    >
      <div style={{ position: "relative", paddingTop: "100%", background: "var(--shop-divider)" }}>
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
            transform: "translate(-50%,-50%)",
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--shop-muted)" strokeWidth="1.5">
              <rect x="2" y="2" width="20" height="20" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
        {/* Badges */}
        <div style={{
          position: "absolute", top: 8, left: 0,
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          {discount > 0 && (
            <span className="product-badge product-badge-discount">
              -{discount}% OFF
            </span>
          )}
        </div>
        {product.stock === 0 && (
          <div style={{
            position: "absolute", inset: 0,
            background: "rgba(8,29,60,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 13, fontWeight: 600,
            fontFamily: "'Kantumruy Pro', sans-serif",
            backdropFilter: "blur(2px)",
          }}>
            Out of Stock
          </div>
        )}
      </div>
      <div style={{ padding: "8px 10px 12px" }}>
        {product.merchant_name && (
          <p style={{
            fontSize: 10, fontWeight: 600, color: "var(--shop-accent)",
            fontFamily: "'Kantumruy Pro', sans-serif",
            textTransform: "uppercase", lineHeight: "12px",
            marginBottom: 2,
          }}>
            {product.merchant_name}
          </p>
        )}
        <div style={{
          fontSize: 12, fontWeight: 500, color: "var(--shop-text)",
          fontFamily: "'Kantumruy Pro', sans-serif",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          marginBottom: 4, lineHeight: "14px",
        }}>
          {product.name}
        </div>
        {(product.rating_avg || 0) > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="var(--shop-accent)" stroke="none">
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
            </svg>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--shop-text)", fontFamily: "'Kantumruy Pro', sans-serif" }}>
              {(product.rating_avg || 0).toFixed(1)}
            </span>
            <span style={{ fontSize: 10, color: "var(--shop-muted)" }}>&middot;</span>
            {(product.review_count || 0) > 0 && (
              <span style={{ fontSize: 10, color: "var(--shop-muted)", fontFamily: "'Inter', sans-serif" }}>
                {product.review_count} reviews
              </span>
            )}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{
            fontSize: 15, fontWeight: 600, color: "var(--shop-accent)",
            fontFamily: "'Kantumruy Pro', sans-serif",
          }}>
            ${product.base_price.toFixed(2)}
          </span>
          {discount > 0 && product.compare_price && (
            <span style={{
              fontSize: 10, color: "var(--shop-muted)",
              textDecoration: "line-through",
              fontFamily: "'Kantumruy Pro', sans-serif",
            }}>
              ${product.compare_price.toFixed(2)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
