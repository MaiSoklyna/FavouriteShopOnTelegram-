"use client";

import { useCallback, useState, type ReactNode } from "react";

// ── Status pill ────────────────────────────────────────────────

const TONES = {
  neutral: "bg-bg-secondary text-text-muted",
  info: "bg-[var(--info-light)] text-info",
  warning: "bg-[var(--warning-light)] text-warning",
  success: "bg-[var(--success-light)] text-success",
  danger: "bg-[var(--danger-light)] text-danger",
} as const;

type Tone = keyof typeof TONES;

const STATUS_TONE: Record<string, Tone> = {
  // earnings
  pending: "warning",
  ready: "info",
  paid: "success",
  failed: "danger",
  reversed: "neutral",
  // payouts
  processing: "info",
  cancelled: "neutral",
  // verification
  unverified: "neutral",
  verified: "success",
  rejected: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  ready: "Available",
  pending: "Pending",
  unverified: "Not set up",
};

export function StatusPill({ status, label, tone }: { status: string; label?: string; tone?: Tone }) {
  const t = tone ?? STATUS_TONE[status] ?? "neutral";
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${TONES[t]}`}>
      {label ?? STATUS_LABEL[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

// ── Cards ──────────────────────────────────────────────────────

export function Panel({ title, subtitle, actions, children, className = "" }: {
  title?: string; subtitle?: string; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-bg-card shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            {title && <h2 className="font-heading text-[15px] font-bold text-text">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function SummaryCard({ label, value, hint, tone = "default" }: {
  label: string; value: string; hint?: string; tone?: "default" | "primary" | "success" | "warning";
}) {
  const valueColor = {
    default: "text-text",
    primary: "text-accent",
    success: "text-success",
    warning: "text-warning",
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`mt-2 font-heading text-2xl font-bold tabular-nums ${valueColor}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-text-muted">{hint}</div>}
    </div>
  );
}

// ── Tabs ───────────────────────────────────────────────────────

export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (key: T) => void;
}) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 font-heading text-[13px] font-semibold transition-colors ${
              active ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={`rounded-full px-1.5 text-[10px] ${active ? "bg-accent text-bg" : "bg-bg-secondary text-text-muted"}`}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Table ──────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
}

export function Table<T>({ columns, rows, rowKey, loading, empty, onRowClick }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  empty?: string;
  onRowClick?: (row: T) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`whitespace-nowrap border-b border-border px-3 py-2.5 font-heading text-[11px] font-semibold uppercase tracking-wide text-text-muted ${
                  c.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className="border-b border-border px-3 py-3">
                    <div className="h-3.5 w-full max-w-[120px] animate-pulse rounded bg-bg-secondary" />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-text-muted">
                {empty ?? "Nothing here yet."}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`${onRowClick ? "cursor-pointer" : ""} hover:bg-bg-hover`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`border-b border-border px-3 py-2.5 text-text ${c.align === "right" ? "text-right tabular-nums" : ""} ${c.className ?? ""}`}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, hasMore, onChange }: { page: number; hasMore: boolean; onChange: (p: number) => void }) {
  if (page === 1 && !hasMore) return null;
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-3 text-xs text-text-muted">
      <span>Page {page}</span>
      <button className={BTN.outlineSm} disabled={page === 1} onClick={() => onChange(page - 1)}>Prev</button>
      <button className={BTN.outlineSm} disabled={!hasMore} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  );
}

// ── Buttons & inputs (class strings) ───────────────────────────

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-heading font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50";

export const BTN = {
  primary: `${base} bg-accent px-4 py-2 text-[13px] text-bg hover:opacity-90`,
  primarySm: `${base} bg-accent px-3 py-1.5 text-xs text-bg hover:opacity-90`,
  outline: `${base} border border-border bg-transparent px-4 py-2 text-[13px] text-text hover:bg-bg-hover`,
  outlineSm: `${base} border border-border bg-transparent px-3 py-1.5 text-xs text-text hover:bg-bg-hover`,
  danger: `${base} bg-danger px-4 py-2 text-[13px] text-white hover:opacity-90`,
  dangerSm: `${base} bg-danger px-3 py-1.5 text-xs text-white hover:opacity-90`,
  success: `${base} bg-success px-4 py-2 text-[13px] text-white hover:opacity-90`,
  successSm: `${base} bg-success px-3 py-1.5 text-xs text-white hover:opacity-90`,
};

export const INPUT =
  "w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none transition-colors focus:border-accent";

export function FieldLabel({ label, hint, error, children }: {
  label: string; hint?: string; error?: string; children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

// ── Notices ────────────────────────────────────────────────────

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <div className={`rounded-lg px-4 py-3 text-[13px] ${TONES[tone]}`}>
      {title && <div className="mb-0.5 font-semibold">{title}</div>}
      <div className="opacity-90">{children}</div>
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────

export function Dialog({ open, title, onClose, children, footer, wide }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-bg-card shadow-xl ${wide ? "max-w-3xl" : "max-w-md"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-heading text-[17px] font-bold text-text">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-text-muted hover:text-text">✕</button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ── Toast ──────────────────────────────────────────────────────

export function useFlash() {
  const [flash, setFlash] = useState<{ msg: string; ok: boolean } | null>(null);
  const show = useCallback((msg: string, ok = true) => {
    setFlash({ msg, ok });
    window.setTimeout(() => setFlash(null), 3500);
  }, []);
  const node = flash ? (
    <div
      role="status"
      className={`fixed right-4 top-4 z-[100] max-w-sm rounded-lg px-4 py-3 text-[13px] font-semibold text-white shadow-lg ${
        flash.ok ? "bg-success" : "bg-danger"
      }`}
    >
      {flash.msg}
    </div>
  ) : null;
  return { flash: show, flashNode: node };
}

// ── Key/value row ──────────────────────────────────────────────

export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-[13px]">
      <span className="text-text-muted">{label}</span>
      <span className="text-right font-medium text-text">{children}</span>
    </div>
  );
}
