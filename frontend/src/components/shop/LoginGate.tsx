"use client";

import { useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { isInTelegram } from "@/lib/telegram";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || "FavouriteOfShop_bot";

/**
 * Shows a Telegram login prompt for unauthenticated users outside Telegram.
 * Inside Telegram, auth happens automatically via initData.
 *
 * Used by shop pages that require login (cart, orders, profile, etc.)
 * Public pages (home, search, product detail) don't need this.
 */
export function LoginGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <div style={{ width: 32, height: 32, border: "3px solid var(--shop-divider, #ECEEF3)", borderTopColor: "var(--shop-primary, #1E6BFF)", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (user) return <>{children}</>;

  return <TelegramLoginPrompt />;
}

function TelegramLoginPrompt() {
  const { startTgSession, pollSession, stopPolling, loginPending } = useAuth();
  const [sessionId, setSessionId] = useState("");

  async function handleLogin() {
    try {
      const sid = await startTgSession();
      setSessionId(sid);
      pollSession(sid);
      // Open bot in new window/tab
      window.open(`https://t.me/${BOT_USERNAME}?start=${sid}`, "_blank");
    } catch (err) {
      console.error("Login session failed:", err);
    }
  }

  return (
    <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 320 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🛍️</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", marginBottom: 8 }}>
          Welcome to Byme24
        </h2>
        <p style={{ fontSize: 14, color: "var(--shop-muted, #8A8F9C)", marginBottom: 24, lineHeight: 1.5 }}>
          Login with your Telegram account to start shopping, track orders, and earn rewards.
        </p>

        {!loginPending ? (
          <button
            onClick={handleLogin}
            style={{
              width: "100%",
              padding: "14px 24px",
              borderRadius: "var(--shop-r-input, 12px)",
              border: "none",
              background: "var(--shop-primary, #1E6BFF)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 15,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
            </svg>
            Login with Telegram
          </button>
        ) : (
          <div>
            <div
              style={{
                width: "100%",
                padding: "14px 24px",
                borderRadius: "var(--shop-r-input, 12px)",
                border: "2px solid var(--shop-primary, #1E6BFF)",
                background: "var(--shop-primary-tint, #E8F0FF)",
                color: "var(--shop-primary, #1E6BFF)",
                fontWeight: 600,
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
              }}
            >
              <div style={{ width: 16, height: 16, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
              Waiting for Telegram...
            </div>
            <p style={{ fontSize: 12, color: "var(--shop-muted, #8A8F9C)", marginTop: 12 }}>
              Open the Telegram bot and tap the login button.
            </p>
            <button
              onClick={() => { stopPolling(); setSessionId(""); }}
              style={{ background: "none", border: "none", color: "#DC2626", cursor: "pointer", fontSize: 12, fontWeight: 500, marginTop: 8 }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Direct Telegram link for mobile */}
        {!loginPending && !isInTelegram() && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 11, color: "var(--shop-muted, #8A8F9C)" }}>
              Or open in Telegram directly:
            </p>
            <a
              href={`https://t.me/${BOT_USERNAME}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, color: "var(--shop-primary, #1E6BFF)", fontWeight: 500, textDecoration: "none" }}
            >
              @{BOT_USERNAME}
            </a>
          </div>
        )}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export { TelegramLoginPrompt };
