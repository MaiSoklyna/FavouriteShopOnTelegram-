import type { Config } from "tailwindcss";
import { fosTheme } from "./tailwind.tokens";

// The handoff's fontSize entries are [size, {lineHeight, fontWeight}] tuples that TypeScript infers as arrays
type FontSize = NonNullable<NonNullable<Config["theme"]>["extend"]>["fontSize"];

/** rgb(var(--x) / alpha) so opacity modifiers like bg-surface/90 keep working */
const v = (name: string) => `rgb(var(--fos-c-${name}) / <alpha-value>)`;
function themeColors() {
  return {
    surface: v("surface"),
    card: v("card"),
    line: v("line"),
    ink: { 900: v("ink-900"), 500: v("ink-500") },
    navy: { ...fosTheme.colors.navy, 700: v("navy-700"), 500: v("navy-500") },
    tint: {
      jade: v("tint-jade"), mango: v("tint-mango"), ruby: v("tint-ruby"), gold: v("tint-gold"),
      neutral: v("tint-neutral"), navy: v("tint-navy"), map: v("tint-map"),
    },
    tone: { jade: v("tone-jade"), mango: v("tone-mango"), navy: v("tone-navy") },
  };
}

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      // Design handoff ("Night Market Premium"): fontSize, backgroundImage and spacing are new keys
      fontSize: fosTheme.fontSize as unknown as FontSize,
      backgroundImage: fosTheme.backgroundImage,
      spacing: fosTheme.spacing,
      fontFamily: {
        heading: ["'Kantumruy Pro'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
        ...fosTheme.fontFamily,
      },
      colors: {
        "h24-blue": "#103562",
        "h24-navy": "#081D3C",
        "h24-gold": "#71541A",
        "h24-gold-light": "#D6BA80",
        "h24-cloud": "#EAEFF3",
        "h24-grey": "#5B6472",
        bg: "var(--bg)",
        "bg-secondary": "var(--bg-secondary)",
        "bg-card": "var(--bg-card)",
        "bg-hover": "var(--bg-hover)",
        border: "var(--border)",
        text: "var(--text)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)",
        accent: "var(--accent)",
        "accent-light": "var(--accent-light)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        info: "var(--info)",
        ...fosTheme.colors,
        // Theme-aware design tokens: values live in globals.css (:root / [data-theme="dark"])
        // so the redesigned screens follow dark mode without per-class dark: variants.
        ...themeColors(),
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        ...fosTheme.boxShadow,
      },
      borderRadius: {
        pill: "var(--shop-r-pill)",
        // `card` and `sheet` were already defined for the old shop theme; no screen uses them
        // (checked), so the handoff values (20px / 28px) replace them.
        ...fosTheme.borderRadius,
      },
    },
  },
  plugins: [],
};

export default config;
