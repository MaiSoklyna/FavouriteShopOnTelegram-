import Link from "next/link";

interface Props {
  href: string;
  label: string;
  /** Category photo URL. Falls back to the emoji, then a neutral glyph. */
  imageUrl?: string | null;
  emoji?: string | null;
}

const URL_RE = /^https?:\/\//i;

/**
 * Home category shortcut: 64² r22 photo on a tinted background + one-line
 * label 11/700. (`CategoryIcon` already exists for icon rendering elsewhere,
 * so this keeps a distinct name.)
 */
export function CategoryPhotoIcon({ href, label, imageUrl, emoji }: Props) {
  const photo = imageUrl || (emoji && URL_RE.test(emoji) ? emoji : null);
  return (
    <Link href={href} className="fos-press flex min-h-[44px] flex-col items-center gap-1.5">
      <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-cat bg-[#EEF2F8]">
        {photo ? (
          <img src={photo} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : emoji ? (
          <span className="text-[28px] leading-none">{emoji}</span>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5B6472" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
        )}
      </div>
      <span className="w-full truncate text-center text-[11px] font-bold text-ink-900">{label}</span>
    </Link>
  );
}
