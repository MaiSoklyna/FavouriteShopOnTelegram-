"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { User } from "@/types";

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<User | null>(null);

  async function load() { try { setUsers(await api.get<User[]>("/users", { params: search ? { search } : undefined })); } catch { /* */ } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [search]);

  async function openDetail(id: number) { try { setDetail(await api.get<User>(`/users/${id}`)); } catch { /* */ } }
  async function toggleStatus(id: number, active: boolean) { await api.patch(`/users/${id}/status`, { is_active: active }); setDetail(null); load(); }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div><h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Customers</h1><p style={{ fontSize: 13, color: "var(--text-muted)" }}>{users.length} users</p></div>
      </div>
      <input className="admin-input" style={{ maxWidth: 300, marginBottom: 16 }} placeholder="Search by name..." value={search} onChange={e => setSearch(e.target.value)} />

      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div> : (
          <table className="admin-table">
            <thead><tr><th>User</th><th>Phone</th><th>Language</th><th>Status</th><th>Joined</th><th></th></tr></thead>
            <tbody>
              {users.length === 0 ? <tr><td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No users</td></tr> :
              users.map(u => (
                <tr key={u.id}>
                  <td><p style={{ fontWeight: 600 }}>{u.first_name || u.username || `#${u.id}`}{u.last_name ? ` ${u.last_name}` : ""}</p><p style={{ fontSize: 10, color: "var(--text-muted)" }}>@{u.username || "—"}</p></td>
                  <td>{u.phone || u.email || "—"}</td>
                  <td>{u.language || "—"}</td>
                  <td><span className={`badge ${u.is_active !== false ? "badge-delivered" : "badge-cancelled"}`}>{u.is_active !== false ? "Active" : "Banned"}</span></td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}</td>
                  <td><button onClick={() => openDetail(u.id)} style={{ background: "none", border: "none", color: "var(--info)", fontWeight: 500, fontSize: 12, cursor: "pointer" }}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal-content" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <div><h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{detail.first_name || detail.username || `User #${detail.id}`}</h2><p style={{ fontSize: 11, color: "var(--text-muted)" }}>@{detail.username || "—"}</p></div>
              <span className={`badge ${detail.is_active !== false ? "badge-delivered" : "badge-cancelled"}`}>{detail.is_active !== false ? "Active" : "Banned"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, marginBottom: 16 }}>
              <div><span style={{ color: "var(--text-muted)" }}>Telegram: </span>{detail.telegram_id || "—"}</div>
              <div><span style={{ color: "var(--text-muted)" }}>Phone: </span>{detail.phone || "—"}</div>
              <div><span style={{ color: "var(--text-muted)" }}>Email: </span>{detail.email || "—"}</div>
              <div><span style={{ color: "var(--text-muted)" }}>Language: </span>{detail.language || "—"}</div>
              {detail.address && <div style={{ gridColumn: "1/3" }}><span style={{ color: "var(--text-muted)" }}>Address: </span>{detail.address}</div>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => toggleStatus(detail.id, !detail.is_active)} className={detail.is_active !== false ? "btn-danger" : "btn-primary"}>{detail.is_active !== false ? "Ban User" : "Unban"}</button>
              <button className="btn-outline" style={{ flex: 1 }} onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
