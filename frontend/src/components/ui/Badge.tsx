const COLORS: Record<string, { bg: string; color: string }> = {
  pending:    { bg: "var(--warning-light)", color: "var(--warning)" },
  confirmed:  { bg: "var(--info-light)", color: "var(--info)" },
  processing: { bg: "#f0e6ff", color: "var(--purple)" },
  shipped:    { bg: "var(--info-light)", color: "var(--info)" },
  delivered:  { bg: "var(--success-light)", color: "var(--success)" },
  cancelled:  { bg: "var(--danger-light)", color: "var(--danger)" },
  active:     { bg: "var(--success-light)", color: "var(--success)" },
  inactive:   { bg: "var(--bg-secondary)", color: "var(--text-muted)" },
  suspended:  { bg: "var(--danger-light)", color: "var(--danger)" },
  open:       { bg: "var(--warning-light)", color: "var(--warning)" },
  replied:    { bg: "var(--info-light)", color: "var(--info)" },
  closed:     { bg: "var(--bg-secondary)", color: "var(--text-muted)" },
  bronze:     { bg: "#fef3c7", color: "#92400e" },
  silver:     { bg: "#f3f4f6", color: "#6b7280" },
  gold:       { bg: "#fef9c3", color: "#a16207" },
};

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const c = COLORS[status] || COLORS.inactive;
  const fontSize = size === "sm" ? 11 : 12;
  const padding = size === "sm" ? "2px 10px" : "3px 12px";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding,
        borderRadius: 12,
        fontSize,
        fontWeight: 600,
        textTransform: "capitalize",
        background: c.bg,
        color: c.color,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}
