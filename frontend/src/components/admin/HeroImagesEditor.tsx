"use client";

/**
 * HeroImagesEditor — manages a merchant's hero carousel images.
 * Used in the merchant Edit modal.
 *
 * - Loads existing images via GET /merchants/{id}/hero-images/all
 * - Upload new (max 6 active)
 * - Reorder via up/down buttons
 * - Toggle is_active to hide/show without deleting
 * - Delete permanently
 */

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

const MAX_ACTIVE = 6;

export interface HeroImage {
  id: number;
  merchant_id: number;
  url: string;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
}

interface Props {
  merchantId: number;
  onError?: (msg: string) => void;
}

export function HeroImagesEditor({ merchantId, onError }: Props) {
  const [images, setImages] = useState<HeroImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function flash(msg: string) { onError?.(msg); }

  async function load() {
    setLoading(true);
    try {
      const rows = await api.get<HeroImage[]>(`/merchants/${merchantId}/hero-images/all`);
      setImages([...rows].sort((a, b) => a.sort_order - b.sort_order));
    } catch (e: any) {
      flash(e?.detail || "Failed to load hero images");
    }
    setLoading(false);
  }

  useEffect(() => { if (merchantId) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [merchantId]);

  const activeCount = images.filter(i => i.is_active).length;

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { flash("Image must be under 4 MB"); return; }
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(f.type)) {
      flash("Image must be PNG, JPEG, WebP, or GIF");
      return;
    }
    if (activeCount >= MAX_ACTIVE) {
      flash(`Already at the max of ${MAX_ACTIVE} active images. Hide or delete one first.`);
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api.upload(`/merchants/${merchantId}/hero-images`, fd);
      await load();
    } catch (err: any) {
      flash(err?.detail || "Upload failed");
    }
    setUploading(false);
  }

  async function moveImage(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= images.length) return;
    const a = images[idx], b = images[j];
    // Optimistic swap
    const next = [...images];
    next[idx] = b; next[j] = a;
    setImages(next);
    try {
      await Promise.all([
        api.patch(`/merchants/${merchantId}/hero-images/${a.id}`, { sort_order: b.sort_order }),
        api.patch(`/merchants/${merchantId}/hero-images/${b.id}`, { sort_order: a.sort_order }),
      ]);
      await load();
    } catch (e: any) {
      flash(e?.detail || "Reorder failed");
      load();
    }
  }

  async function toggleActive(img: HeroImage) {
    if (!img.is_active && activeCount >= MAX_ACTIVE) {
      flash(`Already at the max of ${MAX_ACTIVE} active images.`);
      return;
    }
    try {
      await api.patch(`/merchants/${merchantId}/hero-images/${img.id}`, { is_active: !img.is_active });
      await load();
    } catch (e: any) {
      flash(e?.detail || "Update failed");
    }
  }

  async function deleteImage(img: HeroImage) {
    if (!confirm("Delete this hero image permanently?")) return;
    try {
      await api.delete(`/merchants/${merchantId}/hero-images/${img.id}`);
      await load();
    } catch (e: any) {
      flash(e?.detail || "Delete failed");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Hero carousel images</p>
        <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {activeCount}/{MAX_ACTIVE} active · 4:5 portrait or square works best
        </p>
      </div>

      {loading ? (
        <p style={{ fontSize: 12, color: "var(--text-muted)", padding: 12 }}>Loading…</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
          {images.map((img, i) => (
            <div key={img.id} style={{
              position: "relative",
              aspectRatio: "4 / 5",
              borderRadius: 10,
              overflow: "hidden",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              opacity: img.is_active ? 1 : 0.45,
            }}>
              <img src={img.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />

              {/* Position badge */}
              <span style={{
                position: "absolute", top: 4, left: 4,
                background: "rgba(0,0,0,0.65)", color: "#fff",
                fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 6,
              }}>{i + 1}</span>

              {!img.is_active && (
                <span style={{
                  position: "absolute", top: 4, right: 4,
                  background: "rgba(0,0,0,0.65)", color: "#fff",
                  fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 6,
                  textTransform: "uppercase", letterSpacing: 0.5,
                }}>Hidden</span>
              )}

              {/* Bottom toolbar */}
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: 4, gap: 2,
                background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
              }}>
                <div style={{ display: "flex", gap: 2 }}>
                  <button type="button" onClick={() => moveImage(i, -1)} disabled={i === 0}
                    title="Move left" style={iconBtn(i === 0)}>←</button>
                  <button type="button" onClick={() => moveImage(i, 1)} disabled={i === images.length - 1}
                    title="Move right" style={iconBtn(i === images.length - 1)}>→</button>
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  <button type="button" onClick={() => toggleActive(img)} title={img.is_active ? "Hide" : "Show"} style={iconBtn(false)}>
                    {img.is_active ? "👁" : "🚫"}
                  </button>
                  <button type="button" onClick={() => deleteImage(img)} title="Delete" style={iconBtn(false, "#ef4444")}>×</button>
                </div>
              </div>
            </div>
          ))}

          {/* Upload tile */}
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || activeCount >= MAX_ACTIVE}
            style={{
              aspectRatio: "4 / 5",
              borderRadius: 10,
              border: "2px dashed var(--border)",
              background: "var(--bg-secondary)",
              cursor: (uploading || activeCount >= MAX_ACTIVE) ? "not-allowed" : "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
              color: "var(--text-muted)", fontSize: 12, fontWeight: 600,
              opacity: (uploading || activeCount >= MAX_ACTIVE) ? 0.4 : 1,
            }}>
            <span style={{ fontSize: 28 }}>{uploading ? "⏳" : "+"}</span>
            <span>{uploading ? "Uploading…" : activeCount >= MAX_ACTIVE ? "Max reached" : "Add image"}</span>
          </button>

          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleUpload} style={{ display: "none" }} />
        </div>
      )}

      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
        These appear at the top of your shop page in the customer-facing storefront. The first active image shows first.
      </p>
    </div>
  );
}

const iconBtn = (disabled: boolean, color = "#fff"): React.CSSProperties => ({
  width: 22, height: 22, borderRadius: 6,
  border: "none", background: "rgba(255,255,255,0.15)",
  color, fontSize: 12, lineHeight: 1, cursor: disabled ? "not-allowed" : "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  opacity: disabled ? 0.3 : 1, padding: 0,
});
