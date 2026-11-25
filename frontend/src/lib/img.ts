/**
 * Serve an uploaded image at the size it is shown, instead of the original upload.
 *
 * Shops upload photos straight from their phones (often 400 KB – 1 MB+), and the shop shows
 * them as small cards and logos. Supabase's own resizer needs a paid plan, so Supabase
 * Storage URLs go through Next's image optimizer (/_next/image), which resizes, re-encodes to
 * WebP/AVIF and caches the result at Vercel's edge. Any other URL (icons8, emoji, data:, blob:)
 * is returned unchanged.
 *
 * `width` must be one of Next's configured sizes; pick the one at or above the rendered size
 * at 2x density:
 *   LOGO   (≤ 64 px shown)       → 128
 *   CARD   (product/shop cards)  → 384
 *   WIDE   (banners, hero, product gallery) → 828
 */
export const IMG = { LOGO: 128, CARD: 384, WIDE: 828 } as const;

const STORAGE_PATH = ".supabase.co/storage/v1/object/public/";

export function img(url: string | null | undefined, width: number): string | undefined {
  if (!url) return undefined;
  if (!url.includes(STORAGE_PATH)) return url;
  return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=75`;
}
