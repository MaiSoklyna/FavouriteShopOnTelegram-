"use client";

import { useState, type CSSProperties } from "react";

interface CategoryIconProps {
  icon?: string | null;
  size?: number;
  /** Icons8 slug used when `icon` is missing or fails to load. Default "box". */
  fallback?: string;
  alt?: string;
  style?: CSSProperties;
  className?: string;
}

const URL_RE = /^https?:\/\//i;

/**
 * Build an Icons8 URL from a slug. Fluency style, double-resolution PNG.
 */
export function icons8Url(slug: string, size: number = 48): string {
  const px = Math.max(48, Math.min(192, Math.round(size * 2)));
  return `https://img.icons8.com/fluency/${px}/${slug}.png`;
}

/**
 * Renders a category/merchant icon. Supports two storage formats:
 *   - URL (e.g. https://img.icons8.com/...) → rendered as <img>
 *   - Emoji (e.g. "🍔") → rendered as text, centered and sized to match
 * Falls back to an Icons8 image if missing or the URL fails to load.
 */
export function CategoryIcon({
  icon,
  size = 24,
  fallback = "box",
  alt = "",
  style,
  className,
}: CategoryIconProps) {
  const [errored, setErrored] = useState(false);
  const value = icon?.trim();

  // Emoji branch: any non-URL, non-empty string is rendered as text.
  if (value && !URL_RE.test(value)) {
    return (
      <span
        role="img"
        aria-label={alt || undefined}
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.86),
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          ...style,
        }}
        className={className}
      >
        {value}
      </span>
    );
  }

  const src = value && !errored ? value : icons8Url(fallback, size);

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => {
        if (!errored) setErrored(true);
      }}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        display: "block",
        ...style,
      }}
      className={className}
    />
  );
}
