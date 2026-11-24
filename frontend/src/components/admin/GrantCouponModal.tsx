"use client";

import { useState } from "react";
import { api } from "@/lib/api";

/** Give a (private) coupon to specific customers by their Telegram ID; they get it in My Coupons and a notification. */
export function GrantCouponModal({ codeId, title, onClose }: { codeId: number; title: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ granted: number; already_had: number; not_found: number[] } | null>(null);

  const ids = Array.from(new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)));
  const bad = ids.filter((s) => !/^\d{5,}$/.test(s));

  async function give() {
    setBusy(true); setError("");
    try {
      setResult(await api.post(`/coupons/${codeId}/grant`, { telegram_ids: ids.map(Number) }));
    } catch (e: any) { setError(e?.detail || e?.message || "Could not give the coupon"); }
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Give coupon">
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Give “{title}”</h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          Enter the customers' Telegram IDs, one per line. They'll see the coupon in My Coupons and get a notification.
        </p>
        {result ? (
          <div data-testid="grant-result" style={{ fontSize: 14, lineHeight: 1.6 }}>
            <p><b>{result.granted}</b> customer{result.granted === 1 ? "" : "s"} received it{result.already_had ? `, ${result.already_had} already had it` : ""}.</p>
            {result.not_found.length > 0 && <p style={{ color: "var(--danger, #B42318)" }}>Not found: {result.not_found.join(", ")} (they must open the bot once).</p>}
            <button className="btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <textarea className="admin-input" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"5847427348\n1234567890"} aria-label="Telegram IDs" />
            {bad.length > 0 && <p role="alert" style={{ color: "var(--danger, #B42318)", fontSize: 12, marginTop: 6 }}>These don't look like Telegram IDs: {bad.join(", ")}</p>}
            {error && <p role="alert" style={{ color: "var(--danger, #B42318)", fontSize: 12, marginTop: 6 }}>{error}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
              <button className="btn-primary" style={{ flex: 1 }} disabled={busy || ids.length === 0 || bad.length > 0} onClick={give}>
                {busy ? "Giving…" : `Give to ${ids.length || ""} customer${ids.length === 1 ? "" : "s"}`.trim()}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
