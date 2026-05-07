import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "outline" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  children: ReactNode;
}

const STYLES: Record<Variant, React.CSSProperties> = {
  primary: { background: "var(--accent-gradient)", color: "var(--bg)", border: "none" },
  outline: { background: "transparent", color: "var(--text)", border: "1px solid var(--border)" },
  danger: { background: "var(--danger)", color: "#fff", border: "none" },
  ghost: { background: "transparent", color: "var(--text-secondary)", border: "none" },
};

const SIZES: Record<string, React.CSSProperties> = {
  sm: { padding: "6px 12px", fontSize: 12, borderRadius: 6 },
  md: { padding: "8px 16px", fontSize: 13, borderRadius: 8 },
  lg: { padding: "12px 24px", fontSize: 14, borderRadius: 10 },
};

export function Button({ variant = "primary", size = "md", loading, disabled, children, style, ...props }: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      style={{
        ...SIZES[size],
        ...STYLES[variant],
        fontWeight: 600,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled || loading ? 0.5 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        transition: "opacity 0.15s",
        ...style,
      }}
      {...props}
    >
      {loading && <span style={{ width: 14, height: 14, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.6s linear infinite", flexShrink: 0 }} />}
      {children}
      {loading && <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>}
    </button>
  );
}
