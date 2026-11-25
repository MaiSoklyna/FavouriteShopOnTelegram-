"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { AuthCard, authButton, authInput, authLabel, authLink, authNote } from "../AuthCard";

/** Ask for a password reset link. It is sent by the Byme24 bot to the Telegram linked to the account. */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      // Read the field itself: text typed before the page finished loading is not in React state yet
      const typed = String(new FormData(e.currentTarget as HTMLFormElement).get("email") || email).trim();
      const res = await api.post<{ message: string }>("/auth/forgot-password", { email: typed });
      setDone(res.message);
    } catch (err: any) {
      setError(err?.detail || err?.message || "Something went wrong. Try again in a minute.");
    } finally { setBusy(false); }
  }

  return (
    <AuthCard title="Forgot your password?" subtitle="We'll send a reset link to the Telegram account linked to your dashboard login.">
      {error && <div style={authNote("error")}>{error}</div>}
      {done ? (
        <>
          <div style={authNote("ok")} data-testid="forgot-done">{done}</div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 16 }}>
            Open Telegram and look for a message from the Byme24 bot. Nothing there?
            Your account may have no Telegram linked: staff and managers can ask the shop owner to set a new password;
            shop owners can ask the platform admin.
          </p>
        </>
      ) : (
        <form onSubmit={submit}>
          <label style={{ ...authLabel, marginBottom: 16 }}>
            Email
            <input type="email" name="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              style={{ ...authInput, marginTop: 4 }} placeholder="you@example.com" autoFocus />
          </label>
          <button type="submit" disabled={busy} style={authButton(busy)}>{busy ? "Sending…" : "Send reset link"}</button>
        </form>
      )}
      <div style={{ textAlign: "center", marginTop: 18 }}><a href="/login" style={authLink}>Back to sign in</a></div>
    </AuthCard>
  );
}
