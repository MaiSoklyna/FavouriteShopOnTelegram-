"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useCart } from "@/providers/CartProvider";
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
  const [suggested, setSuggested] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    inputRef.current?.focus();
    try { setRecentSearches(JSON.parse(localStorage.getItem("recentSearches") || "[]")); } catch { /* ignore */ }
    api.get<Category[]>("/categories").then(setCategories).catch(() => {});
    api
      .get<Product[]>("/products", { params: { page_size: 16 } })
      .then(setSuggested)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!query.trim() && !categoryId && !merchantId) { setResults([]); setHasSearched(false); return; }
    setSearching(true);
    const timer = setTimeout(() => performSearch(), 350);
    return () => clearTimeout(timer);
  }, [query, categoryId, merchantId]);

  const isEmptyFilters = !query.trim() && !categoryId && !merchantId;

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
    <div style={{ minHeight: "100vh", background: "var(--shop-bg)" }}>
      {/* Navigation + Search Header */}
      <div style={{
        background: "#103562",
        borderRadius: "0 0 20px 20px",
        padding: "12px 20px",
        display: "flex", flexDirection: "column", gap: 12,
        position: "sticky", top: 0, zIndex: 10,
      }}>
        {/* Title row */}
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
            Search
          </span>
        </div>

        {/* Search input */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "#EAEFF3", borderRadius: 20,
          padding: "8px 12px", height: 36,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(116, 109, 109, 0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Byme24"
            style={{
              flex: 1, border: "none", background: "transparent",
              color: "#081D3C", fontSize: 14,
              fontFamily: "'Inter', sans-serif",
              outline: "none", padding: 0,
            }}
          />
          {query && (
            <button onClick={() => { setQuery(""); inputRef.current?.focus(); }}
              style={{
                background: "rgba(116, 109, 109, 0.3)", border: "none",
                borderRadius: "50%", width: 20, height: 20, cursor: "pointer",
                color: "#FFFFFF", fontSize: 10,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
              &#10005;
            </button>
          )}
        </div>
      </div>

      {/* Category pills */}
      {categories.length > 0 && (
        <div style={{
          display: "flex", gap: 8, overflowX: "auto", padding: "12px 20px 0",
          scrollbarWidth: "none",
        }}>
          <button onClick={() => setCategoryId("")}
            style={{
              flexShrink: 0, padding: "6px 14px",
              borderRadius: 999,
              border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
              fontFamily: "'Kantumruy Pro', sans-serif",
              background: !categoryId ? "var(--shop-primary)" : "var(--shop-surface)",
              color: !categoryId ? "#FFFFFF" : "var(--shop-text)",
              boxShadow: "var(--shop-shadow)",
            }}>
            All
          </button>
          {categories.map(cat => {
            const active = categoryId === String(cat.id);
            return (
              <button key={cat.id} onClick={() => setCategoryId(String(cat.id))}
                style={{
                  flexShrink: 0, padding: "6px 14px",
                  borderRadius: 999,
                  border: "none", fontSize: 12, fontWeight: active ? 600 : 500, cursor: "pointer",
                  whiteSpace: "nowrap",
                  fontFamily: "'Kantumruy Pro', sans-serif",
                  background: active ? "var(--shop-primary)" : "var(--shop-surface)",
                  color: active ? "#FFFFFF" : "var(--shop-text)",
                  boxShadow: "var(--shop-shadow)",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}>
                {cat.name}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ padding: "16px 20px 80px" }}>
        {/* Recent Searches */}
        {!query && !categoryId && !hasSearched && recentSearches.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{
              fontSize: 16, fontWeight: 500, color: "var(--shop-text)", marginBottom: 12,
              fontFamily: "'Kantumruy Pro', sans-serif",
            }}>Recent Searches</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {recentSearches.map((s, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: "var(--shop-surface)",
                  borderRadius: 999,
                  padding: "8px 14px", fontSize: 13,
                  boxShadow: "var(--shop-shadow)",
                }}>
                  <button onClick={() => setQuery(s)} style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--shop-text)", fontWeight: 500,
                    fontFamily: "'Inter', sans-serif",
                  }}>{s}</button>
                  <button onClick={() => removeRecent(s)} style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--shop-muted)", fontSize: 11, fontWeight: 600,
                  }}>&#10005;</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Suggested products */}
        {!searching && isEmptyFilters && suggested.length > 0 && (
          <div>
            <h3 style={{
              fontSize: 16, fontWeight: 500, color: "var(--shop-text)",
              fontFamily: "'Kantumruy Pro', sans-serif",
              marginBottom: 4,
            }}>
              Suggested for you
            </h3>
            <p style={{ fontSize: 12, color: "var(--shop-muted)", marginBottom: 12 }}>
              Type to search or tap a product below
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {suggested.map(p => (
                <MiniProductCard
                  key={p.id}
                  product={p}
                  onClick={() => router.push(`/shop/product/${p.id}`)}
                  onAddToCart={() => addToCart(p.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {searching && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{
                height: 220, background: "var(--shop-surface)",
                borderRadius: 8, animation: "pulse 1.5s infinite",
              }} />
            ))}
          </div>
        )}

        {/* Results */}
        {!searching && hasSearched && results.length > 0 && (
          <div>
            <p style={{ fontSize: 13, color: "var(--shop-muted)", marginBottom: 12, fontFamily: "'Inter', sans-serif" }}>
              Found <strong style={{ color: "var(--shop-text)" }}>{results.length}</strong> results
              {query && <> for <strong style={{ color: "var(--shop-text)" }}>&apos;{query}&apos;</strong></>}
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
            <div style={{
              width: 64, height: 64, borderRadius: "50%", background: "var(--shop-surface)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--shop-primary)" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </div>
            <h3 style={{
              fontSize: 16, fontWeight: 500, color: "var(--shop-text)", marginBottom: 6,
              fontFamily: "'Kantumruy Pro', sans-serif",
            }}>
              No products found
            </h3>
            <p style={{ fontSize: 13, color: "var(--shop-muted)" }}>Try different keywords or categories</p>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniProductCard({ product, onClick, onAddToCart }: { product: Product; onClick: () => void; onAddToCart: () => void }) {
  const discount = product.compare_price && product.compare_price > product.base_price
    ? Math.round((1 - product.base_price / product.compare_price) * 100) : 0;

  return (
    <div onClick={onClick} style={{
      background: "var(--shop-surface)",
      borderRadius: 8, overflow: "hidden",
      cursor: "pointer",
      boxShadow: "var(--shop-shadow)",
      transition: "transform 0.15s",
    }}>
      <div style={{ position: "relative", paddingTop: "100%", background: "var(--shop-divider)" }}>
        {product.primary_image ? (
          <img src={product.primary_image} alt={product.name} loading="lazy"
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%,-50%)",
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#746D6D" strokeWidth="1.5">
              <rect x="2" y="2" width="20" height="20" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
        {discount > 0 && (
          <div style={{ position: "absolute", top: 8, left: 0 }}>
            <span className="product-badge product-badge-discount">
              -{discount}% OFF
            </span>
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
            }}>
              ${product.compare_price.toFixed(2)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
