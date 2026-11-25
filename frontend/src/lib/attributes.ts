import type { AttributeField, AttributeTemplate, AttributeValue } from "@/types";

/** Is a detail left empty? (same rule as the backend) */
export function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);
}

export interface Completeness {
  recommendedFilled: number;
  recommendedTotal: number;
  optionalFilled: number;
  optionalTotal: number;
  score: number; // 0-100; recommended fields weigh 2, optional fields 1 (same as the backend)
}

export function completeness(template: AttributeTemplate | null | undefined, values: Record<string, unknown> | null | undefined): Completeness {
  const fields = (template?.fields ?? []).filter((f) => f.is_active !== false);
  const v = values ?? {};
  const rec = fields.filter((f) => f.importance === "recommended");
  const opt = fields.filter((f) => f.importance !== "recommended");
  const recDone = rec.filter((f) => !isEmpty(v[f.key])).length;
  const optDone = opt.filter((f) => !isEmpty(v[f.key])).length;
  const total = 2 * rec.length + opt.length;
  return {
    recommendedFilled: recDone, recommendedTotal: rec.length,
    optionalFilled: optDone, optionalTotal: opt.length,
    score: total ? Math.round((100 * (2 * recDone + optDone)) / total) : 0,
  };
}

/** Values the other template also has (same key); the rest would be dropped by a switch. */
export function carryOver(template: AttributeTemplate | null | undefined, values: Record<string, AttributeValue>) {
  const keys = new Set((template?.fields ?? []).map((f) => f.key));
  const kept: Record<string, AttributeValue> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (isEmpty(v)) continue;
    if (keys.has(k)) kept[k] = v; else dropped.push(k);
  }
  return { kept, dropped };
}

/** Only filled values, ready to send. */
export function filled(values: Record<string, AttributeValue>): Record<string, AttributeValue> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => !isEmpty(v)));
}

export function showValue(field: AttributeField, v: AttributeValue): string {
  if (field.type === "boolean") return v ? "Yes" : "No";
  if (field.type === "select" || field.type === "multi_select") {
    const labels = new Map(field.options.map((o) => [o.value, o.label]));
    return (Array.isArray(v) ? v : [String(v)]).map((x) => labels.get(x) ?? x).join(", ");
  }
  if (field.type === "number" && field.unit) return `${v} ${field.unit}`;
  return String(v);
}
