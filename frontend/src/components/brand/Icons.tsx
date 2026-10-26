/**
 * Byme24 icon family (source: brand/icons.svg, brand/symbol.svg).
 * 24px grid, 1.6 stroke, every glyph carries the knot's vesica (pointed-leaf) motif.
 * Icons draw in `currentColor`; set `color` on a parent to tint them.
 */
import { useId, type CSSProperties, type ReactNode, type SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & { size?: number | string; title?: string };

// One vesica leaf of the knot (100-unit symbol grid); repeated at 0°, 120°, 240° around the ring centre (50, 58)
const LEAF = "M50 18A26 26 0 0 1 50 58A26 26 0 0 1 50 18Z";

function LineIcon({ size = 24, title, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round"
      role={title ? "img" : undefined} aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export function StoreIcon(props: IconProps) {
  return (
    <LineIcon {...props}>
      <path d="M3.5 9 6 4h12l2.5 5" />
      <path d="M3.5 9a2.8 2.8 0 0 0 5.67 0 2.8 2.8 0 0 0 5.66 0 2.8 2.8 0 0 0 5.67 0" />
      <path d="M5 11.5V20h14v-8.5" />
      <path d="M12 13a5 5 0 0 1 0 7 5 5 0 0 1 0-7Z" />
    </LineIcon>
  );
}

export function PromoIcon(props: IconProps) {
  return (
    <LineIcon {...props}>
      <path d="M3 12.5 11.5 4H20v8.5L11.5 21Z" />
      <path d="M16 5.5a3.2 3.2 0 0 1 0 5 3.2 3.2 0 0 1 0-5Z" />
      <path d="m8.5 15.5 4-4" />
    </LineIcon>
  );
}

export function OrdersIcon(props: IconProps) {
  return (
    <LineIcon {...props}>
      <path d="M5 8h14l-1 13H6Z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
      <path d="M12 11.5a4.5 4.5 0 0 1 0 6.5 4.5 4.5 0 0 1 0-6.5Z" />
    </LineIcon>
  );
}

export function RewardsIcon(props: IconProps) {
  const petal = "M12 3a6 6 0 0 1 0 9 6 6 0 0 1 0-9Z";
  return (
    <LineIcon {...props}>
      <path d={petal} />
      <path d={petal} transform="rotate(120 12 12)" />
      <path d={petal} transform="rotate(240 12 12)" />
      <path d="M8 18.5 7 22l5-2 5 2-1-3.5" />
    </LineIcon>
  );
}

export function DeliveryIcon(props: IconProps) {
  return (
    <LineIcon {...props}>
      <path d="M12 21.5a11 11 0 0 1 0-19 11 11 0 0 1 0 19Z" />
      <circle cx="12" cy="10" r="2.4" />
      <path d="M3 21.5h18" />
    </LineIcon>
  );
}

function Leaves({ dash }: { dash?: string }) {
  return (
    <g transform="translate(10 6)" strokeDasharray={dash}>
      <path d={LEAF} />
      <path d={LEAF} transform="rotate(120 50 58)" />
      <path d={LEAF} transform="rotate(240 50 58)" />
    </g>
  );
}

/** The knot drawn dashed, as if not yet tied. Default 110px. */
export function EmptyStateIcon({ size = 110, title, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined} {...rest}>
      {title && <title>{title}</title>}
      <circle cx="60" cy="60" r="54" strokeDasharray="4 7" opacity={0.5} />
      <Leaves dash="6 5" />
    </svg>
  );
}

/** Gold check inside a closed ring, the knot faded behind. `glow` adds the celebratory pulse. */
export function SuccessIcon({ size = 110, title, glow, className, ...rest }: IconProps & { glow?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth={2.4}
      strokeLinejoin="round" strokeLinecap="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}
      className={[glow ? "brand-glow" : "", className].filter(Boolean).join(" ") || undefined} {...rest}>
      {title && <title>{title}</title>}
      <circle cx="60" cy="60" r="54" />
      <g opacity={0.35}><Leaves /></g>
      <path d="m42 62 12 12 26-28" strokeWidth={5} />
    </svg>
  );
}

/**
 * The master knot symbol: three leaves joined by a ring, in gold foil.
 * `flat` uses solid gold instead of the gradient (small sizes, favicon look).
 */
export function KnotSymbol({ size = 48, flat, className, style, title }: {
  size?: number | string; flat?: boolean; className?: string; style?: CSSProperties; title?: string;
}) {
  // Gradient ids must be unique per instance or several knots on a page share the first one's defs
  const gid = `knot-${useId().replace(/:/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className}
      style={{ overflow: "visible", ...style }} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {!flat && (
        <defs>
          <linearGradient id={gid} x1="20" y1="10" x2="80" y2="90" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#F0DEB4" />
            <stop offset=".5" stopColor="#D6BA80" />
            <stop offset="1" stopColor="#71541A" />
          </linearGradient>
        </defs>
      )}
      <g stroke={flat ? "var(--brand-gold)" : `url(#${gid})`} strokeWidth={6} strokeLinejoin="round">
        <path d={LEAF} />
        <path d={LEAF} transform="rotate(120 50 58)" />
        <path d={LEAF} transform="rotate(240 50 58)" />
        <circle cx="50" cy="58" r="14" />
      </g>
    </svg>
  );
}

/**
 * Active / selected icon treatment: gold glyph on a navy rounded chip (56px by default).
 * Inactive icons render bare in the current text colour.
 */
export function IconChip({ children, size = 56, style }: { children: ReactNode; size?: number; style?: CSSProperties }) {
  return (
    <span
      className="brand-chip"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.286), ...style }}
    >
      {children}
    </span>
  );
}
