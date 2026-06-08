"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import type { SellerApplication } from "@/types";

const TABS = ["pending", "approved", "rejected", "all"] as const;
type Tab = (typeof TABS)[number];

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  pending: { bg: "var(--warning-light)", fg: "var(--warning)", label: "Pending" },
  under_review: { bg: "var(--info-light)", fg: "var(--info)", label: "Under review" },
  approved: { bg: "var(--success-light)", fg: "var(--success)", label: "Approved" },
  rejected: { bg: "var(--danger-light)", fg: "var(--danger)", label: "Rejected" },
};

export default function SellerApplicationsPage() {
  const { isSuperAdmin } = useAuth();
  const [apps, setApps] = useState<SellerApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });

  const flash = (msg: string, ok = true) => {
    setToast({ show: true, msg, ok });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000);
  };

  const load = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (tab !== "all") params.status = tab;
      setApps(await api.get<SellerApplication[]>("/seller-applications/admin/list", { params }));
    } catch {
      flash("Failed to load applications", false);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { setLoading(true); load(); }, [tab, load]);

  async function approve(id: number) {
    if (!confirm("Approve this seller? This creates their shop and login.")) return;
    setBusy(id);
    try {
      await api.patch(`/seller-applications/admin/${id}/approve`);
      flash("Approved — shop & login created");
      load();
    } catch (e: any) {
      flash(e.detail || "Failed to approve", false);
    } finally { setBusy(null); }
  }

  async function reject(id: number) {
    const note = prompt("Reason for rejection (shown to the applicant, optional):");
    if (note === null) return;
    setBusy(id);
    try {
      await api.patch(`/seller-applications/admin/${id}/reject`, { note });
      flash("Application rejected");
      load();
    } catch (e: any) {
      flash(e.detail || "Failed to reject", false);
    } finally { setBusy(null); }
  }

  if (!isSuperAdmin) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)" }}>Super-admin access only.</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0, fontFamily: "'Kantumruy Pro', sans-serif" }}>
          Seller Applications
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 0" }}>
          Review store applications. Approving provisions the merchant and their owner login automatically.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
            textTransform: "capitalize", fontFamily: "'Kantumruy Pro', sans-serif",
            border: tab === t ? "none" : "1px solid var(--border)",
            background: tab === t ? "#103562" : "var(--bg-card)",
            color: tab === t ? "#fff" : "var(--text-secondary)",
          }}>{t}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)" }}>Loading…</div>
      ) : apps.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--text-secondary)" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🗂️</div>
          No {tab === "all" ? "" : tab} applications.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {apps.map((a) => {
            const st = STATUS_STYLE[a.status] || STATUS_STYLE.pending;
            const canAct = a.status === "pending" || a.status === "under_review";
            return (
              <div key={a.id} style={{
                background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14,
                padding: 18, boxShadow: "var(--shadow-sm)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                    {a.logo_url ? (
                      <img
                        src={a.logo_url}
                        alt={a.store_name}
                        style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)", background: "var(--bg)" }}
                      />
                    ) : (
                      <div style={{
                        width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                        background: "var(--bg)", border: "1px solid var(--border)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 18, color: "var(--text-secondary)", fontWeight: 700,
                      }}>
                        {a.store_name?.charAt(0).toUpperCase() || "🏬"}
                      </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0, fontFamily: "'Kantumruy Pro', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.store_name}
                      </p>
                      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "2px 0 0" }}>
                        {a.seller_type === "company" ? "🏢 Registered Business" : "👤 Individual Seller"}
                      </p>
                    </div>
                  </div>
                  <span style={{ background: st.bg, color: st.fg, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>
                    {st.label}
                  </span>
                </div>

                <div style={{ fontSize: 13, color: "var(--text)", display: "grid", gap: 6, marginBottom: 14 }}>
                  <Row k="Owner" v={a.full_name} />
                  {a.company_name && <Row k="Company" v={a.company_name} />}
                  <Row k="Email" v={a.email} />
                  <Row k="Phone" v={a.phone || "—"} />
                  <Row k="Location" v={[a.address_line1, a.commune, a.district, a.province].filter(Boolean).join(", ") || "—"} />
                  {a.store_description && <Row k="About" v={a.store_description} />}
                  {a.review_note && <Row k="Note" v={a.review_note} />}
                </div>

                {canAct ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => approve(a.id)} disabled={busy === a.id} style={{
                      flex: 1, padding: 10, borderRadius: 8, border: "none", cursor: "pointer",
                      background: "var(--success)", color: "#fff", fontWeight: 600, fontSize: 13,
                      opacity: busy === a.id ? 0.6 : 1,
                    }}>Approve</button>
                    <button onClick={() => reject(a.id)} disabled={busy === a.id} style={{
                      flex: 1, padding: 10, borderRadius: 8, cursor: "pointer",
                      border: "1px solid var(--danger)", background: "transparent", color: "var(--danger)",
                      fontWeight: 600, fontSize: 13, opacity: busy === a.id ? 0.6 : 1,
                    }}>Reject</button>
                  </div>
                ) : a.status === "approved" && a.merchant_id ? (
                  <p style={{ fontSize: 12, color: "var(--success)", margin: 0, fontWeight: 600 }}>
                    ✓ Merchant #{a.merchant_id} created
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {toast.show && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 100,
          background: toast.ok ? "var(--success)" : "var(--danger)", color: "#fff",
          padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, boxShadow: "var(--shadow-lg)",
        }}>{toast.msg}</div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <span style={{ color: "var(--text-secondary)", minWidth: 64, flexShrink: 0 }}>{k}</span>
      <span style={{ color: "var(--text)", fontWeight: 500 }}>{v}</span>
    </div>
  );
}
