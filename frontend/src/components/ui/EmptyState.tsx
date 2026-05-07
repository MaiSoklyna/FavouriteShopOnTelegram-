interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: string;
  onAction?: () => void;
}

export function EmptyState({ icon = "📭", title, description, action, onAction }: EmptyStateProps) {
  return (
    <div style={{ textAlign: "center", padding: "48px 16px" }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>{icon}</div>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{title}</h3>
      {description && <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>{description}</p>}
      {action && onAction && (
        <button
          onClick={onAction}
          style={{
            padding: "10px 24px", background: "var(--accent-gradient)", color: "var(--bg)",
            border: "none", borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}
        >
          {action}
        </button>
      )}
    </div>
  );
}
