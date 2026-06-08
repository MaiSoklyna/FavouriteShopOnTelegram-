"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || "FavouriteOfShop_bot";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isAdmin, adminLogin, startTgSession, pollSession, stopPolling, loginPending } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tgSessionId, setTgSessionId] = useState("");
  const [copied, setCopied] = useState(false);

  const redirect = searchParams.get("redirect") || "/dashboard";
  const tgUrl = tgSessionId ? `https://t.me/${BOT_USERNAME}?start=${tgSessionId}` : "";

  // Redirect if already logged in
  useEffect(() => {
    if (user && isAdmin) router.replace(redirect);
  }, [user, isAdmin, router, redirect]);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await adminLogin(email, password);
      router.replace(redirect);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Login failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleTelegramLogin() {
    setError("");
    setCopied(false);
    try {
      const sessionId = await startTgSession();
      setTgSessionId(sessionId);
      pollSession(sessionId);
      // Best-effort popup; users can also click the visible link below if blocked.
      window.open(`https://t.me/${BOT_USERNAME}?start=${sessionId}`, "_blank", "noopener");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create session";
      setError(msg);
    }
  }

  async function copyTgUrl() {
    if (!tgUrl) return;
    try {
      await navigator.clipboard.writeText(tgUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — user can still long-press the link */
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 400, background: "var(--bg-card)", borderRadius: 16, padding: 32, boxShadow: "var(--shadow-xl)", border: "1px solid var(--border)" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <img
            src="/image.png"
            alt="Byme24"
            style={{ width: 72, height: 72, borderRadius: 16, objectFit: "cover", marginBottom: 12, boxShadow: "var(--shadow)" }}
          />
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Byme24</div>
          <div style={{ color: "var(--text-muted)", fontSize: 14 }}>Admin Dashboard</div>
        </div>

        {error && (
          <div style={{ background: "var(--danger-light)", color: "var(--danger)", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* Email/Password Form */}
        <form onSubmit={handleEmailLogin}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 4 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14 }}
              placeholder="admin@example.com"
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 4 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14 }}
              placeholder="Enter password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%", padding: "12px", borderRadius: 8, border: "none",
              background: "var(--accent-gradient)", color: "var(--bg)",
              fontWeight: 600, fontSize: 14, cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>or</span>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        {/* Telegram Login */}
        <button
          onClick={handleTelegramLogin}
          disabled={loginPending}
          style={{
            width: "100%", padding: "12px", borderRadius: 8,
            border: "1px solid var(--border)", background: loginPending ? "var(--info-light)" : "var(--bg)",
            color: loginPending ? "var(--info)" : "var(--text)",
            fontWeight: 500, fontSize: 14, cursor: loginPending ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          {loginPending ? "Waiting for Telegram..." : "Login with Telegram"}
        </button>

        {loginPending && tgUrl && (
          <div style={{ marginTop: 12, padding: 12, background: "var(--bg-secondary)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8, lineHeight: 1.5 }}>
              A new Telegram tab should have opened. If not, tap the link below — then tap <b>START</b> in the bot chat to finish signing in.
            </div>
            <a
              href={tgUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "block", padding: "8px 10px", borderRadius: 6,
                background: "var(--bg)", border: "1px solid var(--border)",
                color: "var(--accent, #0088cc)", fontSize: 12, fontFamily: "monospace",
                wordBreak: "break-all", textDecoration: "none", marginBottom: 8,
              }}
            >
              {tgUrl}
            </a>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={copyTgUrl}
                style={{
                  flex: 1, padding: "6px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                  background: copied ? "var(--success-light, #DCFCE7)" : "var(--bg)",
                  color: copied ? "var(--success, #16A34A)" : "var(--text-secondary)",
                  border: "1px solid var(--border)", fontWeight: 600,
                }}
              >
                {copied ? "Copied!" : "Copy link"}
              </button>
              <button
                onClick={() => { stopPolling(); setTgSessionId(""); setCopied(false); }}
                style={{
                  flex: 1, padding: "6px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                  background: "var(--bg)", border: "1px solid var(--border)",
                  color: "var(--danger)", fontWeight: 600,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
