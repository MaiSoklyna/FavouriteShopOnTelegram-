"use client";

import { useId } from "react";

/** The Byme24 knot (brand/symbol.svg): three leaves around a ring, gold gradient stroke. */
const LEAF = "M50 18A26 26 0 0 1 50 58A26 26 0 0 1 50 18Z";

type SpinnerVariant = "rotate" | "pulse" | "glow";

interface SpinnerProps {
  size?: number;
  /**
   * rotate — three 120° steps every 2.4s (default)
   * pulse  — breathes in and out
   * glow   — steps like rotate with a soft gold halo
   */
  variant?: SpinnerVariant;
  /** Accessible label; defaults to "Loading". */
  label?: string;
}

export function Spinner({ size = 32, variant = "rotate", label = "Loading" }: SpinnerProps) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      width={size} height={size} viewBox="0 0 100 100" fill="none"
      role="status" aria-label={label}
      className={`brand-spinner brand-spinner--${variant}`}
      style={{ display: "inline-block", flexShrink: 0, verticalAlign: "middle" }}
    >
      <defs>
        <linearGradient id={`g${id}`} x1="20" y1="10" x2="80" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E8D3A2" /><stop offset=".5" stopColor="#D6BA80" /><stop offset="1" stopColor="#71541A" />
        </linearGradient>
      </defs>
      <g className="brand-spinner__knot" stroke={`url(#g${id})`} strokeWidth="6" strokeLinejoin="round">
        <path d={LEAF} />
        <path d={LEAF} transform="rotate(120 50 58)" />
        <path d={LEAF} transform="rotate(240 50 58)" />
        <circle cx="50" cy="58" r="14" />
      </g>
    </svg>
  );
}

/** Whole-screen loading: navy ground, the knot, and a gold sweep under it. */
export function FullPageSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28,
        height: "100vh", background: "var(--brand-navy, #081D3C)",
      }}
    >
      <Spinner size={72} label={label} />
      <div className="brand-sweep" aria-hidden="true"><span /></div>
    </div>
  );
}
