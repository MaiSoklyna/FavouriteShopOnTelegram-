"use client";

export const runtime = "edge";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { ProductCard, CategoryIcon } from "@/components/shop";
import { useCart } from "@/providers/CartProvider";
import type { Merchant, Product, Category } from "@/types";

export default function MerchantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { addToCart } = useCart();

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heroImages, setHeroImages] = useState<{ id: number; url: string }[]>([]);
  const [heroIdx, setHeroIdx] = useState(0);
  const heroTouchStart = useRef<number | null>(null);
  const heroPause = useRef(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    setError(null);

    Promise.all([
      api.get<Merchant>(`/merchants/${id}`),
      api.get<Product[]>("/products", { params: { merchant_id: Number(id), page_size: 60 } }),
      api.get<Category[]>("/categories", { params: { merchant_id: Number(id) } }),
      api.get<{ id: number; url: string }[]>(`/merchants/${id}/hero-images`).catch(() => []),
    ])
      .then(([m, p, c, h]) => {
        if (!alive) return;
        setMerchant(m);
        setProducts(p);
        setCategories(c);
        setHeroImages(h || []);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err?.status === 404 ? "Shop not found" : "Could not load shop");
      })
      .finally(() => alive && setLoading(false));

    return () => { alive = false; };
  }, [id]);

  // Auto-rotate hero
  useEffect(() => {
    if (heroImages.length <= 1) return;
    const t = setInterval(() => {
      if (heroPause.current) return;
      setHeroIdx(i => (i + 1) % heroImages.length);
    }, 4500);
    return () => clearInterval(t);
  }, [heroImages.length]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--shop-bg)" }}>
        <div style={{ height: 180, background: "var(--shop-divider)", animation: "pulse 1.5s infinite" }} />
        <div style={{ padding: 16 }}>
          <div style={{ height: 18, width: "50%", background: "var(--shop-divider)", borderRadius: 6, marginBottom: 10, animation: "pulse 1.5s infinite" }} />
          <div style={{ height: 12, width: "80%", background: "var(--shop-divider)", borderRadius: 6, marginBottom: 24, animation: "pulse 1.5s infinite" }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{ height: 220, background: "var(--shop-divider)", borderRadius: 16, animation: "pulse 1.5s infinite" }} />
            ))}
          </div>
        </div>
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
      </div>
    );
  }

  if (error || !merchant) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--shop-bg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>🏪</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--shop-black)", marginBottom: 6 }}>{error || "Shop unavailable"}</h2>
        <p style={{ fontSize: 13, color: "var(--shop-muted)", marginBottom: 20 }}>The shop you’re looking for doesn’t exist or is no longer active.</p>
        <button
          onClick={() => router.push("/shop")}
          style={{ padding: "10px 24px", background: "var(--shop-primary)", color: "#fff", border: "none", borderRadius: "var(--shop-r-pill)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
        >
          Back to Home
        </button>
      </div>
    );
  }

  const visibleProducts = activeCategory === "all"
    ? products
    : products.filter(p => p.category_id === activeCategory);

  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg)", paddingBottom: 80 }}>
      {/* Header banner — hero carousel if available, else gradient */}
      <div style={{
        position: "relative",
        background: heroImages.length > 0
          ? "var(--shop-divider)"
          : `linear-gradient(135deg, ${merchant.accent_color || "var(--shop-primary)"}, var(--shop-primary-dark, #1453d8))`,
        height: heroImages.length > 0 ? 280 : "auto",
        padding: heroImages.length > 0 ? 0 : "16px 16px 56px",
        color: "#fff",
        overflow: "hidden",
      }}
        onTouchStart={(e) => {
          if (heroImages.length <= 1) return;
          heroTouchStart.current = e.touches[0].clientX;
          heroPause.current = true;
        }}
        onTouchEnd={(e) => {
          if (heroTouchStart.current === null) return;
          const diff = heroTouchStart.current - e.changedTouches[0].clientX;
          if (Math.abs(diff) > 50) {
            setHeroIdx(prev => diff > 0
              ? (prev + 1) % heroImages.length
              : (prev - 1 + heroImages.length) % heroImages.length);
          }
          heroTouchStart.current = null;
          setTimeout(() => { heroPause.current = false; }, 5000);
        }}
      >
        {/* Carousel layer */}
        {heroImages.length > 0 && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            width: `${heroImages.length * 100}%`,
            transform: `translateX(-${heroIdx * (100 / heroImages.length)}%)`,
            transition: "transform 0.45s ease",
          }}>
            {heroImages.map(img => (
              <div key={img.id} style={{ width: `${100 / heroImages.length}%`, height: "100%" }}>
                <img src={img.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
              </div>
            ))}
          </div>
        )}

        {/* Gradient overlay so text stays readable on top of any image */}
        {heroImages.length > 0 && (
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%)",
            pointerEvents: "none",
          }} />
        )}

        {/* Back button */}
        <button onClick={() => router.back()} style={{
          position: "absolute", top: 14, left: 14, width: 36, height: 36,
          borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.45)",
          color: "#fff", cursor: "pointer", fontSize: 18, zIndex: 2,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} aria-label="Back">←</button>

        {/* Bottom info overlay */}
        <div style={{
          position: heroImages.length > 0 ? "absolute" : "static",
          left: 0, right: 0, bottom: heroImages.length > 0 ? 16 : "auto",
          padding: heroImages.length > 0 ? "0 16px" : 0,
          marginTop: heroImages.length > 0 ? 0 : 28,
          zIndex: 2,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: merchant.logo_url ? "transparent" : "rgba(255,255,255,0.22)",
              display: "flex", alignItems: "center", justifyContent: "center",
              overflow: "hidden", flexShrink: 0,
              boxShadow: heroImages.length > 0 ? "0 2px 12px rgba(0,0,0,0.3)" : "none",
            }}>
              {merchant.logo_url
                ? <img src={merchant.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <CategoryIcon icon={merchant.icon_emoji} size={28} fallback="shop" alt={merchant.name} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2, textShadow: heroImages.length > 0 ? "0 1px 4px rgba(0,0,0,0.5)" : "none" }}>
                {merchant.name}
              </h1>
              {merchant.tagline && (
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.92)", marginTop: 4, textShadow: heroImages.length > 0 ? "0 1px 3px rgba(0,0,0,0.5)" : "none" }}>
                  {merchant.tagline}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Dots */}
        {heroImages.length > 1 && (
          <div style={{
            position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)",
            display: "flex", gap: 5, zIndex: 2,
          }}>
            {heroImages.map((_, i) => (
              <button key={i} onClick={() => setHeroIdx(i)}
                style={{
                  width: i === heroIdx ? 18 : 6, height: 6, borderRadius: 4,
                  border: "none", padding: 0, cursor: "pointer",
                  background: i === heroIdx ? "#fff" : "rgba(255,255,255,0.5)",
                  transition: "all 0.25s ease",
                }} />
            ))}
          </div>
        )}
      </div>

      {/* Stats card overlapping banner */}
      <div style={{
        margin: "-40px 16px 0", padding: "14px 16px",
        background: "var(--shop-surface)", borderRadius: "var(--shop-r-card)",
        boxShadow: "var(--shop-shadow)", display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center",
      }}>
        <Stat label="Products" value={merchant.product_count ?? products.length} />
        <Divider />
        <Stat label="Orders" value={merchant.order_count ?? 0} />
        <Divider />
        <Stat label="Status" value={merchant.status === "active" ? "Open" : "Closed"} />
      </div>

      {/* About */}
      {merchant.description && (
        <section style={{ padding: "20px 16px 0" }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--shop-black)", marginBottom: 6 }}>About</h2>
          <p style={{ fontSize: 13, color: "var(--shop-text)", lineHeight: 1.5 }}>{merchant.description}</p>
        </section>
      )}

      {/* Category filter */}
      {categories.length > 0 && (
        <div style={{
          display: "flex", gap: 8, overflowX: "auto", padding: "16px 16px 4px",
          scrollbarWidth: "none",
        }}>
          <Pill active={activeCategory === "all"} onClick={() => setActiveCategory("all")}>All</Pill>
          {categories.map(cat => (
            <Pill key={cat.id} active={activeCategory === cat.id} onClick={() => setActiveCategory(cat.id)}>
              <CategoryIcon icon={cat.icon_emoji} size={14} alt={cat.name} />
              {cat.name}
            </Pill>
          ))}
        </div>
      )}

      {/* Products */}
      <section style={{ padding: "8px 16px" }}>
        {visibleProducts.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>🛍️</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--shop-black)" }}>No products yet</p>
            <p style={{ fontSize: 12, color: "var(--shop-muted)", marginTop: 4 }}>Check back soon for new arrivals</p>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 12, color: "var(--shop-muted)", margin: "8px 0 12px" }}>
              {visibleProducts.length} product{visibleProducts.length === 1 ? "" : "s"}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {visibleProducts.map(p => (
                <ProductCard key={p.id} product={p} onAddToCart={addToCart} />
              ))}
            </div>
          </>
        )}
      </section>

      {/* Social/contact links */}
      {(merchant.fb_page || merchant.instagram || merchant.phone) && (
        <section style={{ padding: "20px 16px 8px" }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--shop-black)", marginBottom: 10 }}>Contact</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {merchant.phone && (
              <Link href={`tel:${merchant.phone}`} style={contactPill}>📞 {merchant.phone}</Link>
            )}
            {merchant.fb_page && (
              <a href={merchant.fb_page} target="_blank" rel="noreferrer" style={contactPill}>Facebook</a>
            )}
            {merchant.instagram && (
              <a href={merchant.instagram} target="_blank" rel="noreferrer" style={contactPill}>Instagram</a>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--shop-black)" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--shop-muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, background: "var(--shop-divider)" }} />;
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0, padding: "7px 14px", borderRadius: "var(--shop-r-pill, 999px)",
        border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
        background: active ? "var(--shop-primary)" : "var(--shop-surface)",
        color: active ? "#fff" : "var(--shop-text)",
        boxShadow: active ? "none" : "var(--shop-shadow)",
        display: "inline-flex", alignItems: "center", gap: 6,
      }}
    >
      {children}
    </button>
  );
}

const contactPill: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: "var(--shop-r-pill, 999px)",
  background: "var(--shop-surface)",
  color: "var(--shop-text)",
  fontSize: 12,
  fontWeight: 600,
  textDecoration: "none",
  boxShadow: "var(--shop-shadow)",
};
