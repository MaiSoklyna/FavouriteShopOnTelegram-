"use client";

import { useId } from "react";

/** The Byme24 knot (brand/symbol.svg): three leaves around a ring, gold gradient stroke. */
const LEAF = "M50 18A26 26 0 0 1 50 58A26 26 0 0 1 50 18Z";

type SpinnerVariant = "rotate" | "pulse" | "glow";

interface SpinnerProps {
  size?: number;
  /**
   * rotate — three 120° steps every 2.4s (default)
   * pulse  — scale .92→1.04, 1.8s: inline waits (cart, payment check)
   * glow   — gold halo 0→14px, 2.2s: order placed, reward unlocked
   */
  variant?: SpinnerVariant;
  /** Accessible label; defaults to "Loading". */
  label?: string;
}

export function Spinner({ size = 32, variant = "rotate", label = "Loading" }: SpinnerProps) {
  const id = useId().replace(/:/g, "");
  // Gold foil only at hero sizes; small knots use flat gold so the gradient doesn't muddy.
  const foil = size >= 48;
  return (
    <svg
      width={size} height={size} viewBox="0 0 100 100" fill="none"
      role="status" aria-label={label}
      className={`brand-spinner brand-spinner--${variant}`}
      style={{ display: "inline-block", flexShrink: 0, verticalAlign: "middle" }}
    >
      <defs>
        <linearGradient id={`g${id}`} x1="20" y1="10" x2="80" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F0DEB4" /><stop offset=".5" stopColor="#D6BA80" /><stop offset="1" stopColor="#71541A" />
        </linearGradient>
      </defs>
      <g className="brand-spinner__knot" stroke={foil ? `url(#g${id})` : "var(--brand-gold, #D6BA80)"} strokeWidth="6" strokeLinejoin="round">
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
