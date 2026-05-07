"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { LoginGate } from "@/components/shop/LoginGate";
import { api } from "@/lib/api";
import type { SupportTicket, TicketMessage } from "@/types";

const FAQ = [
  { q: "How do I track my order?", a: "Go to 'My Orders', then select your order to view its current status." },
  { q: "Can I cancel my order?", a: "You can cancel orders in 'pending' status. Once confirmed, contact support." },
  { q: "What payment methods are accepted?", a: "KHQR (all Cambodian banks), Cash on Delivery (COD)." },
  { q: "How long does delivery take?", a: "Typically 3-5 business days depending on location." },
];

const SUBJECTS = ["Order Issue", "Wrong Item", "Refund Request", "General Question", "Other"];

const statusBadge = (status: string) => {
  const map: Record<string, { bg: string; color: string; border: string }> = {
    open: { bg: "#FFF8E1", color: "#F59E0B", border: "#FDE68A" },
    replied: { bg: "var(--shop-primary-tint)", color: "var(--shop-primary)", border: "rgba(30,107,255,0.15)" },
    closed: { bg: "#F3F4F6", color: "var(--shop-muted)", border: "var(--shop-divider)" },
  };
  const s = map[status] || map.closed;
  return {
    display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 700 as const,
    padding: "3px 10px", borderRadius: "var(--shop-r-pill)",
    background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    textTransform: "capitalize" as const, letterSpacing: "0.3px",
  };
};

export default function SupportPage() {
  return <Suspense><SupportContent /></Suspense>;
}

function SupportContent() {
  const searchParams = useSearchParams();
  const ticketId = searchParams.get("ticket");
  if (ticketId) return <TicketChat ticketId={Number(ticketId)} />;
  return <TicketList />;
}

function TicketList() {
  const router = useRouter();
  const { user } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    api.get<SupportTicket[]>("/support/tickets").then(setTickets).catch(() => {}).finally(() => setLoading(false));
  }, [user]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!subject || !message.trim()) return;
    setSending(true);
    try {
      const ticket = await api.post<SupportTicket>("/support/tickets", { subject, message, merchant_id: 1 });
      router.push(`/shop/support?ticket=${ticket.id}`);
    } catch (err: any) { alert(err.detail || "Failed to create ticket"); }
    setSending(false);
  }

  if (!user) return <LoginGate><div /></LoginGate>;

  if (showCreate) {
    return (
      <Page title="New Ticket" onBack={() => setShowCreate(false)}>
        <div style={{
          background: "var(--shop-surface)", borderRadius: "var(--shop-r-card)",
          padding: 20, boxShadow: "var(--shop-shadow)",
        }}>
          <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--shop-text)" }}>
              Subject
              <select value={subject} onChange={e => setSubject(e.target.value)} required
                style={{
                  display: "block", width: "100%", marginTop: 6,
                  padding: "11px 14px", borderRadius: "var(--shop-r-input)",
                  border: "1.5px solid var(--shop-divider)", background: "var(--shop-bg)",
                  color: "var(--shop-black)", fontSize: 14, outline: "none",
                  transition: "border-color 0.2s",
                }}>
                <option value="">Select subject</option>
                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--shop-text)" }}>
              Message
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4}
                placeholder="Describe your issue..." required
                style={{
                  display: "block", width: "100%", marginTop: 6,
                  padding: "11px 14px", borderRadius: "var(--shop-r-input)",
                  border: "1.5px solid var(--shop-divider)", background: "var(--shop-bg)",
                  color: "var(--shop-black)", fontSize: 14, resize: "vertical",
                  outline: "none", lineHeight: 1.5, fontFamily: "inherit",
                  transition: "border-color 0.2s",
                }} />
            </label>
            <button type="submit" disabled={sending}
              style={{
                padding: "13px 20px", borderRadius: "var(--shop-r-input)",
                border: "none", background: "var(--shop-primary)", color: "#fff",
                fontWeight: 600, fontSize: 14, cursor: "pointer",
                opacity: sending ? 0.55 : 1, transition: "opacity 0.2s, background 0.2s",
              }}>
              {sending ? "Sending..." : "Submit Ticket"}
            </button>
            <button type="button" onClick={() => setShowCreate(false)}
              style={{
                background: "none", border: "none", color: "var(--shop-muted)",
                cursor: "pointer", fontSize: 13, fontWeight: 500, padding: 4,
              }}>
              Cancel
            </button>
          </form>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Help & Support">
      <button onClick={() => setShowCreate(true)}
        style={{
          width: "100%", padding: "13px 20px", borderRadius: "var(--shop-r-input)",
          background: "var(--shop-primary)", color: "#fff", fontWeight: 600,
          border: "none", cursor: "pointer", marginBottom: 20, fontSize: 14,
          boxShadow: "0 4px 12px rgba(30,107,255,0.2)", transition: "background 0.2s",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg>
        New Support Ticket
      </button>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2].map(i => (
            <div key={i} style={{
              height: 76, background: "var(--shop-divider)", borderRadius: "var(--shop-r-card)",
              animation: "shopPulse 1.5s ease-in-out infinite",
            }} />
          ))}
        </div>
      ) : tickets.length > 0 ? (
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "var(--shop-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>My Tickets</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tickets.map(t => (
              <button key={t.id} onClick={() => router.push(`/shop/support?ticket=${t.id}`)}
                style={{
                  width: "100%", textAlign: "left",
                  background: "var(--shop-surface)", border: "none",
                  borderRadius: "var(--shop-r-card)", padding: "14px 16px",
                  cursor: "pointer", boxShadow: "var(--shop-shadow)",
                  transition: "transform 0.15s, box-shadow 0.15s",
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{
                    fontSize: 14, fontWeight: 600, color: "var(--shop-black)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 10,
                  }}>{t.subject}</span>
                  <span style={statusBadge(t.status)}>{t.status}</span>
                </div>
                {t.last_message && (
                  <p style={{
                    fontSize: 12, color: "var(--shop-muted)", lineHeight: 1.4,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{t.last_message}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{
          background: "var(--shop-surface)", borderRadius: "var(--shop-r-card)",
          padding: 28, textAlign: "center", marginBottom: 28,
          boxShadow: "var(--shop-shadow)",
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
          <p style={{ fontSize: 13, color: "var(--shop-muted)" }}>No tickets yet</p>
        </div>
      )}

      {/* FAQ */}
      <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "var(--shop-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
        Frequently Asked Questions
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {FAQ.map((faq, i) => (
          <div key={i} style={{
            background: "var(--shop-surface)", borderRadius: "var(--shop-r-card)",
            boxShadow: "var(--shop-shadow)", overflow: "hidden",
            transition: "box-shadow 0.2s",
          }}>
            <button onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
              style={{
                width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "14px 16px", background: "none", border: "none",
                cursor: "pointer", textAlign: "left",
              }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--shop-black)", flex: 1, marginRight: 12 }}>{faq.q}</span>
              <span style={{
                width: 24, height: 24, borderRadius: "50%",
                background: expandedFaq === i ? "var(--shop-primary-tint)" : "var(--shop-bg)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--shop-primary)", fontSize: 10, flexShrink: 0,
                transform: expandedFaq === i ? "rotate(180deg)" : "none",
                transition: "transform 0.25s ease, background 0.25s",
              }}>
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </span>
            </button>
            <div style={{
              maxHeight: expandedFaq === i ? 200 : 0,
              overflow: "hidden",
              transition: "max-height 0.3s ease",
            }}>
              <div style={{ padding: "0 16px 14px" }}>
                <p style={{ fontSize: 13, color: "var(--shop-text)", lineHeight: 1.65 }}>{faq.a}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Contact */}
      <div style={{
        background: "var(--shop-surface)", borderRadius: "var(--shop-r-card)",
        padding: 18, marginTop: 20, boxShadow: "var(--shop-shadow)",
        display: "flex", alignItems: "center", gap: 14,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: "var(--shop-primary-tint)", display: "flex",
          alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="var(--shop-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--shop-black)", marginBottom: 2 }}>Contact Us</h3>
          <p style={{ fontSize: 12, color: "var(--shop-text)" }}>support@favouriteofshop.com</p>
          <p style={{ fontSize: 11, color: "var(--shop-muted)", marginTop: 2 }}>Mon-Fri, 9AM-6PM (Cambodia)</p>
        </div>
      </div>

      <style>{`
        @keyframes shopPulse{0%,100%{opacity:1}50%{opacity:.4}}
        button:active{transform:scale(0.98)!important}
      `}</style>
    </Page>
  );
}

function TicketChat({ ticketId }: { ticketId: number }) {
  const router = useRouter();
  const { user } = useAuth();
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const countRef = useRef(0);

  useEffect(() => {
    loadTicket();
    const poll = setInterval(pollMessages, 3000);
    return () => clearInterval(poll);
  }, [ticketId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function loadTicket() {
    try {
      const data = await api.get<SupportTicket & { messages: TicketMessage[] }>(`/support/tickets/${ticketId}`);
      setTicket(data);
      setMessages(data.messages || []);
      countRef.current = (data.messages || []).length;
    } catch { router.push("/shop/support"); }
    setLoading(false);
  }

  async function pollMessages() {
    try {
      const data = await api.get<SupportTicket & { messages: TicketMessage[] }>(`/support/tickets/${ticketId}`);
      if ((data.messages || []).length !== countRef.current) {
        setMessages(data.messages || []);
        setTicket(data);
        countRef.current = (data.messages || []).length;
      }
    } catch { /* silent */ }
  }

  async function handleSend() {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/support/tickets/${ticketId}/messages`, { message: reply });
      setReply("");
      await loadTicket();
    } catch (err: any) { alert(err.detail || "Failed to send"); }
    setSending(false);
  }

  if (loading) return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--shop-bg)" }}>
      <div style={{ height: 56, background: "var(--shop-surface)", borderBottom: "1px solid var(--shop-divider)" }} />
      <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{
            height: 48, background: "var(--shop-divider)", borderRadius: 16,
            width: i % 2 === 0 ? "60%" : "70%",
            alignSelf: i % 2 === 0 ? "flex-end" : "flex-start",
            animation: "shopPulse 1.5s ease-in-out infinite",
          }} />
        ))}
      </div>
      <style>{`@keyframes shopPulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--shop-bg)" }}>
      {/* Header - 56px */}
      <div style={{
        height: 56, minHeight: 56,
        padding: "0 16px",
        borderBottom: "1px solid var(--shop-divider)",
        background: "var(--shop-surface)",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <button onClick={() => router.push("/shop/support")}
          style={{
            background: "none", border: "none", cursor: "pointer",
            width: 32, height: 32, borderRadius: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--shop-black)",
          }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontSize: 15, fontWeight: 600, color: "var(--shop-black)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{ticket?.subject}</p>
          {ticket?.order_id && <p style={{ fontSize: 11, color: "var(--shop-muted)" }}>Order #{ticket.order_id}</p>}
        </div>
        <span style={statusBadge(ticket?.status || "open")}>{ticket?.status}</span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px" }}>
        {messages.map(msg => {
          const isCustomer = msg.sender_type === "customer";
          return (
            <div key={msg.id} style={{
              display: "flex",
              justifyContent: isCustomer ? "flex-end" : "flex-start",
              marginBottom: 10,
            }}>
              {!isCustomer && (
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", marginRight: 8, marginTop: 2, flexShrink: 0,
                  background: "var(--shop-primary-tint)", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="var(--shop-primary)"/></svg>
                </div>
              )}
              <div style={{
                maxWidth: "75%", padding: "10px 14px",
                borderRadius: 16,
                background: isCustomer ? "var(--shop-primary)" : "var(--shop-surface)",
                border: isCustomer ? "none" : "1px solid var(--shop-divider)",
                borderBottomRightRadius: isCustomer ? 4 : 16,
                borderBottomLeftRadius: isCustomer ? 16 : 4,
                boxShadow: isCustomer ? "0 2px 8px rgba(30,107,255,0.2)" : "var(--shop-shadow)",
              }}>
                <p style={{
                  fontSize: 10, fontWeight: 700, marginBottom: 3, letterSpacing: "0.3px",
                  color: isCustomer ? "rgba(255,255,255,0.7)" : "var(--shop-muted)",
                }}>
                  {isCustomer ? "You" : "Support"}
                </p>
                <p style={{
                  fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.5,
                  color: isCustomer ? "#fff" : "var(--shop-black)",
                }}>{msg.body}</p>
                <p style={{
                  fontSize: 9, marginTop: 4,
                  color: isCustomer ? "rgba(255,255,255,0.5)" : "var(--shop-muted)",
                }}>
                  {msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Input */}
      {ticket?.status !== "closed" ? (
        <div style={{
          padding: "10px 16px",
          borderTop: "1px solid var(--shop-divider)",
          background: "var(--shop-surface)",
          display: "flex", alignItems: "center", gap: 8,
          paddingBottom: "max(10px, env(safe-area-inset-bottom))",
        }}>
          <input type="text" value={reply} onChange={e => setReply(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Type a message..." disabled={sending}
            style={{
              flex: 1, padding: "10px 16px",
              borderRadius: "var(--shop-r-pill)",
              border: "1.5px solid var(--shop-divider)",
              background: "var(--shop-bg)", color: "var(--shop-black)",
              fontSize: 14, outline: "none", transition: "border-color 0.2s",
            }} />
          <button onClick={handleSend} disabled={sending || !reply.trim()}
            style={{
              width: 40, height: 40, borderRadius: "50%", border: "none",
              background: "var(--shop-primary)", color: "#fff",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              opacity: sending || !reply.trim() ? 0.35 : 1,
              transition: "opacity 0.2s, transform 0.15s",
              boxShadow: "0 2px 8px rgba(30,107,255,0.25)",
              flexShrink: 0,
            }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M22 2l-7 20-4-9-9-4 20-7z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      ) : (
        <div style={{
          padding: "14px 16px", borderTop: "1px solid var(--shop-divider)",
          textAlign: "center", background: "var(--shop-surface)",
        }}>
          <p style={{ fontSize: 12, color: "var(--shop-muted)", fontWeight: 500 }}>This conversation is closed</p>
        </div>
      )}

      <style>{`@keyframes shopPulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}

function Page({ title, children, onBack }: { title: string; children: React.ReactNode; onBack?: () => void }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg)" }}>
      {/* Top bar */}
      <div style={{
        height: 56, padding: "0 16px",
        background: "var(--shop-surface)",
        borderBottom: "1px solid var(--shop-divider)",
        display: "flex", alignItems: "center", gap: 12,
        position: "sticky", top: 0, zIndex: 10,
      }}>
        {onBack && (
          <button onClick={onBack} style={{
            background: "none", border: "none", cursor: "pointer",
            width: 32, height: 32, borderRadius: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--shop-black)",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        )}
        <h1 style={{ fontSize: 17, fontWeight: 700, color: "var(--shop-black)" }}>{title}</h1>
      </div>
      <div style={{ padding: "16px 16px 80px" }}>
        {children}
      </div>
    </div>
  );
}

function Empty({ icon, msg }: { icon: string; msg: string }) {
  return (
    <div style={{ textAlign: "center", paddingTop: 80 }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>{icon}</div>
      <p style={{ color: "var(--shop-muted)", fontSize: 14 }}>{msg}</p>
    </div>
  );
}
