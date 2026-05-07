"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useCart } from "@/providers/CartProvider";
import { CategoryIcon } from "@/components/shop";
import type { Product, Category } from "@/types";

export default function SearchPage() {
  return <Suspense><SearchContent /></Suspense>;
}

function SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToCart } = useCart();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [categoryId, setCategoryId] = useState(searchParams.get("category") || "");
  const [merchantId, setMerchantId] = useState(searchParams.get("merchant") || "");
  const [results, setResults] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    inputRef.current?.focus();
    try { setRecentSearches(JSON.parse(localStorage.getItem("recentSearches") || "[]")); } catch { /* ignore */ }
    api.get<Category[]>("/categories").then(setCategories).catch(() => {});
  }, []);

  // Auto-search on query change
  useEffect(() => {
    if (!query.trim() && !categoryId && !merchantId) { setResults([]); setHasSearched(false); return; }
    setSearching(true);
    const timer = setTimeout(() => performSearch(), 350);
    return () => clearTimeout(timer);
  }, [query, categoryId, merchantId]);

  async function performSearch() {
    try {
      const params: Record<string, string | number> = { page_size: 20 };
      if (query.trim()) params.search = query.trim();
      if (categoryId) params.category_id = Number(categoryId);
      if (merchantId) params.merchant_id = Number(merchantId);
      const data = await api.get<Product[]>("/products", { params });
      setResults(data);
      setHasSearched(true);
      if (query.trim()) saveRecentSearch(query.trim());
    } catch { setResults([]); setHasSearched(true); }
    finally { setSearching(false); }
  }

  function saveRecentSearch(term: string) {
    const updated = [term, ...recentSearches.filter(s => s !== term)].slice(0, 5);
    setRecentSearches(updated);
    localStorage.setItem("recentSearches", JSON.stringify(updated));
  }

  function removeRecent(term: string) {
    const updated = recentSearches.filter(s => s !== term);
    setRecentSearches(updated);
    localStorage.setItem("recentSearches", JSON.stringify(updated));
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg, #F7F8FB)" }}>
      {/* Search Bar Area */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        background: "var(--shop-surface, #FFFFFF)",
        borderBottom: "1px solid var(--shop-divider, #ECEEF3)",
        padding: "10px 16px 12px",
      }}>
        <div style={{ position: "relative" }}>
          <span style={{
            position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)",
            color: "var(--shop-muted, #8A8F9C)", fontSize: 16, pointerEvents: "none",
          }}>
            &#128269;
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products..."
            style={{
              width: "100%", height: 52, padding: "0 44px 0 44px",
              borderRadius: "var(--shop-r-input, 12px)",
              border: "1.5px solid var(--shop-divider, #ECEEF3)",
              background: "var(--shop-bg, #F7F8FB)",
              color: "var(--shop-black, #0B0B0F)", fontSize: 15,
              outline: "none",
              transition: "border-color 0.2s",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--shop-primary, #1E6BFF)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "var(--shop-divider, #ECEEF3)"; }}
          />
          {query && (
            <button onClick={() => { setQuery(""); inputRef.current?.focus(); }}
              style={{
                position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                background: "var(--shop-divider, #ECEEF3)", border: "none",
                borderRadius: "50%", width: 24, height: 24, cursor: "pointer",
                color: "var(--shop-muted, #8A8F9C)", fontSize: 12,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
              &#10005;
            </button>
          )}
        </div>

        {/* Category pills */}
        {categories.length > 0 && (
          <div style={{
            display: "flex", gap: 8, overflowX: "auto", marginTop: 12, paddingBottom: 2,
          }}>
            <button onClick={() => setCategoryId("")}
              style={{
                flexShrink: 0, padding: "7px 16px",
                borderRadius: "var(--shop-r-pill, 999px)",
                border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
                background: !categoryId ? "var(--shop-primary, #1E6BFF)" : "var(--shop-surface, #FFFFFF)",
                color: !categoryId ? "#FFFFFF" : "var(--shop-text, #4A4E5A)",
                boxShadow: !categoryId ? "none" : "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
              }}>
              All
            </button>
            {categories.map(cat => {
              const active = categoryId === String(cat.id);
              return (
                <button key={cat.id} onClick={() => setCategoryId(String(cat.id))}
                  style={{
                    flexShrink: 0, padding: "7px 14px",
                    borderRadius: "var(--shop-r-pill, 999px)",
                    border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    whiteSpace: "nowrap",
                    background: active ? "var(--shop-primary, #1E6BFF)" : "var(--shop-surface, #FFFFFF)",
                    color: active ? "#FFFFFF" : "var(--shop-text, #4A4E5A)",
                    boxShadow: active ? "none" : "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}>
                  <CategoryIcon icon={cat.icon_emoji} size={16} alt={cat.name} />
                  {cat.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ padding: "16px 16px 80px" }}>
        {/* Recent Searches */}
        {!query && !categoryId && !hasSearched && recentSearches.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{
              fontSize: 17, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", marginBottom: 12,
            }}>Recent Searches</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {recentSearches.map((s, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: "var(--shop-surface, #FFFFFF)",
                  borderRadius: "var(--shop-r-pill, 999px)",
                  padding: "8px 14px", fontSize: 13,
                  boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
                }}>
                  <button onClick={() => setQuery(s)} style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--shop-text, #4A4E5A)", fontWeight: 500,
                  }}>{s}</button>
                  <button onClick={() => removeRecent(s)} style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--shop-muted, #8A8F9C)", fontSize: 11, fontWeight: 600,
                  }}>&#10005;</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {searching && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{
                height: 220, background: "var(--shop-divider, #ECEEF3)",
                borderRadius: "var(--shop-r-card, 16px)", animation: "pulse 1.5s infinite",
              }} />
            ))}
          </div>
        )}

        {/* Results */}
        {!searching && hasSearched && results.length > 0 && (
          <div>
            <p style={{ fontSize: 13, color: "var(--shop-muted, #8A8F9C)", marginBottom: 12 }}>
              Found <strong style={{ color: "var(--shop-black, #0B0B0F)" }}>{results.length}</strong> results
              {query && <> for <strong style={{ color: "var(--shop-black, #0B0B0F)" }}>&apos;{query}&apos;</strong></>}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {results.map(p => (
                <MiniProductCard key={p.id} product={p} onClick={() => router.push(`/shop/product/${p.id}`)}
                  onAddToCart={() => addToCart(p.id)} />
              ))}
            </div>
          </div>
        )}

        {/* No results */}
        {!searching && hasSearched && results.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>&#128269;</div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", marginBottom: 6 }}>
              No products found
            </h3>
            <p style={{ fontSize: 13, color: "var(--shop-muted, #8A8F9C)" }}>Try different keywords or categories</p>
          </div>
        )}
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}

function MiniProductCard({ product, onClick, onAddToCart }: { product: Product; onClick: () => void; onAddToCart: () => void }) {
  const discount = product.compare_price && product.compare_price > product.base_price
    ? Math.round((1 - product.base_price / product.compare_price) * 100) : 0;

  return (
    <div onClick={onClick} style={{
      background: "var(--shop-surface, #FFFFFF)",
      borderRadius: "var(--shop-r-card, 16px)", overflow: "hidden",
      cursor: "pointer",
      boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
      transition: "transform 0.15s",
    }}>
      <div style={{ position: "relative", paddingTop: "100%", background: "var(--shop-divider, #ECEEF3)" }}>
        {product.primary_image ? (
          <img src={product.primary_image} alt={product.name} loading="lazy"
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%,-50%)", fontSize: 32,
          }}>
            {product.icon_emoji || "🛍️"}
          </div>
        )}
        {discount > 0 && (
          <span style={{
            position: "absolute", top: 8, left: 8,
            background: "#C62828", color: "#FFFFFF",
            fontSize: 10, fontWeight: 700, padding: "3px 8px",
            borderRadius: 8,
          }}>
            -{discount}%
          </span>
        )}
      </div>
      <div style={{ padding: 12 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: "var(--shop-black, #0B0B0F)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 6,
        }}>
          {product.name}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--shop-primary, #1E6BFF)" }}>
            ${product.base_price.toFixed(2)}
          </span>
          {discount > 0 && product.compare_price && (
            <span style={{
              fontSize: 11, color: "var(--shop-muted, #8A8F9C)",
              textDecoration: "line-through",
            }}>
              ${product.compare_price.toFixed(2)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
