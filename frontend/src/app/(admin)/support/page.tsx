"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { SupportTicket, TicketMessage } from "@/types";

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function load() { try { setTickets(await api.get<SupportTicket[]>("/support/admin/tickets", { params: filter ? { status: filter } : undefined })); } catch { /* */ } finally { setLoading(false); } }
  useEffect(() => { load(); }, [filter]);
  useAutoRefresh(load, { interval: 10000 });

  async function openTicket(t: SupportTicket) {
    setActive(t);
    try {
      const data = await api.get<SupportTicket & { messages: TicketMessage[] }>(`/support/tickets/${t.id}`);
      setMessages(data.messages || []);
      setActive(data);
    } catch { /* */ }
  }

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendReply() {
    if (!reply.trim() || !active) return;
    setSending(true);
    try {
      await api.post(`/support/tickets/${active.id}/messages`, { message: reply });
      setReply("");
      const data = await api.get<SupportTicket & { messages: TicketMessage[] }>(`/support/tickets/${active.id}`);
      setMessages(data.messages || []);
      setActive(data);
      load();
    } catch { /* */ }
    setSending(false);
  }

  async function closeTicket(id: number) { await api.patch(`/support/admin/tickets/${id}/close`); load(); if (active?.id === id) setActive(a => a ? { ...a, status: "closed" } : a); }

  return (
    <div style={{ display: "flex", height: "calc(100vh - 48px)", gap: 16 }}>
      {/* Ticket list */}
      <div style={{ width: 340, flexShrink: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>Support</h1>
        </div>
        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          {["", "open", "replied", "closed"].map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500, background: filter === s ? "var(--accent)" : "var(--bg-secondary)", color: filter === s ? "var(--bg)" : "var(--text-muted)", border: "none", cursor: "pointer", textTransform: "capitalize" }}>
              {s || "All"}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? <p style={{ color: "var(--text-muted)", padding: 20, textAlign: "center" }}>Loading...</p> :
          tickets.length === 0 ? <p style={{ color: "var(--text-muted)", padding: 20, textAlign: "center" }}>No tickets</p> :
          tickets.map(t => (
            <button key={t.id} onClick={() => openTicket(t)}
              style={{ width: "100%", textAlign: "left", padding: 12, marginBottom: 4, borderRadius: 8, background: active?.id === t.id ? "var(--accent-light)" : "var(--bg-card)", border: active?.id === t.id ? "1px solid var(--accent)" : "1px solid var(--border)", cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{t.subject}</span>
                <span className={`badge badge-${t.status}`} style={{ marginLeft: 8, fontSize: 9 }}>{t.status}</span>
              </div>
              <p style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.customer_name || t.customer_username}</p>
              {t.last_message && <p style={{ fontSize: 10, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{t.last_message}</p>}
            </button>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        {!active ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
            <p>Select a ticket to view</p>
          </div>
        ) : (
          <>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{active.subject}</p>
                <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{active.customer_name} {active.order_id ? `| Order #${active.order_id}` : ""}</p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <span className={`badge badge-${active.status}`}>{active.status}</span>
                {active.status !== "closed" && <button onClick={() => closeTicket(active.id)} className="btn-outline" style={{ padding: "4px 10px", fontSize: 11 }}>Close</button>}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {messages.map(m => (
                <div key={m.id} style={{ display: "flex", justifyContent: m.sender_type === "customer" ? "flex-start" : "flex-end", marginBottom: 10 }}>
                  <div style={{ maxWidth: "70%", padding: "8px 14px", borderRadius: 12, background: m.sender_type === "merchant" ? "var(--accent-light)" : "var(--bg-secondary)", borderBottomLeftRadius: m.sender_type === "customer" ? 4 : 12, borderBottomRightRadius: m.sender_type === "merchant" ? 4 : 12 }}>
                    <p style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", marginBottom: 2 }}>{m.sender_type === "customer" ? "Customer" : "You"}</p>
                    <p style={{ fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap" }}>{m.body}</p>
                    <p style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4 }}>{m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</p>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            {active.status !== "closed" && (
              <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
                <input className="admin-input" style={{ flex: 1 }} value={reply} onChange={e => setReply(e.target.value)} placeholder="Type a reply..." onKeyDown={e => { if (e.key === "Enter") sendReply(); }} disabled={sending} />
                <button className="btn-primary" onClick={sendReply} disabled={sending || !reply.trim()}>Send</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
