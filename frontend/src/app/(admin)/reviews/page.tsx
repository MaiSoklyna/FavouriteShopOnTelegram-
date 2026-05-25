"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import type { Review } from "@/types";

const TABS = ["pending", "approved", "all"] as const;
type Tab = (typeof TABS)[number];

export default function ReviewsPage() {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });

  const flash = (msg: string, ok = true) => {
    setToast({ show: true, msg, ok });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000);
  };

  const load = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (tab !== "all") params.status = tab;
      const data = await api.get<Review[]>("/reviews/admin/list", { params });
      setReviews(data);
    } catch {
      flash("Failed to load reviews", false);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [tab, load]);

  async function approve(id: number) {
    try {
      await api.patch(`/reviews/admin/${id}/approve`);
      flash("Review approved");
      load();
    } catch {
      flash("Failed to approve", false);
    }
  }

  async function reject(id: number) {
    try {
      await api.patch(`/reviews/admin/${id}/reject`);
      flash("Review rejected");
      load();
    } catch {
      flash("Failed to reject", false);
    }
  }

  async function deleteReview(id: number) {
    if (!confirm("Delete this review permanently?")) return;
    try {
      await api.delete(`/reviews/${id}`);
      flash("Review deleted");
      load();
    } catch {
      flash("Failed to delete", false);
    }
  }

  function renderStars(rating: number) {
    return (
      <span style={{ fontSize: 14, letterSpacing: 1 }}>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} style={{ color: i < rating ? "var(--warning)" : "var(--border)" }}>
            ★
          </span>
        ))}
      </span>
    );
  }

  const stats = {
    total: reviews.length,
    pending: reviews.filter((r) => !r.is_approved).length,
    approved: reviews.filter((r) => r.is_approved).length,
  };

  return (
    <div>
      {toast.show && (
        <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Reviews</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Manage customer reviews &amp; approval
          </p>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { l: "Showing", v: reviews.length, c: "var(--text)" },
          { l: "Pending", v: stats.pending, c: "var(--warning)" },
          { l: "Approved", v: stats.approved, c: "var(--success)" },
        ].map((s) => (
          <div key={s.l} className="admin-card">
            <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.l}</p>
            <p style={{ fontSize: 24, fontWeight: 700, color: s.c }}>{s.v}</p>
          </div>
        ))}
      </div>

      {/* Tab pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 500,
              textTransform: "capitalize",
              background: tab === t ? "var(--accent)" : "var(--bg-secondary)",
              color: tab === t ? "var(--bg)" : "var(--text-secondary)",
              border: "none",
              cursor: "pointer",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Customer</th>
                <th>Rating</th>
                <th>Comment</th>
                <th>Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {reviews.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                    {tab === "pending"
                      ? "No pending reviews — all caught up!"
                      : tab === "approved"
                        ? "No approved reviews yet"
                        : "No reviews found"}
                  </td>
                </tr>
              ) : (
                reviews.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{r.product_name || `Product #${r.product_id}`}</td>
                    <td>{r.user_name || `User #${r.user_id}`}</td>
                    <td>{renderStars(r.rating)}</td>
                    <td>
                      <p
                        style={{
                          maxWidth: 260,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          fontSize: 12,
                          color: "var(--text-secondary)",
                          margin: 0,
                        }}
                        title={r.comment || ""}
                      >
                        {r.comment || <em style={{ color: "var(--text-muted)" }}>No comment</em>}
                      </p>
                    </td>
                    <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background: r.is_approved ? "var(--success)" : "var(--warning)",
                          color: "#fff",
                        }}
                      >
                        {r.is_approved ? "Approved" : "Pending"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {!r.is_approved && (
                          <button
                            onClick={() => approve(r.id)}
                            style={{
                              padding: "4px 10px",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 600,
                              background: "var(--success)",
                              color: "#fff",
                              border: "none",
                              cursor: "pointer",
                            }}
                          >
                            Approve
                          </button>
                        )}
                        {r.is_approved && (
                          <button
                            onClick={() => reject(r.id)}
                            style={{
                              padding: "4px 10px",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 600,
                              background: "var(--warning)",
                              color: "#fff",
                              border: "none",
                              cursor: "pointer",
                            }}
                          >
                            Reject
                          </button>
                        )}
                        <button
                          onClick={() => deleteReview(r.id)}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            background: "var(--danger)",
                            color: "#fff",
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
