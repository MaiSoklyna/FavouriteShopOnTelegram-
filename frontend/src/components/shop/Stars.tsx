import { Icon } from "./Icon";

/** Five stars showing a rating (read-only). Whole stars only: 4.4 shows four. */
export function Stars({ value, size = 14, className = "" }: { value: number; size?: number; className?: string }) {
  const full = Math.round(value);
  return (
    <span className={`inline-flex gap-0.5 ${className}`} role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name="star" size={size} filled className={n <= full ? "text-gold-400" : "text-line"} />
      ))}
    </span>
  );
}

/** Pick 1-5 stars. Keyboard and screen reader friendly (a radio group of five buttons). */
export function StarInput({ value, onChange, size = 34 }: { value: number; onChange: (n: number) => void; size?: number }) {
  return (
    <div role="radiogroup" aria-label="Your rating" className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? "" : "s"}`}
          onClick={() => onChange(n)} className="fos-press grid place-items-center rounded-full p-0.5">
          <Icon name="star" size={size} filled className={n <= value ? "text-gold-400" : "text-line"} />
        </button>
      ))}
    </div>
  );
}

export const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
