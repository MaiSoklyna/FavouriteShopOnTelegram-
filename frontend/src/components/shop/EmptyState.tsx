import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyStateIcon } from "@/components/brand/Icons";

interface Props {
  title: string;
  /** Illustration slot (200² area). Defaults to the brand's dashed knot. */
  illustration?: ReactNode;
  /** One short line under the title. */
  body?: string;
  action?: { label: string; href?: string; onClick?: () => void };
  className?: string;
}

function KnotIllustration() {
  return (
    <div className="grid h-full w-full place-items-center text-ink-500">
      <EmptyStateIcon size={140} />
    </div>
  );
}

/** Illustration + one-line title + one button. */
export function EmptyState({ title, illustration, body, action, className = "" }: Props) {
  const btn = "fos-press mt-3 inline-flex h-12 items-center justify-center rounded-thumb bg-grad-cta px-6 text-[15px] font-bold text-white shadow-fos-cta";
  return (
    <div className={`flex flex-col items-center py-6 text-center ${className}`}>
      <div className="h-[200px] w-[200px]">{illustration ?? <KnotIllustration />}</div>
      <p className="mt-2 text-title text-ink-900">{title}</p>
      {body && <p className="mt-1 max-w-[30ch] text-[14px] leading-5 text-ink-500">{body}</p>}
      {action && (action.href
        ? <Link href={action.href} className={btn}>{action.label}</Link>
        : <button type="button" onClick={action.onClick} className={btn}>{action.label}</button>)}
    </div>
  );
}
