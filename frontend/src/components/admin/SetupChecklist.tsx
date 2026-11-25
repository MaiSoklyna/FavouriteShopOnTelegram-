"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SetupData } from "@/lib/setup";

/**
 * The shop's setup progress on its dashboard.
 * - Not live yet: how far it is, and what is still needed before customers can see it.
 * - Live but missing a required item (an older shop, or one removed since): a warning with the list.
 * - Everything done: nothing is shown.
 */
export function SetupChecklist() {
  const [data, setData] = useState<SetupData | null>(null);

  useEffect(() => {
    api.get<SetupData>("/merchant-setup").then(setData).catch(() => setData(null));
  }, []);

  const c = data?.checklist;
  if (!c || (c.live && c.complete)) return null;

  const pct = Math.round((c.done / c.total) * 100);
  const todo = c.required.filter((r) => !r.done);
  const warning = c.live;

  return (
    <div className="admin-card" data-testid="setup-checklist"
      style={{ marginBottom: 16, border: `1px solid ${warning ? "var(--warning)" : "var(--accent, #0088cc)"}`, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <div aria-hidden style={{ position: "relative", width: 64, height: 64, flexShrink: 0 }}>
        <svg width="64" height="64" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15" fill="none" stroke="var(--border)" strokeWidth="4" />
          <circle cx="18" cy="18" r="15" fill="none" stroke={warning ? "var(--warning)" : "var(--accent, #0088cc)"} strokeWidth="4"
            strokeLinecap="round" transform="rotate(-90 18 18)" strokeDasharray={2 * Math.PI * 15} strokeDashoffset={2 * Math.PI * 15 * (1 - pct / 100)} />
        </svg>
        <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700 }}>{c.done}/{c.total}</span>
      </div>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>
          {warning ? "Your shop is live, but its setup is not complete" : "Set up your shop"}
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "2px 0 8px" }}>
          {warning
            ? "Customers can see your shop. Finish these so it works well for them:"
            : "Customers will see your shop as soon as these are done:"}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {todo.map((t) => (
            <a key={t.key} href={`/setup?step=${t.step}`} className="badge badge-pending" style={{ textDecoration: "none" }}>{t.label}</a>
          ))}
        </div>
      </div>
      <a href="/setup" className="btn-primary" style={{ textDecoration: "none" }}>{warning ? "Finish setup" : "Continue setup"}</a>
    </div>
  );
}
