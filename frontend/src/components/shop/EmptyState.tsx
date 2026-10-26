import Link from "next/link";
import type { ReactNode } from "react";

interface Props {
  title: string;
  /** Illustration slot (200² area). Defaults to a simple shopping bag. */
  illustration?: ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
  className?: string;
}

function BagIllustration() {
  return (
    <svg width="200" height="200" viewBox="0 0 200 200" fill="none" aria-hidden>
      <ellipse cx="100" cy="172" rx="62" ry="9" fill="#E3E8EF" />
      <rect x="44" y="64" width="112" height="104" rx="22" fill="#103562" />
      <path d="M72 64v-6a28 28 0 0 1 56 0v6" stroke="#D6BA80" strokeWidth="9" strokeLinecap="round" />
      <circle cx="100" cy="116" r="22" fill="#B8862B" />
      <path d="M90 116l7 7 14-15" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Illustration + one-line title + one button. */
export function EmptyState({ title, illustration, action, className = "" }: Props) {
  const btn = "fos-press mt-3 inline-flex h-12 items-center justify-center rounded-thumb bg-grad-cta px-6 text-[15px] font-bold text-white shadow-fos-cta";
  return (
    <div className={`flex flex-col items-center py-6 text-center ${className}`}>
      <div className="h-[200px] w-[200px]">{illustration ?? <BagIllustration />}</div>
      <p className="mt-2 text-title text-ink-900">{title}</p>
      {action && (action.href
        ? <Link href={action.href} className={btn}>{action.label}</Link>
        : <button type="button" onClick={action.onClick} className={btn}>{action.label}</button>)}
    </div>
  );
}
