"use client";

/**
 * VariantsEditor — used inside the admin product modal to edit
 * size and color groups for a product.
 *
 * Output shape matches the backend `VariantGroupCreate` model:
 *   {
 *     group_name: "Size" | "Color",
 *     type: "size" | "color",
 *     sort_order: number,
 *     options: [{ label, hex_color?, price_adjust, stock_adjust, is_popular, sort_order }]
 *   }
 */

import { useMemo } from "react";

export type VariantOption = {
  label: string;
  hex_color?: string | null;
  price_adjust: number;
  stock_adjust: number; // used as absolute stock for that option in v1
  is_popular: boolean;
  sort_order: number;
};

export type VariantGroup = {
  group_name: string;
  type: "size" | "color" | "weight" | "custom";
  sort_order: number;
  options: VariantOption[];
};

// ── Size scale presets ─────────────────────────────────────────
type SizeScale = "none" | "women" | "kids" | "baby" | "shoes" | "custom";

const SIZE_PRESETS: Record<Exclude<SizeScale, "none" | "custom">, string[]> = {
  women: ["XS", "S", "M", "L", "XL", "XXL"],
  kids: ["2y", "3y", "4y", "6y", "8y", "10y", "12y"],
  baby: ["0–3m", "3–6m", "6–9m", "9–12m", "12–18m", "18–24m"],
  shoes: ["35", "36", "37", "38", "39", "40", "41", "42"],
};

// ── Color palette ──────────────────────────────────────────────
const COLOR_PALETTE: { label: string; hex: string }[] = [
  { label: "Black", hex: "#000000" },
  { label: "White", hex: "#FFFFFF" },
  { label: "Beige", hex: "#E8DCC4" },
  { label: "Pink", hex: "#F472B6" },
  { label: "Red", hex: "#EF4444" },
  { label: "Coral", hex: "#FB7185" },
  { label: "Yellow", hex: "#FACC15" },
  { label: "Mint", hex: "#86EFAC" },
  { label: "Sage", hex: "#A7C4A0" },
  { label: "Sky", hex: "#7DD3FC" },
  { label: "Navy", hex: "#1E3A8A" },
  { label: "Lavender", hex: "#A78BFA" },
  { label: "Brown", hex: "#A16207" },
  { label: "Grey", hex: "#9CA3AF" },
];

// ── Component ──────────────────────────────────────────────────

interface Props {
  value: VariantGroup[];
  onChange: (next: VariantGroup[]) => void;
}

export function VariantsEditor({ value, onChange }: Props) {
  const sizeGroup = useMemo(() => value.find(g => g.type === "size") || null, [value]);
  const colorGroup = useMemo(() => value.find(g => g.type === "color") || null, [value]);

  function setGroup(type: "size" | "color", group: VariantGroup | null) {
    const others = value.filter(g => g.type !== type);
    onChange(group ? [...others, group] : others);
  }

  function detectScale(g: VariantGroup | null): SizeScale {
    if (!g) return "none";
    const labels = g.options.map(o => o.label);
    for (const [key, preset] of Object.entries(SIZE_PRESETS)) {
      if (preset.length === labels.length && preset.every(l => labels.includes(l))) {
        return key as SizeScale;
      }
    }
    return "custom";
  }

  const currentScale: SizeScale = detectScale(sizeGroup);

  function applySizeScale(scale: SizeScale) {
    if (scale === "none") {
      setGroup("size", null);
      return;
    }
    if (scale === "custom") {
      // Empty group, user adds rows manually
      setGroup("size", { group_name: "Size", type: "size", sort_order: 0, options: [] });
      return;
    }
    const labels = SIZE_PRESETS[scale];
    const existing = sizeGroup?.options || [];
    const options: VariantOption[] = labels.map((label, i) => {
      const prev = existing.find(o => o.label === label);
      return prev ?? {
        label,
        price_adjust: 0,
        stock_adjust: 0,
        is_popular: false,
        sort_order: i,
      };
    });
    setGroup("size", { group_name: "Size", type: "size", sort_order: 0, options });
  }

  function updateSizeOption(idx: number, patch: Partial<VariantOption>) {
    if (!sizeGroup) return;
    const next = sizeGroup.options.map((o, i) => i === idx ? { ...o, ...patch } : o);
    setGroup("size", { ...sizeGroup, options: next });
  }

  function addCustomSize() {
    if (!sizeGroup) return;
    setGroup("size", {
      ...sizeGroup,
      options: [...sizeGroup.options, { label: "", price_adjust: 0, stock_adjust: 0, is_popular: false, sort_order: sizeGroup.options.length }],
    });
  }

  function removeSizeOption(idx: number) {
    if (!sizeGroup) return;
    setGroup("size", { ...sizeGroup, options: sizeGroup.options.filter((_, i) => i !== idx) });
  }

  // Colors
  function toggleColor(label: string, hex: string) {
    const current = colorGroup?.options || [];
    const existing = current.find(o => o.label === label);
    if (existing) {
      const next = current.filter(o => o.label !== label);
      if (next.length === 0) { setGroup("color", null); return; }
      setGroup("color", { group_name: "Color", type: "color", sort_order: 1, options: next });
    } else {
      const opt: VariantOption = { label, hex_color: hex, price_adjust: 0, stock_adjust: 0, is_popular: false, sort_order: current.length };
      setGroup("color", { group_name: "Color", type: "color", sort_order: 1, options: [...current, opt] });
    }
  }

  function updateColorOption(idx: number, patch: Partial<VariantOption>) {
    if (!colorGroup) return;
    const next = colorGroup.options.map((o, i) => i === idx ? { ...o, ...patch } : o);
    setGroup("color", { ...colorGroup, options: next });
  }

  function addCustomColor() {
    const current = colorGroup?.options || [];
    const opt: VariantOption = { label: "Custom", hex_color: "#888888", price_adjust: 0, stock_adjust: 0, is_popular: false, sort_order: current.length };
    setGroup("color", { group_name: "Color", type: "color", sort_order: 1, options: [...current, opt] });
  }

  function removeColorOption(idx: number) {
    if (!colorGroup) return;
    const next = colorGroup.options.filter((_, i) => i !== idx);
    if (next.length === 0) { setGroup("color", null); return; }
    setGroup("color", { ...colorGroup, options: next });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Sizes ── */}
      <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Sizes</p>
          <select className="admin-input" style={{ maxWidth: 180, fontSize: 12, padding: "4px 8px" }} value={currentScale} onChange={e => applySizeScale(e.target.value as SizeScale)}>
            <option value="none">No size variants</option>
            <option value="women">Women (XS–XXL)</option>
            <option value="kids">Kids (2y–12y)</option>
            <option value="baby">Baby (0–24m)</option>
            <option value="shoes">Shoes (EU 35–42)</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        {sizeGroup && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={gridHeader}>
              <span>Label</span>
              <span>Stock</span>
              <span>Price +$</span>
              <span style={{ textAlign: "center" }}>Popular</span>
              <span></span>
            </div>
            {sizeGroup.options.map((o, i) => (
              <div key={i} style={gridRow}>
                <input className="admin-input" style={inputSm} value={o.label} onChange={e => updateSizeOption(i, { label: e.target.value })} placeholder="Label" />
                <input type="number" className="admin-input" style={inputSm} value={o.stock_adjust || ""} onChange={e => updateSizeOption(i, { stock_adjust: +e.target.value })} placeholder="0" />
                <input type="number" step="0.01" className="admin-input" style={inputSm} value={o.price_adjust || ""} onChange={e => updateSizeOption(i, { price_adjust: +e.target.value })} placeholder="0.00" />
                <input type="checkbox" checked={o.is_popular} onChange={e => updateSizeOption(i, { is_popular: e.target.checked })} style={{ justifySelf: "center" }} />
                <button type="button" onClick={() => removeSizeOption(i)} style={removeBtn}>×</button>
              </div>
            ))}
            {currentScale === "custom" && (
              <button type="button" className="btn-outline" style={{ alignSelf: "flex-start", marginTop: 4, fontSize: 12 }} onClick={addCustomSize}>+ Add size</button>
            )}
          </div>
        )}
      </section>

      {/* ── Colors ── */}
      <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Colors</p>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Tap a swatch to add or remove</span>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {COLOR_PALETTE.map(c => {
            const selected = (colorGroup?.options || []).some(o => o.label === c.label);
            return (
              <button key={c.label} type="button" onClick={() => toggleColor(c.label, c.hex)} title={c.label}
                style={{
                  width: 30, height: 30, borderRadius: "50%", background: c.hex,
                  border: selected ? "3px solid var(--accent, #6366f1)" : c.hex === "#FFFFFF" ? "1px solid var(--border)" : "1px solid transparent",
                  cursor: "pointer", padding: 0,
                  boxShadow: selected ? "0 0 0 2px var(--bg)" : "none",
                }}
              />
            );
          })}
          <button type="button" className="btn-outline" style={{ fontSize: 12, padding: "4px 10px" }} onClick={addCustomColor}>+ Custom</button>
        </div>

        {colorGroup && colorGroup.options.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={colorGridHeader}>
              <span>Color</span>
              <span>Label</span>
              <span>Hex</span>
              <span>Stock</span>
              <span></span>
            </div>
            {colorGroup.options.map((o, i) => (
              <div key={i} style={colorGridRow}>
                <input type="color" value={o.hex_color || "#888888"} onChange={e => updateColorOption(i, { hex_color: e.target.value })} style={{ width: 28, height: 28, border: "none", borderRadius: 6, cursor: "pointer", padding: 0 }} />
                <input className="admin-input" style={inputSm} value={o.label} onChange={e => updateColorOption(i, { label: e.target.value })} />
                <input className="admin-input" style={{ ...inputSm, fontFamily: "monospace", fontSize: 11 }} value={o.hex_color || ""} onChange={e => updateColorOption(i, { hex_color: e.target.value })} maxLength={7} />
                <input type="number" className="admin-input" style={inputSm} value={o.stock_adjust || ""} onChange={e => updateColorOption(i, { stock_adjust: +e.target.value })} placeholder="0" />
                <button type="button" onClick={() => removeColorOption(i)} style={removeBtn}>×</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
        For clothing, color rarely affects price — leave “Price +$” at 0 unless larger sizes (XXL, 12y) cost more.
      </p>
    </div>
  );
}

const gridHeader: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.5fr 1fr 1fr 70px 24px",
  gap: 6,
  fontSize: 10,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
};

const gridRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.5fr 1fr 1fr 70px 24px",
  gap: 6,
  alignItems: "center",
};

const colorGridHeader: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "32px 1.3fr 1fr 1fr 24px",
  gap: 6,
  fontSize: 10,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
};

const colorGridRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "32px 1.3fr 1fr 1fr 24px",
  gap: 6,
  alignItems: "center",
};

const inputSm: React.CSSProperties = {
  fontSize: 12,
  padding: "6px 8px",
  height: 32,
};

const removeBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--danger)",
  fontSize: 18,
  lineHeight: 1,
  padding: 0,
};
