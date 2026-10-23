import Link from "next/link";
import type { ReactNode } from "react";

interface Props {
  title: ReactNode;
  /** Sits next to the title, e.g. the flash-deal countdown. */
  extra?: ReactNode;
  /** Round arrow button on the right (replaces "View all" text links). */
  href?: string;
  className?: string;
}

/** h 30: title 17/800 + optional extra + 30² arrow button (hit area extended to ≥ 44). */
export function SectionHeader({ title, extra, href, className = "" }: Props) {
  return (
    <div className={`flex h-[30px] items-center justify-between ${className}`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className="truncate text-section font-extrabold text-ink-900">{title}</h2>
        {extra}
      </div>
      {href && (
        <Link
          href={href}
          aria-label="See all"
          className="fos-press relative grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-white text-navy-900 shadow-fos-sm before:absolute before:-inset-[7px] before:content-['']"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 18l6-6-6-6" />
          </svg>
        </Link>
      )}
    </div>
  );
}
