import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        heading: ["'Kantumruy Pro'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
      },
      colors: {
        "h24-blue": "#103562",
        "h24-navy": "#081D3C",
        "h24-gold": "#71541A",
        "h24-gold-light": "#D6BA80",
        "h24-cloud": "#EAEFF3",
        "h24-grey": "#746D6D",
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
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
      },
      borderRadius: {
        card: "var(--shop-r-card)",
        sheet: "var(--shop-r-sheet)",
        pill: "var(--shop-r-pill)",
      },
    },
  },
  plugins: [],
};

export default config;
