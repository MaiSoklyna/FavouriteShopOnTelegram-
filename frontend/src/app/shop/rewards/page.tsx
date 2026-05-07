"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { LoginGate } from "@/components/shop/LoginGate";
import { api } from "@/lib/api";
import type { LoyaltyAccount } from "@/types";

const TIERS: Record<string, { color: string; gradient: string; label: string; icon: string }> = {
  bronze: { color: "#CD7F32", gradient: "linear-gradient(135deg, #C67B30 0%, #8B5E2B 100%)", label: "Bronze", icon: "🥉" },
  silver: { color: "#C0C0C0", gradient: "linear-gradient(135deg, #B0B8C4 0%, #7B8794 100%)", label: "Silver", icon: "🥈" },
  gold: { color: "#FFD700", gradient: "linear-gradient(135deg, #F5C842 0%, #D4960A 100%)", label: "Gold", icon: "🥇" },
};

interface PointsTransaction { id: number; type: string; points: number; description?: string; created_at: string; }

export default function RewardsPage() {
  const { user } = useAuth();
  const [account, setAccount] = useState<LoyaltyAccount | null>(null);
  const [history, setHistory] = useState<PointsTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    Promise.all([
      api.get<LoyaltyAccount>("/loyalty/account"),
      api.get<PointsTransaction[]>("/loyalty/history", { params: { limit: 20 } }),
    ]).then(([acct, hist]) => { setAccount(acct); setHistory(hist || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return <LoginGate><div /></LoginGate>;
  if (loading) return <Page><Skeleton /></Page>;
  if (!account?.enabled) return <Page><Empty icon="🎁" msg="Rewards program coming soon!" /></Page>;

  const tier = TIERS[account.tier] || TIERS.bronze;
  const progress = account.next_tier
    ? Math.min(100, Math.round((account.lifetime_points / (account.lifetime_points + (account.points_to_next || 0))) * 100))
    : 100;

  const tabs = ["overview", "history", "how-it-works"];

  return (
    <Page>
      {/* Hero Card */}
      <div style={{
        background: tier.gradient,
        borderRadius: 20, padding: 22, color: "#fff",
        marginBottom: 20, position: "relative", overflow: "hidden",
        boxShadow: "0 8px 28px rgba(0,0,0,0.15)",
      }}>
        {/* Decorative circles */}
        <div style={{ position: "absolute", right: -30, top: -30, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
        <div style={{ position: "absolute", right: 40, bottom: -20, width: 60, height: 60, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />

        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18, position: "relative" }}>
          <div>
            <p style={{ fontSize: 11, opacity: 0.7, fontWeight: 500, letterSpacing: "0.5px", textTransform: "uppercase" }}>Your Tier</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 28 }}>{tier.icon}</span>
              <span style={{ fontSize: 22, fontWeight: 700 }}>{tier.label}</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 11, opacity: 0.7, fontWeight: 500, letterSpacing: "0.5px", textTransform: "uppercase" }}>Balance</p>
            <p style={{ fontSize: 30, fontWeight: 700, marginTop: 4, lineHeight: 1 }}>{account.balance.toLocaleString()}</p>
            <p style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>points</p>
          </div>
        </div>

        {account.next_tier && (
          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.75, marginBottom: 6, fontWeight: 500 }}>
              <span>{account.lifetime_points.toLocaleString()} lifetime pts</span>
              <span>{(account.points_to_next || 0).toLocaleString()} to {TIERS[account.next_tier]?.label}</span>
            </div>
            <div style={{ height: 6, background: "rgba(255,255,255,0.2)", borderRadius: "var(--shop-r-pill)", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: "var(--shop-r-pill)",
                width: `${progress}%`, transition: "width 0.6s ease",
                background: "rgba(255,255,255,0.9)",
              }} />
            </div>
          </div>
        )}
        {!account.next_tier && (
          <p style={{ fontSize: 12, opacity: 0.8, marginTop: 4, fontWeight: 500 }}>
            Highest tier reached!
          </p>
        )}
      </div>

      {/* Pill Tabs */}
      <div style={{
        display: "flex", gap: 4,
        background: "var(--shop-divider)", borderRadius: "var(--shop-r-pill)",
        padding: 3, marginBottom: 18,
      }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              flex: 1, padding: "9px 4px",
              borderRadius: "var(--shop-r-pill)",
              fontSize: 12, fontWeight: tab === t ? 600 : 500,
              background: tab === t ? "var(--shop-primary)" : "transparent",
              color: tab === t ? "#fff" : "var(--shop-muted)",
              border: "none", cursor: "pointer",
              transition: "background 0.25s, color 0.25s",
            }}>
            {t === "how-it-works" ? "How It Works" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
          <StatCard label="Earn Rate" value={`${account.multiplier || 1}x`} sub="per $1 spent" icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="var(--shop-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          } />
          <StatCard label="Lifetime" value={account.lifetime_points.toLocaleString()} sub="total earned" icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="var(--shop-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          } />
        </div>
      )}

      {/* History Tab */}
      {tab === "history" && (
        history.length === 0 ? (
          <div style={{
            background: "var(--shop-surface)", borderRadius: "var(--shop-r-card)",
            padding: 32, textAlign: "center", boxShadow: "var(--shop-shadow)",
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
            <p style={{ fontSize: 13, color: "var(--shop-muted)" }}>No transactions yet. Start shopping!</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {history.map(tx => {
              const isEarn = tx.points > 0;
              return (
                <div key={tx.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  background: "var(--shop-surface)", borderRadius: "var(--shop-r-card)",
                  padding: "12px 14px", boxShadow: "var(--shop-shadow)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: isEarn ? "#ECFDF5" : "#FEF2F2",
                      flexShrink: 0,
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        {isEarn ? (
                          <path d="M12 5v14M5 12h14" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round"/>
                        ) : (
                          <path d="M5 12h14" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round"/>
                        )}
                      </svg>
                    </div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--shop-black)", textTransform: "capitalize" }}>{tx.type}</p>
                      {tx.description && <p style={{ fontSize: 11, color: "var(--shop-muted)", marginTop: 1 }}>{tx.description}</p>}
                    </div>
                  </div>
                  <span style={{
                    fontWeight: 700, fontSize: 14,
                    color: isEarn ? "#16A34A" : "#DC2626",
                  }}>
                    {isEarn ? "+" : ""}{tx.points}
                  </span>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* How It Works Tab */}
      {tab === "how-it-works" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { title: "Shop & Earn", desc: "Earn points for every dollar spent. Higher tiers earn more!", iconPath: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" },
            { title: "Level Up", desc: "Accumulate lifetime points to unlock Silver and Gold tiers.", iconPath: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" },
            { title: "Redeem Rewards", desc: "Use points for discounts at checkout.", iconPath: "M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" },
          ].map((item, i) => (
            <div key={i} style={{
              display: "flex", gap: 14, alignItems: "flex-start",
              background: "var(--shop-surface)", borderRadius: "var(--shop-r-card)",
              padding: 16, boxShadow: "var(--shop-shadow)",
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: "var(--shop-primary-tint)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d={item.iconPath} stroke="var(--shop-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--shop-black)", marginBottom: 3 }}>{item.title}</p>
                <p style={{ fontSize: 12, color: "var(--shop-text)", lineHeight: 1.55 }}>{item.desc}</p>
              </div>
            </div>
          ))}

          {/* Tier Benefits Card */}
          <div style={{
            background: "var(--shop-surface)", borderRadius: "var(--shop-r-card)",
            padding: 18, boxShadow: "var(--shop-shadow)", marginTop: 4,
          }}>
            <h3 style={{
              fontSize: 14, fontWeight: 700, color: "var(--shop-black)",
              marginBottom: 14,
            }}>Tier Benefits</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(TIERS).map(([key, cfg]) => {
                const isActive = account.tier === key;
                return (
                  <div key={key} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 12px", borderRadius: "var(--shop-r-input)",
                    background: isActive ? "var(--shop-primary-tint)" : "var(--shop-bg)",
                    border: isActive ? "1.5px solid rgba(30,107,255,0.2)" : "1.5px solid transparent",
                    transition: "background 0.2s",
                  }}>
                    <span style={{ fontSize: 22 }}>{cfg.icon}</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--shop-black)" }}>{cfg.label}</p>
                      <p style={{ fontSize: 11, color: "var(--shop-muted)" }}>
                        {key === "bronze" ? "Base earn rate" : key === "silver" ? "1.5x multiplier" : "2x multiplier"}
                      </p>
                    </div>
                    {isActive && (
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        background: "var(--shop-primary)", color: "#fff",
                        padding: "3px 10px", borderRadius: "var(--shop-r-pill)",
                      }}>Current</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg)" }}>
      <div style={{
        height: 56, padding: "0 16px",
        background: "var(--shop-surface)",
        borderBottom: "1px solid var(--shop-divider)",
        display: "flex", alignItems: "center",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: "var(--shop-black)" }}>Rewards</h1>
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

function Skeleton() {
  return (
    <div>
      {[140, 48, 80, 80].map((h, i) => (
        <div key={i} style={{
          height: h, background: "var(--shop-divider)",
          borderRadius: "var(--shop-r-card)", marginBottom: 10,
          animation: "shopPulse 1.5s ease-in-out infinite",
        }} />
      ))}
      <style>{`@keyframes shopPulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--shop-surface)", borderRadius: "var(--shop-r-card)",
      padding: 16, boxShadow: "var(--shop-shadow)",
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, marginBottom: 10,
        background: "var(--shop-primary-tint)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {icon}
      </div>
      <p style={{ fontSize: 11, color: "var(--shop-muted)", fontWeight: 500 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 700, color: "var(--shop-black)", marginTop: 2 }}>{value}</p>
      <p style={{ fontSize: 11, color: "var(--shop-text)", marginTop: 1 }}>{sub}</p>
    </div>
  );
}
