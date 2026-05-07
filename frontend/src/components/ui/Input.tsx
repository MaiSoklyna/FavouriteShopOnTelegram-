import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";

const baseStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 13,
  outline: "none",
  transition: "border-color 0.15s",
};

interface FieldProps {
  label?: string;
  error?: string;
  children: ReactNode;
}

export function Field({ label, error, children }: FieldProps) {
  return (
    <div>
      {label && <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>{label}</label>}
      {children}
      {error && <p style={{ color: "var(--danger)", fontSize: 11, marginTop: 4 }}>{error}</p>}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  const { error, style, ...rest } = props;
  return <input style={{ ...baseStyle, borderColor: error ? "var(--danger)" : "var(--border)", ...style }} {...rest} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { style, ...rest } = props;
  return <textarea style={{ ...baseStyle, resize: "vertical", minHeight: 80, ...style }} {...rest} />;
}

export function Select({ children, style, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select style={{ ...baseStyle, ...style }} {...props}>{children}</select>;
}
