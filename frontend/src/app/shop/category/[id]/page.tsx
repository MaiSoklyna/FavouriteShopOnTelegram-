"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useCart } from "@/providers/CartProvider";
import { ProductCard } from "@/components/shop";
import type { Product, Category, CategoryBanner } from "@/types";

export default function CategoryPage() {
  const router = useRouter();
  const params = useParams();
  const { addToCart } = useCart();
  const categoryId = params.id as string;

  const [category, setCategory] = useState<Category | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [catBanners, setCatBanners] = useState<CategoryBanner[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [cats, prods, banners] = await Promise.all([
          api.get<Category[]>("/categories"),
          api.get<Product[]>("/products", { params: { category_id: Number(categoryId), page_size: 50 } }),
          api.get<CategoryBanner[]>("/category-banners", { params: { placement: "category", category_id: Number(categoryId) } }).catch(() => [] as CategoryBanner[]),
        ]);
        setAllCategories(cats);
        setCategory(cats.find(c => c.id === Number(categoryId)) || null);
        setProducts(prods);
        setCatBanners(banners);
      } catch (err) {
        console.error("Failed to load category:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [categoryId]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg)" }}>
      {/* Navy header */}
      <div style={{
        background: "#103562",
        borderRadius: "0 0 20px 20px",
        padding: "12px 20px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => router.back()}
            style={{
              width: 36, height: 36, borderRadius: 20,
              background: "rgba(234, 239, 243, 0.2)",
              border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </button>
          <span style={{
            flex: 1, fontSize: 16, fontWeight: 500, color: "#FFFFFF",
            fontFamily: "'Kantumruy Pro', sans-serif",
          }}>
            {category?.name || "Category"}
          </span>
        </div>
      </div>

      {/* Sub-categories horizontal scroll */}
      {allCategories.length > 0 && (
        <div style={{
          display: "flex", gap: 8, overflowX: "auto", padding: "12px 20px 0",
          scrollbarWidth: "none",
        }}>
          {allCategories.map(cat => {
            const active = cat.id === Number(categoryId);
            return (
              <Link
                key={cat.id}
                href={`/shop/category/${cat.id}`}
                style={{
                  flexShrink: 0, padding: "6px 14px",
                  borderRadius: 999,
                  fontSize: 12, fontWeight: active ? 600 : 500,
                  fontFamily: "'Kantumruy Pro', sans-serif",
                  background: active ? "var(--shop-primary)" : "var(--shop-surface)",
                  color: active ? "#FFFFFF" : "var(--shop-text)",
                  boxShadow: "0 2px 8px rgba(8,29,60,0.06)",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {cat.name}
              </Link>
            );
          })}
        </div>
      )}

      {/* Category banners or hero image */}
      {catBanners.filter(b => b.image_url).length > 0 ? (
        <div style={{ padding: "12px 20px 0" }}>
          <div style={{
            display: "flex", gap: 12, overflowX: "auto",
            scrollbarWidth: "none", scrollSnapType: "x mandatory",
          }}>
            {catBanners.filter(b => b.image_url).map(banner => (
              <div key={banner.id} style={{
                flexShrink: 0, width: "100%", height: 176, borderRadius: 8,
                position: "relative", overflow: "hidden", scrollSnapAlign: "start",
              }}>
                <img src={banner.image_url!} alt={banner.title}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <div style={{
                  position: "absolute", inset: 0,
                  background: "linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.6) 100%)",
                }} />
                <div style={{ position: "absolute", bottom: 16, left: 16, right: 16 }}>
                  <h3 style={{
                    fontSize: 22, fontWeight: 700, color: "#EAEFF3",
                    fontFamily: "'Kantumruy Pro', sans-serif", lineHeight: "28px", marginBottom: 4,
                  }}>
                    {banner.title}
                  </h3>
                  {banner.subtitle && (
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", fontFamily: "'Inter', sans-serif" }}>
                      {banner.subtitle}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : category && category.image_url && (
        <div style={{ padding: "16px 20px 0" }}>
          <div style={{
            width: "100%", height: 160, borderRadius: 8,
            overflow: "hidden", background: "var(--shop-surface)",
          }}>
            <img src={category.image_url} alt={category.name}
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        </div>
      )}

      <div style={{ padding: "16px 20px 80px" }}>
        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{
                height: 220, background: "var(--shop-divider)",
                borderRadius: 8, animation: "pulse 1.5s infinite",
              }} />
            ))}
          </div>
        ) : products.length > 0 ? (
          <>
            <p style={{
              fontSize: 13, color: "var(--shop-muted)", marginBottom: 12,
              fontFamily: "'Inter', sans-serif",
            }}>
              {products.length} product{products.length !== 1 ? "s" : ""} in {category?.name || "this category"}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {products.map(p => (
                <ProductCard key={p.id} product={p} onAddToCart={async (id) => { await addToCart(id); }} />
              ))}
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{
              width: 64, height: 64, borderRadius: "50%", background: "var(--shop-surface)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#103562" strokeWidth="1.5">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
            </div>
            <h3 style={{
              fontSize: 16, fontWeight: 500, color: "var(--shop-text)", marginBottom: 6,
              fontFamily: "'Kantumruy Pro', sans-serif",
            }}>
              No products yet
            </h3>
            <p style={{ fontSize: 13, color: "var(--shop-muted)" }}>
              Products will appear here soon
            </p>
          </div>
        )}
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}
