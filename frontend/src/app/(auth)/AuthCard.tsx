import type { CSSProperties, ReactNode } from "react";

/** The centred card the dashboard's sign-in pages share (login, forgot password, reset password). */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 400, background: "var(--bg-card)", borderRadius: 16, padding: 32, boxShadow: "var(--shadow-xl)", border: "1px solid var(--border)" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <img src="/image.png" alt="Byme24" style={{ width: 56, height: 56, borderRadius: 14, objectFit: "cover", marginBottom: 10, boxShadow: "var(--shadow)" }} />
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{title}</div>
          {subtitle && <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>{subtitle}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

export const authInput: CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--bg)", color: "var(--text)", fontSize: 14,
};
export const authLabel: CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 4 };
export const authButton = (busy: boolean): CSSProperties => ({
  width: "100%", padding: 12, borderRadius: 8, border: "none", background: "var(--accent-gradient)", color: "var(--bg)",
  fontWeight: 600, fontSize: 14, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1,
});
export const authNote = (tone: "error" | "ok"): CSSProperties => ({
  background: tone === "error" ? "var(--danger-light)" : "var(--success-light, #DCFCE7)",
  color: tone === "error" ? "var(--danger)" : "var(--success, #16A34A)",
  padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16, lineHeight: 1.5,
});
export const authLink: CSSProperties = { fontSize: 13, color: "var(--accent, #0088cc)", textDecoration: "none" };
