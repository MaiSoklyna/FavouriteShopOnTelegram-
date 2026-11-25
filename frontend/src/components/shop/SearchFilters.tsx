"use client";

import { useEffect, useState } from "react";
import type { SearchFacet } from "@/types";

/** What the customer has chosen, as kept in the page URL. */
export interface SearchFilterState {
  type: string;    // shop type id ("" = all)
  sort: string;    // relevance | price_asc | price_desc | newest | rating
  min: string;     // price
  max: string;
  stock: boolean;  // in stock only
  attrs: Record<string, { values?: string[]; min?: string; max?: string }>;
}

export const EMPTY_FILTERS: SearchFilterState = { type: "", sort: "relevance", min: "", max: "", stock: false, attrs: {} };

export const SORTS: [string, string][] = [
  ["relevance", "Best match"], ["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"],
  ["newest", "Newest"], ["rating", "Top rated"],
];

export function filtersFromUrl(sp: URLSearchParams): SearchFilterState {
  const attrs: SearchFilterState["attrs"] = {};
  sp.forEach((v, k) => {
    if (!k.startsWith("a.") || !v) return;
    const [key, part] = k.slice(2).split(".");
    const a = (attrs[key] ||= {});
    if (part === "min" || part === "max") a[part] = v;
    else a.values = v.split(",").filter(Boolean);
  });
  return {
    type: sp.get("type") || "", sort: sp.get("sort") || "relevance", min: sp.get("min") || "", max: sp.get("max") || "",
    stock: sp.get("stock") === "1", attrs,
  };
}

/** The filters as URL / API parameters (the page URL and the API use the same names except price and stock). */
export function filterParams(f: SearchFilterState, forApi: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.type) out[forApi ? "shop_type" : "type"] = f.type;
  if (f.sort && f.sort !== "relevance") out.sort = f.sort;
  if (f.min) out[forApi ? "min_price" : "min"] = f.min;
  if (f.max) out[forApi ? "max_price" : "max"] = f.max;
  if (f.stock) out[forApi ? "in_stock" : "stock"] = forApi ? "true" : "1";
  for (const [key, a] of Object.entries(f.attrs)) {
    if (a.values?.length) out[`a.${key}`] = a.values.join(",");
    if (a.min) out[`a.${key}.min`] = a.min;
    if (a.max) out[`a.${key}.max`] = a.max;
  }
  return out;
}

export function activeFilterCount(f: SearchFilterState): number {
  let n = (f.min || f.max ? 1 : 0) + (f.stock ? 1 : 0);
  for (const a of Object.values(f.attrs)) n += (a.values?.length ? 1 : 0) + (a.min || a.max ? 1 : 0);
  return n;
}

const chip = (on: boolean): React.CSSProperties => ({
  padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: on ? 600 : 500, cursor: "pointer", whiteSpace: "nowrap",
  border: on ? "1px solid var(--shop-primary)" : "1px solid var(--shop-divider)",
  background: on ? "var(--shop-primary)" : "var(--shop-surface)", color: on ? "#FFFFFF" : "var(--shop-text)",
});
const input: React.CSSProperties = {
  width: "100%", height: 38, borderRadius: 10, border: "1px solid var(--shop-divider)", padding: "0 10px",
  fontSize: 14, background: "var(--shop-surface)", color: "var(--shop-text)",
};
const h4: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--shop-text)", marginBottom: 8 };

/**
 * The filter sheet: price, in stock, and the product-detail filters (facets) of the chosen shop type,
 * each option with how many products match. Changes apply when the customer taps "Show results".
 */
export function SearchFilterSheet({ open, onClose, value, onApply, facets, total, typeChosen }: {
  open: boolean; onClose: () => void; value: SearchFilterState; onApply: (f: SearchFilterState) => void;
  facets: SearchFacet[]; total: number; typeChosen: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (open) setDraft(value); }, [open, value]);
  if (!open) return null;

  const setAttr = (key: string, patch: { values?: string[]; min?: string; max?: string }) =>
    setDraft((d) => ({ ...d, attrs: { ...d.attrs, [key]: { ...d.attrs[key], ...patch } } }));
  const toggleValue = (key: string, v: string) => {
    const now = draft.attrs[key]?.values ?? [];
    setAttr(key, { values: now.includes(v) ? now.filter((x) => x !== v) : [...now, v] });
  };

  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label="Filters"
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} data-testid="filter-sheet"
        style={{ width: "100%", maxHeight: "85vh", overflowY: "auto", background: "var(--shop-bg)", borderRadius: "20px 20px 0 0", padding: "16px 20px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--shop-text)" }}>Filters</span>
          <button onClick={() => setDraft({ ...EMPTY_FILTERS, type: draft.type, sort: draft.sort })}
            style={{ background: "none", border: "none", color: "var(--shop-primary)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Clear all</button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={h4}>Price ($)</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input style={input} inputMode="decimal" placeholder="Min" value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value.replace(/[^\d.]/g, "") })} />
            <span style={{ color: "var(--shop-muted)" }}>–</span>
            <input style={input} inputMode="decimal" placeholder="Max" value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value.replace(/[^\d.]/g, "") })} />
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, fontSize: 14, color: "var(--shop-text)" }}>
          In stock only
          <input type="checkbox" checked={draft.stock} onChange={(e) => setDraft({ ...draft, stock: e.target.checked })} style={{ width: 20, height: 20 }} />
        </label>

        {!typeChosen ? (
          <p style={{ fontSize: 12, color: "var(--shop-muted)", marginBottom: 12 }}>Choose a kind of shop (Fashion, Electronics…) to filter by product details such as size, brand or skin type.</p>
        ) : facets.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--shop-muted)", marginBottom: 12 }}>No product details to filter by yet for these results.</p>
        ) : facets.map((f) => (
          <div key={f.key} style={{ marginBottom: 16 }} data-testid={`facet-${f.key}`}>
            <div style={h4}>{f.label}{f.unit ? ` (${f.unit})` : ""}</div>
            {(f.type === "select" || f.type === "multi_select" || f.type === "text") && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {f.options!.map((o) => {
                  const on = (draft.attrs[f.key]?.values ?? []).some((v) => v.toLowerCase() === o.value.toLowerCase());
                  return <button key={o.value} style={chip(on)} onClick={() => toggleValue(f.key, o.value)}>{o.label} <span style={{ opacity: 0.7 }}>{o.count}</span></button>;
                })}
              </div>
            )}
            {f.type === "number" && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input style={input} inputMode="decimal" placeholder={f.min != null ? `From ${f.min}` : "Min"} value={draft.attrs[f.key]?.min ?? ""} onChange={(e) => setAttr(f.key, { min: e.target.value.replace(/[^\d.]/g, "") })} />
                <span style={{ color: "var(--shop-muted)" }}>–</span>
                <input style={input} inputMode="decimal" placeholder={f.max != null ? `To ${f.max}` : "Max"} value={draft.attrs[f.key]?.max ?? ""} onChange={(e) => setAttr(f.key, { max: e.target.value.replace(/[^\d.]/g, "") })} />
              </div>
            )}
            {f.type === "boolean" && (
              <button style={chip((draft.attrs[f.key]?.values ?? []).includes("true"))}
                onClick={() => setAttr(f.key, { values: (draft.attrs[f.key]?.values ?? []).includes("true") ? [] : ["true"] })}>
                Yes only <span style={{ opacity: 0.7 }}>{f.count}</span>
              </button>
            )}
            {f.help_text && <p style={{ fontSize: 11, color: "var(--shop-muted)", marginTop: 4 }}>{f.help_text}</p>}
          </div>
        ))}
        {typeChosen && facets.length > 0 && <p style={{ fontSize: 11, color: "var(--shop-muted)", marginBottom: 12 }}>Products without a detail filled in are left out when you filter by it.</p>}

        <button onClick={() => { onApply(draft); onClose(); }} data-testid="apply-filters"
          style={{ width: "100%", height: 46, borderRadius: 12, border: "none", background: "var(--shop-primary)", color: "#FFFFFF", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
          Show results{draft === value ? ` (${total})` : ""}
        </button>
      </div>
    </div>
  );
}
