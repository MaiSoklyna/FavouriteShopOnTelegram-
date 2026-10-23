"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

interface Props {
  /** Area name, or null → "Set location". */
  area: string | null;
  onLocationClick: () => void;
  unread: number;
}

/**
 * h 56. Left: location chip (pin in a 32² mango-tint box + area 15/800 + ▾).
 * Right: bell button 40² with a mango dot when there is something unread.
 */
export function HomeTopBar({ area, onLocationClick, unread }: Props) {
  return (
    <div className="flex h-14 items-center justify-between px-4 pb-2.5 pt-1">
      <button type="button" onClick={onLocationClick} className="fos-press flex min-h-[44px] min-w-0 items-center gap-2" aria-label="Change location">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[12px] bg-[#FFF1E6] text-mango-500">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" />
          </svg>
        </span>
        <span className="truncate text-[15px] font-extrabold text-ink-900">{area ?? "Set location"}</span>
        <svg className="shrink-0 text-ink-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>

      <Link
        href="/shop/notifications"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        className="fos-press relative grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-white text-navy-900 shadow-fos-sm before:absolute before:-inset-[2px] before:content-['']"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-mango-500 ring-2 ring-white" />}
      </Link>
    </div>
  );
}

/** 343×48, r16, white, shadow-sm. Sticky so search stays reachable while scrolling. */
export function SearchBar() {
  const router = useRouter();
  const go = () => router.push("/shop/search");
  return (
    <div className="sticky top-0 z-30 bg-surface px-4 pb-2 pt-1">
      <div
        role="search"
        onClick={go}
        className="fos-press flex h-12 cursor-pointer items-center gap-2.5 rounded-thumb bg-white pl-3.5 pr-2 shadow-fos-sm"
      >
        <svg className="shrink-0 text-ink-500" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
        <span className="flex-1 text-[15px] text-ink-500">Search</span>
        {/* Visual search does not exist yet; the camera button opens normal search for now */}
        <button type="button" aria-label="Search" onClick={(e) => { e.stopPropagation(); go(); }}
          className="relative grid h-8 w-8 place-items-center rounded-[10px] bg-[#F1F4F8] text-ink-500 before:absolute before:-inset-[6px] before:content-['']">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
