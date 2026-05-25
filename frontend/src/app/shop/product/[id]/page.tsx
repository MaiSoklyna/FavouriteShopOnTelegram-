"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useCart } from "@/providers/CartProvider";
import { useAuth } from "@/providers/AuthProvider";
import type { Product } from "@/types";

export default function ProductDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { addToCart } = useCart();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const [wishlisted, setWishlisted] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "specs" | "reviews">("details");
  const [reviews, setReviews] = useState<any[]>([]);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  // variant_id -> option_id
  const [selectedOptions, setSelectedOptions] = useState<Record<number, number>>({});
  const touchStart = useRef<number | null>(null);
  const pauseRef = useRef(false);

  useEffect(() => {
    setWishlisted(localStorage.getItem(`wishlist_${id}`) === "true");
    api.get<Product>(`/products/${id}`)
      .then(setProduct)
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));
  }, [id]);

  // Auto-slide images
  useEffect(() => {
    if (!product) return;
    const images = product.images || [];
    if (images.length <= 1) return;
    const interval = setInterval(() => {
      if (pauseRef.current) return;
      setImgIdx(prev => (prev + 1) % images.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [product]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStart.current = e.touches[0].clientX;
    pauseRef.current = true;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent, total: number) => {
    if (touchStart.current === null) return;
    const diff = touchStart.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      setImgIdx(prev => diff > 0 ? Math.min(prev + 1, total - 1) : Math.max(prev - 1, 0));
    }
    touchStart.current = null;
    setTimeout(() => { pauseRef.current = false; }, 4000);
  }, []);

  useEffect(() => {
    if (activeTab === "reviews") {
      api.get<any[]>("/reviews", { params: { product_id: Number(id) } })
        .then(setReviews).catch(() => {});
    }
  }, [activeTab, id]);

  async function submitReview() {
    setSubmittingReview(true);
    try {
      await api.post("/reviews", { product_id: Number(id), rating: reviewRating, comment: reviewComment });
      setReviewComment("");
      setReviewRating(5);
      const updated = await api.get<any[]>("/reviews", { params: { product_id: Number(id) } });
      setReviews(updated);
      const refreshed = await api.get<Product>(`/products/${id}`);
      setProduct(refreshed);
      alert("Review submitted!");
    } catch (e: any) { alert(e.detail || "Failed to submit review"); }
    finally { setSubmittingReview(false); }
  }

  async function handleAddToCart() {
    if (!user || !product) return;
    const groups = product.variants || [];
    const missing = groups.filter(g => !selectedOptions[g.id]);
    if (missing.length > 0) {
      alert(`Please choose: ${missing.map(g => g.group_name).join(", ")}`);
      return;
    }
    const variantsPayload = groups.map(g => {
      const optId = selectedOptions[g.id];
      const opt = g.options.find(o => o.id === optId)!;
      return { variant_id: g.id, option_id: optId, group_name: g.group_name, label: opt.label };
    });
    setAdding(true);
    try {
      await addToCart(product.id, qty, variantsPayload);
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } catch (e: any) {
      alert(e?.detail || e?.message || "Could not add to cart");
    }
    setAdding(false);
  }

  function toggleWishlist() {
    const next = !wishlisted;
    setWishlisted(next);
    next ? localStorage.setItem(`wishlist_${id}`, "true") : localStorage.removeItem(`wishlist_${id}`);
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--shop-bg)" }}>
        <div style={{ height: 340, background: "var(--shop-primary-tint)", animation: "pulse 1.5s infinite" }} />
        <div style={{ padding: 16 }}>
          <div style={{ height: 14, width: 80, background: "var(--shop-divider)", borderRadius: 8, marginBottom: 12, animation: "pulse 1.5s infinite" }} />
          <div style={{ height: 22, width: "70%", background: "var(--shop-divider)", borderRadius: 8, marginBottom: 12, animation: "pulse 1.5s infinite" }} />
          <div style={{ height: 30, width: 140, background: "var(--shop-divider)", borderRadius: 8, animation: "pulse 1.5s infinite" }} />
        </div>
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
      </div>
    );
  }

  if (!product) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, background: "var(--shop-bg)" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>😕</div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--shop-black)", marginBottom: 4 }}>Product not found</h2>
        <button onClick={() => router.back()} style={{ marginTop: 16, padding: "12px 28px", background: "var(--shop-primary)", color: "#fff", border: "none", borderRadius: "var(--shop-r-pill)", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
          Go Back
        </button>
      </div>
    );
  }

  const images = (product.images || []).map(img => typeof img === "string" ? img : img.url).filter(Boolean);
  if (!images.length && product.primary_image) images.push(product.primary_image);
  const variantGroups = product.variants || [];
  const priceAdjust = variantGroups.reduce((sum, g) => {
    const opt = g.options.find(o => o.id === selectedOptions[g.id]);
    return sum + (opt?.price_adjust || 0);
  }, 0);
  const price = product.base_price + priceAdjust;
  const comparePrice = product.compare_price || 0;
  const hasDiscount = comparePrice > price;
  const discountPct = hasDiscount ? Math.round(((comparePrice - price) / comparePrice) * 100) : 0;
  // When variants are selected, stock is min of selected option stocks; otherwise product-level
  const variantStock = variantGroups.length > 0
    ? Math.min(...variantGroups.map(g => {
        const opt = g.options.find(o => o.id === selectedOptions[g.id]);
        return opt ? opt.stock_adjust : Infinity;
      }))
    : Infinity;
  const stock = variantGroups.length > 0 && Object.keys(selectedOptions).length === variantGroups.length
    ? variantStock
    : product.stock;
  const inStock = stock > 0;
  const allVariantsChosen = variantGroups.every(g => selectedOptions[g.id]);

  const tabs = ["details", "specs", "reviews"] as const;

  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg)", paddingBottom: inStock ? 100 : 20 }}>
      {/* Image gallery */}
      <div
        style={{ position: "relative", width: "100%", height: 340, background: "var(--shop-primary-tint)", overflow: "hidden" }}
        onTouchStart={onTouchStart}
        onTouchEnd={(e) => onTouchEnd(e, images.length)}
      >
        {images.length > 0 ? (
          <div style={{ display: "flex", height: "100%", transition: "transform 0.35s ease", width: `${images.length * 100}%`, transform: `translateX(-${imgIdx * (100 / images.length)}%)` }}>
            {images.map((src, i) => (
              <img key={i} src={src} alt={`${product.name} ${i + 1}`}
                style={{ width: `${100 / images.length}%`, height: "100%", objectFit: "cover" }} loading={i === 0 ? "eager" : "lazy"} />
            ))}
          </div>
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 72, color: "var(--shop-muted)" }}>
            {product.icon_emoji || product.name[0]?.toUpperCase()}
          </div>
        )}

        {!inStock && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(11,11,15,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ background: "var(--shop-surface)", color: "#E53E3E", fontWeight: 700, fontSize: 14, padding: "8px 24px", borderRadius: "var(--shop-r-pill)" }}>Out of Stock</span>
          </div>
        )}

        {/* Floating back button */}
        <button onClick={() => router.back()} style={{
          position: "absolute", top: 16, left: 16, width: 40, height: 40,
          background: "var(--shop-surface)", borderRadius: "50%", border: "none",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, color: "var(--shop-black)", boxShadow: "var(--shop-shadow)"
        }}>
          ←
        </button>

        {/* Floating wishlist button */}
        <button onClick={toggleWishlist} style={{
          position: "absolute", top: 16, right: 56, width: 40, height: 40,
          background: "var(--shop-surface)", borderRadius: "50%", border: "none",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, boxShadow: "var(--shop-shadow)"
        }}>
          {wishlisted ? "❤️" : "🤍"}
        </button>

        {/* Floating share button */}
        <button onClick={() => {
          if (navigator.share) navigator.share({ title: product.name, url: window.location.href }).catch(() => {});
        }} style={{
          position: "absolute", top: 16, right: 8, width: 40, height: 40,
          background: "var(--shop-surface)", borderRadius: "50%", border: "none",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16, color: "var(--shop-text)", boxShadow: "var(--shop-shadow)"
        }}>
          ↗
        </button>

        {/* Dots */}
        {images.length > 1 && (
          <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6 }}>
            {images.map((_, i) => (
              <button key={i} onClick={() => setImgIdx(i)}
                style={{
                  width: i === imgIdx ? 20 : 8, height: 8, borderRadius: 4,
                  border: "none", cursor: "pointer", transition: "all 0.25s ease",
                  background: i === imgIdx ? "var(--shop-primary)" : "rgba(30,107,255,0.25)"
                }} />
            ))}
          </div>
        )}
      </div>

      {/* Product info card */}
      <div style={{ background: "var(--shop-surface)", padding: 16, marginTop: 0 }}>
        {/* Brand label */}
        {product.merchant_name && (
          <p style={{ fontSize: 12, color: "var(--shop-muted)", fontWeight: 500, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {product.merchant_name}
          </p>
        )}

        {/* Title */}
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--shop-black)", lineHeight: 1.3, margin: 0 }}>
          {product.name}
        </h1>

        {/* Price row */}
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 26, fontWeight: 700, color: "var(--shop-primary)" }}>${price.toFixed(2)}</span>
          {hasDiscount && (
            <>
              <span style={{ fontSize: 15, color: "var(--shop-muted)", textDecoration: "line-through" }}>${comparePrice.toFixed(2)}</span>
              <span style={{
                fontSize: 12, fontWeight: 700, color: "var(--shop-primary)",
                background: "var(--shop-primary-tint)", padding: "3px 10px",
                borderRadius: "var(--shop-r-pill)"
              }}>
                -{discountPct}%
              </span>
            </>
          )}
        </div>

        {/* Rating row */}
        {(product.rating_avg || 0) > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 10 }}>
            <span style={{ fontSize: 14 }}>⭐</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--shop-black)" }}>{(product.rating_avg || 0).toFixed(1)}</span>
            <span style={{ fontSize: 12, color: "var(--shop-muted)", marginLeft: 2 }}>({product.review_count} reviews)</span>
          </div>
        )}

        {/* Stock badge */}
        <div style={{ marginTop: 12 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600,
            padding: "5px 14px", borderRadius: "var(--shop-r-pill)",
            background: inStock ? "#ECFDF5" : "#FEF2F2",
            color: inStock ? "#16A34A" : "#E53E3E"
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
            {inStock ? (stock <= 5 ? `Only ${stock} left` : "In Stock") : "Out of Stock"}
          </span>
        </div>
      </div>

      {/* Variant selectors */}
      {variantGroups.length > 0 && (
        <>
          <div style={{ height: 8, background: "var(--shop-bg)" }} />
          <div style={{ background: "var(--shop-surface)", padding: 16 }}>
            {variantGroups.map(group => {
              const selectedOptionId = selectedOptions[group.id];
              const isColor = group.type === "color";
              return (
                <div key={group.id} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "var(--shop-black)" }}>
                      {group.group_name}
                    </p>
                    {selectedOptionId && (
                      <p style={{ fontSize: 12, color: "var(--shop-muted)" }}>
                        {group.options.find(o => o.id === selectedOptionId)?.label}
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {group.options.map(opt => {
                      const selected = selectedOptionId === opt.id;
                      const oos = (opt.stock_adjust || 0) <= 0;
                      if (isColor) {
                        return (
                          <button
                            key={opt.id}
                            onClick={() => !oos && setSelectedOptions(s => ({ ...s, [group.id]: opt.id }))}
                            disabled={oos}
                            title={`${opt.label}${oos ? " (out of stock)" : ""}`}
                            style={{
                              width: 36, height: 36, borderRadius: "50%",
                              background: opt.hex_color || "#ccc",
                              border: selected ? "3px solid var(--shop-primary)" : (opt.hex_color === "#FFFFFF" || opt.hex_color === "#fff") ? "1px solid var(--shop-divider)" : "1px solid transparent",
                              cursor: oos ? "not-allowed" : "pointer",
                              padding: 0,
                              opacity: oos ? 0.35 : 1,
                              boxShadow: selected ? "0 0 0 2px var(--shop-surface)" : "none",
                              position: "relative",
                            }}
                          >
                            {oos && <span style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%) rotate(45deg)", width: 32, height: 1, background: "var(--shop-muted)" }} />}
                          </button>
                        );
                      }
                      return (
                        <button
                          key={opt.id}
                          onClick={() => !oos && setSelectedOptions(s => ({ ...s, [group.id]: opt.id }))}
                          disabled={oos}
                          style={{
                            minWidth: 48, height: 38, padding: "0 14px",
                            borderRadius: 10,
                            border: selected ? "1.5px solid var(--shop-primary)" : "1.5px solid var(--shop-divider)",
                            background: selected ? "var(--shop-primary-tint)" : "var(--shop-surface)",
                            color: oos ? "var(--shop-muted)" : selected ? "var(--shop-primary)" : "var(--shop-black)",
                            fontWeight: selected ? 700 : 500,
                            fontSize: 13,
                            cursor: oos ? "not-allowed" : "pointer",
                            textDecoration: oos ? "line-through" : "none",
                            opacity: oos ? 0.5 : 1,
                          }}
                        >
                          {opt.label}
                          {opt.price_adjust > 0 && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}>+${opt.price_adjust}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Divider */}
      <div style={{ height: 8, background: "var(--shop-bg)" }} />

      {/* Detail tabs */}
      <div style={{ background: "var(--shop-surface)" }}>
        <div style={{ display: "flex", borderBottom: `1px solid var(--shop-divider)` }}>
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: "14px 0", fontSize: 14, fontWeight: 600,
                background: "none", border: "none", cursor: "pointer",
                color: activeTab === tab ? "var(--shop-primary)" : "var(--shop-muted)",
                borderBottom: activeTab === tab ? "2px solid var(--shop-primary)" : "2px solid transparent",
                transition: "all 0.2s ease",
                textTransform: "capitalize"
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        <div style={{ padding: 16 }}>
          {activeTab === "details" && product.description && (
            <div>
              <p style={{ fontSize: 14, color: "var(--shop-text)", lineHeight: 1.7, whiteSpace: "pre-wrap", margin: 0 }}>
                {expanded || product.description.length <= 150 ? product.description : product.description.substring(0, 150) + "..."}
              </p>
              {product.description.length > 150 && (
                <button onClick={() => setExpanded(!expanded)} style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--shop-primary)", fontSize: 13, fontWeight: 600, marginTop: 8, padding: 0
                }}>
                  {expanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}
          {activeTab === "details" && !product.description && (
            <p style={{ fontSize: 14, color: "var(--shop-muted)", fontStyle: "italic" }}>No description available.</p>
          )}
          {activeTab === "specs" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {product.sku && <SpecRow label="SKU" value={product.sku} />}
              {product.weight && <SpecRow label="Weight" value={product.weight} />}
              {product.delivery_days && <SpecRow label="Delivery" value={`${product.delivery_days}-${product.delivery_days + 2} days`} />}
              <SpecRow label="Payment" value="KHQR, COD" />
              {!product.sku && !product.weight && !product.delivery_days && (
                <p style={{ fontSize: 14, color: "var(--shop-muted)", fontStyle: "italic" }}>No specs available.</p>
              )}
            </div>
          )}
          {activeTab === "reviews" && (
            <div>
              {/* Review list */}
              {reviews.length > 0 ? reviews.map(r => (
                <div key={r.id} style={{
                  padding: "12px 0", borderBottom: "1px solid var(--shop-divider, #ECEEF3)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--shop-black)" }}>
                      {r.user_name || "Anonymous"}
                    </span>
                    <span style={{ fontSize: 12, color: "#D6BA80" }}>
                      {"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}
                    </span>
                  </div>
                  {r.comment && (
                    <p style={{ fontSize: 13, color: "var(--shop-text)", lineHeight: 1.5 }}>{r.comment}</p>
                  )}
                  <p style={{ fontSize: 11, color: "var(--shop-muted)", marginTop: 4 }}>
                    {r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}
                  </p>
                </div>
              )) : (
                <p style={{ fontSize: 13, color: "var(--shop-muted)", marginBottom: 16 }}>No reviews yet. Be the first!</p>
              )}

              {/* Write review form */}
              {user && (
                <div style={{ marginTop: 16, padding: 16, background: "var(--shop-bg, #F7F8FB)", borderRadius: 8 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "var(--shop-black)", marginBottom: 8, fontFamily: "'Kantumruy Pro', sans-serif" }}>
                    Write a Review
                  </p>
                  <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                    {[1, 2, 3, 4, 5].map(s => (
                      <button key={s} onClick={() => setReviewRating(s)} style={{
                        fontSize: 24, background: "none", border: "none", cursor: "pointer",
                        color: s <= reviewRating ? "#D6BA80" : "#D1D5DB",
                      }}>&#9733;</button>
                    ))}
                  </div>
                  <textarea value={reviewComment} onChange={e => setReviewComment(e.target.value)} rows={3}
                    placeholder="Share your experience..."
                    style={{
                      width: "100%", padding: "10px 12px", borderRadius: 8,
                      border: "1px solid var(--shop-divider, #ECEEF3)",
                      background: "var(--shop-surface, #FFFFFF)", color: "var(--shop-black)",
                      fontSize: 13, marginBottom: 12, resize: "vertical",
                    }} />
                  <button onClick={submitReview} disabled={submittingReview}
                    style={{
                      width: "100%", padding: 12, borderRadius: 8,
                      border: "none", background: "#71541A", color: "#FFFFFF",
                      fontWeight: 500, fontSize: 14, cursor: "pointer",
                      fontFamily: "'Kantumruy Pro', sans-serif",
                      opacity: submittingReview ? 0.5 : 1,
                    }}>
                    {submittingReview ? "Submitting..." : "Submit Review"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 8, background: "var(--shop-bg)" }} />

      {/* Quantity stepper section */}
      {inStock && (
        <div style={{ background: "var(--shop-surface)", padding: 16 }}>
          <label style={{ fontSize: 14, fontWeight: 600, color: "var(--shop-black)", display: "block", marginBottom: 12 }}>Quantity</label>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 16 }}>
            <button onClick={() => setQty(Math.max(1, qty - 1))} disabled={qty <= 1}
              style={{
                width: 32, height: 32, borderRadius: "50%",
                border: `1.5px solid var(--shop-divider)`, background: "var(--shop-surface)",
                cursor: qty <= 1 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, color: qty <= 1 ? "var(--shop-divider)" : "var(--shop-text)", transition: "all 0.2s"
              }}>−</button>
            <span style={{ minWidth: 32, textAlign: "center", fontWeight: 700, fontSize: 16, color: "var(--shop-black)" }}>{qty}</span>
            <button onClick={() => setQty(Math.min(stock, qty + 1))} disabled={qty >= stock}
              style={{
                width: 32, height: 32, borderRadius: "50%",
                border: `1.5px solid var(--shop-divider)`, background: "var(--shop-surface)",
                cursor: qty >= stock ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, color: qty >= stock ? "var(--shop-divider)" : "var(--shop-primary)", transition: "all 0.2s"
              }}>+</button>
          </div>
        </div>
      )}

      {/* Sticky bottom bar */}
      {inStock && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 40,
          height: 88, background: "var(--shop-surface)",
          borderTop: `1px solid var(--shop-divider)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "0 16px", paddingBottom: "env(safe-area-inset-bottom)",
          boxSizing: "border-box"
        }}>
          <div style={{ display: "flex", gap: 12, width: "100%", maxWidth: 480 }}>
            {/* Add to cart - outlined */}
            <button onClick={handleAddToCart} disabled={adding || added || !allVariantsChosen}
              style={{
                flex: 1, height: 48, borderRadius: "var(--shop-r-input)",
                border: `1.5px solid var(--shop-primary)`,
                background: added ? "var(--shop-primary-tint)" : "var(--shop-surface)",
                color: "var(--shop-primary)", fontWeight: 600, fontSize: 14,
                cursor: (adding || !allVariantsChosen) ? "not-allowed" : "pointer",
                opacity: (adding || !allVariantsChosen) ? 0.55 : 1, transition: "all 0.2s"
              }}>
              {!allVariantsChosen ? "Choose options" : added ? "✓ Added" : adding ? "Adding..." : "Add to Cart"}
            </button>

            {/* Buy now - primary filled */}
            <button onClick={() => {
              handleAddToCart().then(() => allVariantsChosen && router.push("/shop/cart"));
            }}
              disabled={adding || !allVariantsChosen}
              style={{
                flex: 1, height: 48, borderRadius: "var(--shop-r-input)",
                border: "none",
                background: "var(--shop-primary)",
                color: "#fff", fontWeight: 600, fontSize: 14,
                cursor: (adding || !allVariantsChosen) ? "not-allowed" : "pointer",
                opacity: (adding || !allVariantsChosen) ? 0.55 : 1, transition: "all 0.2s"
              }}>
              Buy Now
            </button>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {added && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 50,
          background: "var(--shop-primary)", color: "#fff",
          padding: "12px 24px", borderRadius: "var(--shop-r-card)",
          fontWeight: 600, fontSize: 14,
          boxShadow: "var(--shop-shadow)",
          animation: "toastIn 0.3s ease"
        }}>
          Added to cart!
        </div>
      )}

      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(-12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
      `}</style>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--shop-divider)" }}>
      <span style={{ fontSize: 13, color: "var(--shop-muted)" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--shop-black)" }}>{value}</span>
    </div>
  );
}
