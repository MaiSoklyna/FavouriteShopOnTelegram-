"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { AuthCard, authButton, authInput, authLabel, authLink, authNote } from "../AuthCard";

export default function ResetPasswordPage() {
  return <Suspense><ResetPassword /></Suspense>;
}

/** Set a new password with the link the bot sent. The link works once, for 30 minutes. */
function ResetPassword() {
  const token = useSearchParams().get("token") || "";
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pw.length < 8) { setError("Use at least 8 characters."); return; }
    if (pw !== again) { setError("The two passwords are not the same."); return; }
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: pw });
      setDone(true);
    } catch (err: any) {
      setError(err?.detail || err?.message || "Could not change the password.");
    } finally { setBusy(false); }
  }

  if (!token) {
    return (
      <AuthCard title="Reset link missing">
        <div style={authNote("error")}>Open the link from the Telegram message again, or ask for a new one.</div>
        <div style={{ textAlign: "center" }}><a href="/forgot-password" style={authLink}>Ask for a new link</a></div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={done ? "Password changed" : "Choose a new password"}>
      {error && <div style={authNote("error")} data-testid="reset-error">{error}</div>}
      {done ? (
        <>
          <div style={authNote("ok")} data-testid="reset-done">Your password is changed. You can sign in with it now.</div>
          <a href="/login" style={{ ...authButton(false), display: "block", textAlign: "center", textDecoration: "none" }}>Sign in</a>
        </>
      ) : (
        <form onSubmit={submit}>
          <label style={{ ...authLabel, marginBottom: 12 }}>
            New password
            <input type="password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)}
              style={{ ...authInput, marginTop: 4 }} placeholder="At least 8 characters" autoComplete="new-password" autoFocus />
          </label>
          <label style={{ ...authLabel, marginBottom: 16 }}>
            Type it again
            <input type="password" required value={again} onChange={(e) => setAgain(e.target.value)}
              style={{ ...authInput, marginTop: 4 }} autoComplete="new-password" />
          </label>
          <button type="submit" disabled={busy} style={authButton(busy)}>{busy ? "Saving…" : "Save new password"}</button>
          {error && <div style={{ textAlign: "center", marginTop: 14 }}><a href="/forgot-password" style={authLink}>Ask for a new link</a></div>}
        </form>
      )}
    </AuthCard>
  );
}
