"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { isOutOfStock, OutOfStockOverlay } from "@/components/shop/OutOfStock";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { trackActivity } from "@/lib/activity";
import { useCart } from "@/providers/CartProvider";
import { ShopRow } from "@/components/shop/ShopRow";
import { themeFromShopCategory } from "@/lib/shopTheme";
import type { Product, Category, Merchant, SearchFacet } from "@/types";
import { img, IMG } from "@/lib/img";
import { useShopCategories } from "@/lib/useShopCategories";
import {
  EMPTY_FILTERS, SORTS, SearchFilterSheet, activeFilterCount, filterParams, filtersFromUrl,
  type SearchFilterState,
} from "@/components/shop/SearchFilters";

interface SearchResponse { data: Product[]; total: number; facets: SearchFacet[]; shop_type: number | null }

export default function SearchPage() {
  return <Suspense><SearchContent /></Suspense>;
}

function SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToCart } = useCart();
  const inputRef = useRef<HTMLInputElement>(null);
  // Only the newest search may fill the page: an older, slower answer must not overwrite it
  const searchSeq = useRef(0);

  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [categoryId, setCategoryId] = useState(searchParams.get("category") || "");
  const [merchantId, setMerchantId] = useState(searchParams.get("merchant") || "");
  const [results, setResults] = useState<Product[]>([]);
  const [suggested, setSuggested] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  // Shop type, price, stock, sort and product-detail filters; kept in the page URL
  const [filters, setFilters] = useState<SearchFilterState>(() => filtersFromUrl(new URLSearchParams(searchParams.toString())));
  const [facets, setFacets] = useState<SearchFacet[]>([]);
  const [total, setTotal] = useState(0);
  const [scopedType, setScopedType] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { categories: shopTypes } = useShopCategories();
  const filterCount = activeFilterCount(filters);
  // Shops are searched too: by name, tagline, or the kind of shop ("fashion", "cake shop")
  const [shops, setShops] = useState<Merchant[]>([]);
  const needle = query.trim().toLowerCase();
  const shopMatches = needle
    ? shops.filter((s) => [s.name, s.tagline, s.shop_category, s.shop_subcategory].some((v) => v?.toLowerCase().includes(needle))).slice(0, 5)
    : [];

  useEffect(() => {
    api.get<Merchant[]>("/merchants").then(setShops).catch(() => {});
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    try { setRecentSearches(JSON.parse(localStorage.getItem("recentSearches") || "[]")); } catch { /* ignore */ }
    api.get<Category[]>("/categories").then(setCategories).catch(() => {});
    api
      .get<Product[]>("/products", { params: { page_size: 16 } })
      .then(setSuggested)
      .catch(() => {});
  }, []);

  const filtersOn = !!filters.type || filterCount > 0 || filters.sort !== "relevance";
  const isEmptyFilters = !query.trim() && !categoryId && !merchantId && !filtersOn;

  // Keep the address in step, so a filtered search survives a reload and can be shared
  useEffect(() => {
    const p = new URLSearchParams(filterParams(filters, false));
    if (query.trim()) p.set("q", query.trim());
    if (categoryId) p.set("category", categoryId);
    if (merchantId) p.set("merchant", merchantId);
    const qs = p.toString();
    router.replace(qs ? `/shop/search?${qs}` : "/shop/search", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, categoryId, merchantId, filters]);

  useEffect(() => {
    if (isEmptyFilters) { setResults([]); setFacets([]); setTotal(0); setHasSearched(false); return; }
    setSearching(true);
    const timer = setTimeout(() => performSearch(), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, categoryId, merchantId, filters]);

  /** A new shop type has different product details, so its detail filters start empty. */
  function pickShopType(id: string) {
    setFilters((f) => ({ ...f, type: f.type === id ? "" : id, attrs: {} }));
  }

  // Count a search once the customer has stopped typing and results (products or shops) are on screen.
  // A search that found nothing is the most useful kind to see, so the result count goes with it.
  const found = results.length + shopMatches.length;
  useEffect(() => {
    const q = query.trim();
    if (!hasSearched || searching || q.length < 2) return;
    const t = setTimeout(() => trackActivity({ type: "search", query: q, result_count: found }), 1500);
    return () => clearTimeout(t);
  }, [hasSearched, searching, query, found]);

  async function performSearch() {
    const seq = ++searchSeq.current;
    try {
      const params: Record<string, string | number> = { page_size: 40, ...filterParams(filters, true) };
      if (query.trim()) params.q = query.trim();
      if (categoryId) params.category_id = Number(categoryId);
      if (merchantId) params.merchant_id = Number(merchantId);
      const res = await api.get<SearchResponse>("/search/products", { params });
      if (seq !== searchSeq.current) return;
      setResults(res.data);
      setTotal(res.total);
      setFacets(res.facets || []);
      setScopedType(res.shop_type ?? null);
      setHasSearched(true);
      if (query.trim()) saveRecentSearch(query.trim());
    } catch {
      if (seq !== searchSeq.current) return;
      setResults([]); setFacets([]); setTotal(0); setHasSearched(true);
    } finally { if (seq === searchSeq.current) setSearching(false); }
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

      {/* Kind of shop + filters: choosing a kind turns on its product-detail filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "12px 20px 0" }}>
        <button onClick={() => setSheetOpen(true)} data-testid="open-filters"
          style={{
            flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999,
            border: filterCount ? "1px solid var(--shop-primary)" : "1px solid var(--shop-divider)",
            background: filterCount ? "var(--shop-primary)" : "var(--shop-surface)",
            color: filterCount ? "#FFFFFF" : "var(--shop-text)", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          Filters{filterCount ? ` · ${filterCount}` : ""}
        </button>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none" }}>
          {/* The chosen kind first, so it is in view without scrolling */}
          {[...shopTypes].sort((x, y) => Number(filters.type === String(y.id)) - Number(filters.type === String(x.id))).map((t) => {
            const on = filters.type === String(t.id);
            return (
              <button key={t.id} onClick={() => pickShopType(String(t.id))} data-testid={`shop-type-${t.id}`}
                style={{
                  flexShrink: 0, padding: "6px 12px", borderRadius: 999, whiteSpace: "nowrap", fontSize: 12, cursor: "pointer",
                  fontWeight: on ? 600 : 500,
                  border: on ? "1px solid #103562" : "1px solid var(--shop-divider)",
                  background: on ? "#103562" : "var(--shop-surface)", color: on ? "#FFFFFF" : "var(--shop-text)",
                }}>
                {t.name}
              </button>
            );
          })}
        </div>
      </div>

      <SearchFilterSheet open={sheetOpen} onClose={() => setSheetOpen(false)} value={filters} onApply={setFilters}
        facets={facets} total={total} typeChosen={scopedType != null} />

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

        {/* Shops matching the search */}
        {shopMatches.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <h3 style={{
              fontSize: 16, fontWeight: 500, color: "var(--shop-text)", marginBottom: 12,
              fontFamily: "'Kantumruy Pro', sans-serif",
            }}>Shops</h3>
            <div className="flex flex-col gap-2.5">
              {shopMatches.map((s) => (
                <ShopRow key={s.id} shop={{
                  id: s.id, name: s.name, tagline: s.tagline, logo_url: s.logo_url, icon_emoji: s.icon_emoji,
                  theme: themeFromShopCategory(s.shop_category),
                  shop_category_id: s.shop_category_id, shop_subcategory_id: s.shop_subcategory_id,
                  shop_category: s.shop_category, shop_subcategory: s.shop_subcategory,
                }} />
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {!searching && hasSearched && results.length > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: "var(--shop-muted)", fontFamily: "'Inter', sans-serif" }} data-testid="result-count">
                Found <strong style={{ color: "var(--shop-text)" }}>{total}</strong> {total === 1 ? "result" : "results"}
                {query && <> for <strong style={{ color: "var(--shop-text)" }}>&apos;{query}&apos;</strong></>}
              </p>
              <select value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))} aria-label="Sort"
                style={{ fontSize: 12, border: "1px solid var(--shop-divider)", borderRadius: 8, padding: "4px 6px", background: "var(--shop-surface)", color: "var(--shop-text)" }}>
                {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {results.map(p => (
                <MiniProductCard key={p.id} product={p} onClick={() => router.push(`/shop/product/${p.id}`)}
                  onAddToCart={() => addToCart(p.id)} />
              ))}
            </div>
          </div>
        )}

        {/* No results */}
        {!searching && hasSearched && results.length === 0 && shopMatches.length === 0 && (
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
            {filterCount > 0 && (
              <button onClick={() => setFilters((f) => ({ ...EMPTY_FILTERS, type: f.type, sort: f.sort }))}
                style={{ marginTop: 12, background: "none", border: "none", color: "var(--shop-primary)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                Clear filters
              </button>
            )}
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
          <img src={img(product.primary_image, IMG.CARD)} alt={product.name} loading="lazy"
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
        {isOutOfStock(product) && <OutOfStockOverlay />}
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
