import { formatKhr, formatUsd } from "@/lib/currency";

interface Props {
  usd: number;
  /** Original price, drawn struck through next to the current one. */
  oldUsd?: number | null;
  size?: "md" | "sm";
  className?: string;
}

/** USD large, KHR caption below, tabular numerals so prices line up in a grid. */
export function PriceTag({ usd, oldUsd, size = "md", className = "" }: Props) {
  return (
    <div className={`tabular-nums ${className}`}>
      <div className="flex items-baseline gap-1.5">
        <span className={`font-extrabold text-ink-900 ${size === "md" ? "text-price" : "text-[15px] leading-5"}`}>{formatUsd(usd)}</span>
        {oldUsd != null && oldUsd > usd && (
          <span className="text-[11px] font-medium text-ink-500 line-through">{formatUsd(oldUsd)}</span>
        )}
      </div>
      <div className="text-[11px] leading-4 text-ink-500">{formatKhr(usd)}</div>
    </div>
  );
}
