"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Category } from "@/types";

export default function CategoriesPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Category[]>("/categories")
      .then(setCategories)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sorted = [...categories].sort((a, b) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );

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
            All Categories
          </span>
        </div>
      </div>

      <div style={{ padding: "16px 20px 80px" }}>
        {loading ? (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12,
          }}>
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} style={{
                height: 110, background: "var(--shop-surface)",
                borderRadius: 8, animation: "pulse 1.5s infinite",
              }} />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{
              width: 64, height: 64, borderRadius: "50%", background: "var(--shop-surface)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--shop-primary)" strokeWidth="1.5">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
            </div>
            <h3 style={{
              fontSize: 16, fontWeight: 500, color: "var(--shop-text)",
              fontFamily: "'Kantumruy Pro', sans-serif",
            }}>
              No categories yet
            </h3>
          </div>
        ) : (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12,
          }}>
            {sorted.map(cat => (
              <Link
                key={cat.id}
                href={`/shop/category/${cat.id}`}
                className="shop-press"
                style={{
                  display: "flex", flexDirection: "column",
                  alignItems: "center",
                  padding: "16px 8px 12px",
                  background: "var(--shop-surface)",
                  borderRadius: 8,
                  textDecoration: "none",
                  boxShadow: "0 2px 8px rgba(8, 29, 60, 0.06)",
                }}
              >
                <div style={{
                  width: 56, height: 56, borderRadius: 8,
                  background: "var(--shop-divider)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  overflow: "hidden", marginBottom: 8,
                }}>
                  {(cat.image_url || (cat.icon_emoji && /^https?:\/\//i.test(cat.icon_emoji))) ? (
                    <img src={cat.image_url || cat.icon_emoji!} alt={cat.name}
                      style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  ) : cat.icon_emoji ? (
                    <span style={{ fontSize: 28, lineHeight: 1 }}>{cat.icon_emoji}</span>
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--shop-muted)" strokeWidth="1.5">
                      <rect x="3" y="3" width="7" height="7" />
                      <rect x="14" y="3" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" />
                    </svg>
                  )}
                </div>
                <span style={{
                  fontSize: 12, fontWeight: 500, color: "var(--shop-text)",
                  fontFamily: "'Kantumruy Pro', sans-serif",
                  textAlign: "center", lineHeight: "14px",
                  overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap", width: "100%",
                }}>
                  {cat.name}
                </span>
                {(cat.product_count ?? 0) > 0 && (
                  <span style={{
                    fontSize: 10, color: "var(--shop-muted)", marginTop: 2,
                    fontFamily: "'Inter', sans-serif",
                  }}>
                    {cat.product_count} items
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}
