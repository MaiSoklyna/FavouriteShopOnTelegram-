"use client";

import type { AttributeField, AttributeTemplate, AttributeValue } from "@/types";
import { carryOver, completeness } from "@/lib/attributes";

interface Props {
  templates: AttributeTemplate[];          // the templates this shop may use
  templateId: number;                      // 0 = not chosen
  values: Record<string, AttributeValue>;
  onChange: (templateId: number, values: Record<string, AttributeValue>) => void;
  suggestions?: Record<string, string[]>;  // text fields (Brand): values the shop already used
}

const pill = (on: boolean): React.CSSProperties => ({
  padding: "4px 10px", borderRadius: 14, fontSize: 12, cursor: "pointer",
  border: `1px solid ${on ? "var(--accent, #103562)" : "var(--border)"}`,
  background: on ? "var(--accent, #103562)" : "var(--bg-secondary)", color: on ? "#fff" : "var(--text)",
});
const tag = (bg: string, fg: string): React.CSSProperties => ({ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 8, background: bg, color: fg });

/**
 * The product form's Details section: which kind of product it is (template), then the template's fields
 * with the right control for each type, a completeness score (recommended fields count double), and tags
 * for fields that customers can filter by. Nothing here is required.
 */
export function DetailsEditor({ templates, templateId, values, onChange, suggestions = {} }: Props) {
  const template = templates.find((t) => t.id === templateId) ?? null;
  const score = completeness(template, values);
  const set = (key: string, v: AttributeValue | undefined) => {
    const next = { ...values };
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete next[key]; else next[key] = v;
    onChange(templateId, next);
  };

  if (templates.length === 0) {
    return <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No product detail templates for this shop type yet.</p>;
  }

  const switchTo = (id: number) => {
    const target = templates.find((t) => t.id === id) ?? null;
    const { kept, dropped } = carryOver(target, values);
    if (dropped.length && !window.confirm(`Switching removes ${dropped.length} detail${dropped.length === 1 ? "" : "s"} this kind of product does not have. Continue?`)) return;
    onChange(id, kept);
  };

  return (
    <div data-testid="details-editor" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>This product is</span>
        <select className="admin-input" style={{ maxWidth: 240 }} value={templateId} onChange={(e) => switchTo(+e.target.value)}>
          <option value={0}>Not set</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {template && (
        <>
          <div style={{ marginTop: 12 }} data-testid="details-score">
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: "var(--text)" }}>Details {score.score}% complete</span>
              <span style={{ color: "var(--text-muted)" }}>
                Recommended {score.recommendedFilled}/{score.recommendedTotal} · Optional {score.optionalFilled}/{score.optionalTotal}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "var(--bg-secondary)", overflow: "hidden" }}>
              <div style={{ width: `${score.score}%`, height: "100%", background: score.score >= 80 ? "var(--success)" : score.score >= 40 ? "var(--warning)" : "var(--danger)", transition: "width .2s" }} />
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Nothing here is required. Recommended details count double; details marked &ldquo;Filter&rdquo; help customers find this product.
            </p>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {template.fields.filter((f) => f.is_active !== false).map((f) => (
              <FieldInput key={f.key} field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} suggestions={suggestions[f.key]} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FieldInput({ field, value, onChange, suggestions }: {
  field: AttributeField; value: AttributeValue | undefined; onChange: (v: AttributeValue | undefined) => void; suggestions?: string[];
}) {
  const listId = `sugg-${field.key}`;
  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{field.label}{field.unit ? ` (${field.unit})` : ""}</span>
      {field.importance === "recommended"
        ? <span style={tag("rgba(214,186,128,.25)", "#8A6A2A")}>Recommended</span>
        : <span style={tag("var(--bg-secondary)", "var(--text-muted)")}>Optional</span>}
      {field.filterable && <span style={tag("rgba(59,130,246,.12)", "var(--info, #3B82F6)")} title="Customers can filter by this">Filter</span>}
    </div>
  );
  const help = field.help_text ? <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{field.help_text}</p> : null;

  if (field.type === "text") {
    return (
      <div>{header}
        <input className="admin-input" maxLength={120} list={suggestions?.length ? listId : undefined} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
        {suggestions?.length ? <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist> : null}
        {help}
      </div>
    );
  }
  if (field.type === "number") {
    return (
      <div>{header}
        <input className="admin-input" type="number" min={field.min_value ?? 0} max={field.max_value ?? undefined} step="any" style={{ maxWidth: 180 }}
          value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
        {help}
      </div>
    );
  }
  if (field.type === "boolean") {
    const current = value === true ? "yes" : value === false ? "no" : "";
    return (
      <div>{header}
        <div style={{ display: "flex", gap: 6 }}>
          {([["yes", "Yes"], ["no", "No"], ["", "Not specified"]] as const).map(([k, label]) => (
            <button key={k || "unset"} type="button" style={pill(current === k)} onClick={() => onChange(k === "yes" ? true : k === "no" ? false : undefined)}>{label}</button>
          ))}
        </div>
        {help}
      </div>
    );
  }
  // select / multi_select: pills
  const chosen = field.type === "multi_select" ? ((value as string[]) ?? []) : value ? [value as string] : [];
  const toggle = (v: string) => {
    if (field.type === "select") onChange(chosen.includes(v) ? undefined : v);
    else onChange(chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]);
  };
  return (
    <div>{header}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {field.options.map((o) => <button key={o.value} type="button" style={pill(chosen.includes(o.value))} onClick={() => toggle(o.value)}>{o.label}</button>)}
      </div>
      {field.type === "multi_select" && <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Choose all that apply.</p>}
      {help}
    </div>
  );
}
