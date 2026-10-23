import type { ReactNode } from "react";

type Variant = "neutral" | "jade" | "mango" | "gold" | "solid-mango";

const STYLES: Record<Variant, string> = {
  neutral: "bg-[#F1F4F8] text-ink-500",
  jade: "bg-[#E7F8EF] text-[#067647]",
  mango: "bg-[#FFF1E6] text-[#B54708]",
  gold: "bg-[#FBF4E4] text-gold-700",
  "solid-mango": "bg-mango-500 text-white",
};

/** Badge / pill: r999, 11/700, h 20–24. */
export function Pill({ variant = "neutral", children, className = "" }: { variant?: Variant; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[11px] font-bold ${STYLES[variant]} ${className}`}>
      {children}
    </span>
  );
}

/** "★ 4.8" — pass null to show the neutral "no rating yet" placeholder. */
export function RatingPill({ rating }: { rating: number | null | undefined }) {
  if (rating == null) return <Pill variant="neutral">★ —</Pill>;
  return <Pill variant="gold">★ {Number(rating).toFixed(1)}</Pill>;
}
