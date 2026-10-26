"use client";

import { useEffect, useState } from "react";
import { KnotSymbol } from "@/components/brand/Icons";

type SpinnerVariant = "rotate" | "pulse" | "glow";

interface SpinnerProps {
  size?: number;
  /** rotate: default wait · pulse: inline waits (cart, payment check) · glow: celebratory moments */
  variant?: SpinnerVariant;
  /** Solid gold instead of the foil gradient (better below ~24px) */
  flat?: boolean;
  label?: string;
}

/** The Byme24 knot as a loading indicator. All variants stop under prefers-reduced-motion. */
export function Spinner({ size = 32, variant = "rotate", flat, label = "Loading" }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} style={{ display: "inline-flex", lineHeight: 0 }}>
      <KnotSymbol size={size} flat={flat ?? size < 24} className={`brand-${variant}`} />
    </span>
  );
}

/** Navy loading screen: the knot turning in 120° steps above a gold progress sweep. */
export function FullPageSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="brand-screen" role="status" aria-label={label}>
      <KnotSymbol size={88} className="brand-rotate" />
      <div className="brand-sweep" style={{ marginTop: 40 }}><i /></div>
    </div>
  );
}

/** Static launch splash: knot on the optical centre, wordmark with a gold 24, tagline. */
export function SplashScreen() {
  return (
    <div className="brand-screen brand-screen--splash" aria-label="Byme24">
      <KnotSymbol size={120} style={{ marginBottom: 36 }} />
      <div className="brand-wordmark">Byme<span>24</span></div>
      <div className="brand-tagline" style={{ position: "absolute", bottom: "8%" }}>Shop the city</div>
    </div>
  );
}

/** Splash for the first 600ms, then hands over to the loading screen until the caller unmounts it. */
export function LaunchScreen() {
  const [splash, setSplash] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 600);
    return () => clearTimeout(t);
  }, []);
  return splash ? <SplashScreen /> : <FullPageSpinner />;
}
