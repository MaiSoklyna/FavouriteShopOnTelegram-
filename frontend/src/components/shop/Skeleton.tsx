/**
 * Shimmer placeholder (#E3E8EF → #F6F8FB, 1.4s linear). Size it with
 * className to match the block it stands in for.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`fos-shimmer ${className}`} />;
}
