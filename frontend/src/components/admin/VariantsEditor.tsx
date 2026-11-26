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

// ── First option group presets, by kind of shop ───────────────
// The first group is stored as type "size", but its name follows what the shop sells: clothes have
// sizes, skincare has a volume or who it is for, cakes have a cake size, phones have storage.
export type ShopKind = "fashion" | "beauty" | "food" | "electronics" | "home";
type Preset = { id: string; menu: string; group: string; labels: string[] };
type SizeScale = "none" | "custom" | string;

const PRESETS: Record<ShopKind, Preset[]> = {
  fashion: [
    { id: "women", menu: "Women (XS–XXL)", group: "Size", labels: ["XS", "S", "M", "L", "XL", "XXL"] },
    { id: "men", menu: "Men (S–3XL)", group: "Size", labels: ["S", "M", "L", "XL", "XXL", "3XL"] },
    { id: "kids", menu: "Kids (2y–12y)", group: "Size", labels: ["2y", "3y", "4y", "6y", "8y", "10y", "12y"] },
    { id: "baby", menu: "Baby (0–24m)", group: "Size", labels: ["0–3m", "3–6m", "6–9m", "9–12m", "12–18m", "18–24m"] },
    { id: "shoes", menu: "Shoes (EU 35–42)", group: "Size", labels: ["35", "36", "37", "38", "39", "40", "41", "42"] },
    { id: "free", menu: "Free size", group: "Size", labels: ["Free size"] },
  ],
  beauty: [
    { id: "ml", menu: "Volume (ml)", group: "Volume", labels: ["15ml", "30ml", "50ml", "100ml", "150ml", "200ml"] },
    { id: "g", menu: "Weight (g)", group: "Weight", labels: ["10g", "30g", "50g", "100g", "200g"] },
    // Who it is for (Women / Men) and age group are product details on the Skincare template, not options
  ],
  food: [
    { id: "cake", menu: "Cake size (inch)", group: "Size", labels: ['4"', '6"', '8"', '10"'] },
    { id: "portion", menu: "Portion (S / M / L)", group: "Portion", labels: ["Small", "Medium", "Large"] },
    { id: "cup", menu: "Cup size", group: "Cup", labels: ["Small", "Medium", "Large"] },
  ],
  electronics: [
    { id: "storage", menu: "Storage", group: "Storage", labels: ["64GB", "128GB", "256GB", "512GB", "1TB"] },
    { id: "ram", menu: "Memory (RAM)", group: "Memory", labels: ["8GB", "16GB", "32GB"] },
  ],
  home: [
    { id: "sml", menu: "Small / Medium / Large", group: "Size", labels: ["Small", "Medium", "Large"] },
  ],
};
const KIND_LABEL: Record<ShopKind, string> = {
  fashion: "Clothes & shoes", beauty: "Beauty & skincare", food: "Food & drinks", electronics: "Electronics", home: "Home",
};
const ALL_PRESETS = Object.values(PRESETS).flat();

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
  /** The shop's kind: only its presets are offered. Unknown (e.g. super admin, no shop yet): all, grouped. */
  kind?: ShopKind | null;
}

export function VariantsEditor({ value, onChange, kind }: Props) {
  const sizeGroup = useMemo(() => value.find(g => g.type === "size") || null, [value]);
  const colorGroup = useMemo(() => value.find(g => g.type === "color") || null, [value]);

  function setGroup(type: "size" | "color", group: VariantGroup | null) {
    const others = value.filter(g => g.type !== type);
    onChange(group ? [...others, group] : others);
  }

  function detectScale(g: VariantGroup | null): SizeScale {
    if (!g) return "none";
    const labels = g.options.map(o => o.label);
    const preset = ALL_PRESETS.find(p => p.group === g.group_name && p.labels.length === labels.length && p.labels.every(l => labels.includes(l)));
    return preset ? preset.id : "custom";
  }

  const offered = kind ? PRESETS[kind] : ALL_PRESETS;
  const detected: SizeScale = detectScale(sizeGroup);
  // A preset from another kind of shop (older products) shows as Custom: its rows stay as they are
  const currentScale: SizeScale = detected === "none" || detected === "custom" || offered.some(p => p.id === detected) ? detected : "custom";

  function applySizeScale(scale: SizeScale) {
    if (scale === "none") {
      setGroup("size", null);
      return;
    }
    if (scale === "custom") {
      // Empty group, user names it and adds rows
      setGroup("size", { group_name: sizeGroup?.group_name || "Size", type: "size", sort_order: 0, options: [] });
      return;
    }
    const preset = ALL_PRESETS.find(p => p.id === scale);
    if (!preset) return;
    const labels = preset.labels;
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
    setGroup("size", { group_name: preset.group, type: "size", sort_order: 0, options });
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
          {sizeGroup ? (
            <input className="admin-input" aria-label="Option name" value={sizeGroup.group_name} maxLength={30}
              onChange={e => setGroup("size", { ...sizeGroup, group_name: e.target.value })}
              style={{ maxWidth: 150, fontSize: 13, fontWeight: 700, padding: "4px 8px" }} />
          ) : (
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{kind ? PRESETS[kind][0].group : "Size"} options</p>
          )}
          <select className="admin-input" style={{ maxWidth: 210, fontSize: 12, padding: "4px 8px" }} value={currentScale} onChange={e => applySizeScale(e.target.value as SizeScale)} data-testid="size-preset">
            <option value="none">No options</option>
            {kind
              ? PRESETS[kind].map(p => <option key={p.id} value={p.id}>{p.menu}</option>)
              : (Object.keys(PRESETS) as ShopKind[]).map(k => (
                <optgroup key={k} label={KIND_LABEL[k]}>
                  {PRESETS[k].map(p => <option key={p.id} value={p.id}>{p.menu}</option>)}
                </optgroup>
              ))}
            <option value="custom">Custom (type your own)</option>
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
