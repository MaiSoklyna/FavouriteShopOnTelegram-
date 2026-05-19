"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { LoginGate } from "@/components/shop/LoginGate";
import { api } from "@/lib/api";
import type { LoyaltyAccount, LoyaltySettings } from "@/types";

const TIERS: Record<string, { color: string; gradient: string; label: string; icon: string }> = {
  bronze: { color: "#CD7F32", gradient: "linear-gradient(135deg, #C67B30 0%, #8B5E2B 100%)", label: "Bronze", icon: "🥉" },
  silver: { color: "#C0C0C0", gradient: "linear-gradient(135deg, #B0B8C4 0%, #7B8794 100%)", label: "Silver", icon: "🥈" },
  gold: { color: "#FFD700", gradient: "linear-gradient(135deg, #F5C842 0%, #D4960A 100%)", label: "Gold", icon: "🥇" },
};

interface PointsTransaction { id: number; type: string; points: number; description?: string; created_at: string; }

export default function RewardsPage() {
  const { user } = useAuth();
  const [account, setAccount] = useState<LoyaltyAccount | null>(null);
  const [settings, setSettings] = useState<LoyaltySettings | null>(null);
  const [history, setHistory] = useState<PointsTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    Promise.all([
      api.get<LoyaltyAccount>("/loyalty/account"),
      api.get<PointsTransaction[]>("/loyalty/history", { params: { limit: 20 } }),
      api.get<LoyaltySettings>("/loyalty/settings").catch(() => null),
    ]).then(([acct, hist, cfg]) => {
      setAccount(acct);
      setHistory(hist || []);
      setSettings(cfg || null);
    })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return <LoginGate><div /></LoginGate>;
  if (loading) return <Page><Skeleton /></Page>;
  if (!account?.enabled) return <Page><Empty icon="🎁" msg="Rewards program coming soon!" /></Page>;

  const tier = TIERS[account.tier] || TIERS.bronze;

  // Thresholds & multipliers from settings (with fallbacks if /loyalty/settings is unavailable)
  const silverAt = settings?.silver_threshold ?? 500;
  const goldAt = settings?.gold_threshold ?? 2000;
  const pointsPerDollar = settings?.points_per_dollar ?? 10;
  const pointValueCents = settings?.points_value_cents ?? 1;
  const minRedeem = settings?.min_redeem_points ?? 100;
  const silverMult = settings?.silver_multiplier ?? 1.5;
  const goldMult = settings?.gold_multiplier ?? 2.0;

  // Progress is from the START of the current tier to the start of the next tier.
  const tierStart = account.tier === "bronze" ? 0 : account.tier === "silver" ? silverAt : goldAt;
  const nextStart = account.next_tier === "silver" ? silverAt : account.next_tier === "gold" ? goldAt : null;
  const progress = nextStart !== null && nextStart > tierStart
    ? Math.min(100, Math.max(0, Math.round(((account.lifetime_points - tierStart) / (nextStart - tierStart)) * 100)))
    : 100;

  const nextMultiplier = account.next_tier === "silver" ? silverMult : account.next_tier === "gold" ? goldMult : null;

  // Balance value in dollars (whole cents).
  const balanceDollars = (account.balance * pointValueCents / 100);
  const canRedeem = account.balance >= minRedeem;
  const pointsToMinRedeem = Math.max(0, minRedeem - account.balance);
  const minRedeemDollars = (minRedeem * pointValueCents / 100);

  const tabs = ["overview", "history", "how-it-works"];

  // Tier benefit text driven by real settings
  const tierBenefitLine = (key: string) => {
    if (key === "bronze") return `Base rate · earn ${pointsPerDollar} pts per $1`;
    if (key === "silver") return `${silverMult}× multiplier · ${Math.round(pointsPerDollar * silverMult)} pts per $1`;
    return `${goldMult}× multiplier · ${Math.round(pointsPerDollar * goldMult)} pts per $1`;
  };
  const tierThresholdLabel = (key: string) => {
    if (key === "bronze") return "Starting tier";
    if (key === "silver") return `Reach ${silverAt.toLocaleString()} lifetime pts`;
    return `Reach ${goldAt.toLocaleString()} lifetime pts`;
  };

  return (
    <Page>
      {/* Hero Card */}
      <div style={{
        background: tier.gradient,
        borderRadius: 20, padding: 22, color: "#fff",
        marginBottom: 14, position: "relative", overflow: "hidden",
        boxShadow: "0 8px 28px rgba(0,0,0,0.15)",
      }}>
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
            <p style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>
              points · worth ${balanceDollars.toFixed(2)}
            </p>
          </div>
        </div>

        {account.next_tier && nextStart !== null ? (
          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.85, marginBottom: 6, fontWeight: 500 }}>
              <span>
                {account.lifetime_points.toLocaleString()} / {nextStart.toLocaleString()} pts
              </span>
              <span>
                {account.points_to_next?.toLocaleString() || 0} to {TIERS[account.next_tier]?.label}
                {nextMultiplier ? ` (${nextMultiplier}×)` : ""}
              </span>
            </div>
            <div style={{ height: 6, background: "rgba(255,255,255,0.2)", borderRadius: "var(--shop-r-pill)", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: "var(--shop-r-pill)",
                width: `${progress}%`, transition: "width 0.6s ease",
                background: "rgba(255,255,255,0.95)",
              }} />
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 12, opacity: 0.85, marginTop: 4, fontWeight: 500 }}>
            🏆 You reached the top tier!
          </p>
        )}
      </div>

      {/* Redeem readiness banner */}
      <div style={{
        background: canRedeem ? "linear-gradient(135deg, #DCFCE7, #BBF7D0)" : "var(--shop-surface)",
        border: canRedeem ? "1px solid #86EFAC" : "1px solid var(--shop-divider)",
        borderRadius: "var(--shop-r-card)",
        padding: "12px 14px", marginBottom: 18,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        boxShadow: "var(--shop-shadow)",
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: canRedeem ? "#166534" : "var(--shop-black)" }}>
            {canRedeem ? "Ready to redeem at checkout" : `Earn ${pointsToMinRedeem.toLocaleString()} more pts to redeem`}
          </p>
          <p style={{ fontSize: 11, color: canRedeem ? "#166534" : "var(--shop-muted)", marginTop: 2 }}>
            {canRedeem
              ? `Use up to ${account.balance.toLocaleString()} pts for $${balanceDollars.toFixed(2)} off your next order.`
              : `${minRedeem.toLocaleString()} pts ($${minRedeemDollars.toFixed(2)}) minimum redemption.`}
          </p>
        </div>
        <span style={{
          fontSize: 22,
          opacity: canRedeem ? 1 : 0.5,
        }}>{canRedeem ? "🎉" : "🔒"}</span>
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
          <StatCard
            label="Earn Rate"
            value={`${Math.round(pointsPerDollar * (account.multiplier || 1))} pts`}
            sub={`per $1 · ${account.multiplier && account.multiplier > 1 ? `${account.multiplier}× bonus` : "base rate"}`}
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="var(--shop-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }
          />
          <StatCard
            label="Lifetime"
            value={account.lifetime_points.toLocaleString()}
            sub="total earned"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="var(--shop-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }
          />
          <StatCard
            label="Balance worth"
            value={`$${balanceDollars.toFixed(2)}`}
            sub={`${account.balance.toLocaleString()} pts`}
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6" stroke="var(--shop-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }
          />
          <StatCard
            label="Min redeem"
            value={`${minRedeem.toLocaleString()} pts`}
            sub={`= $${minRedeemDollars.toFixed(2)} off`}
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 6h18l-2 13H5L3 6zM3 6L2 2H0M9 10v6M15 10v6" stroke="var(--shop-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }
          />
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
            {
              title: "Shop & Earn",
              desc: `Earn ${pointsPerDollar} points for every $1 you spend. Higher tiers earn even more.`,
              iconPath: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z",
            },
            {
              title: "Level Up",
              desc: `Earn ${silverAt.toLocaleString()} lifetime points to reach Silver (${silverMult}×) and ${goldAt.toLocaleString()} for Gold (${goldMult}×).`,
              iconPath: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
            },
            {
              title: "Redeem at Checkout",
              desc: `Spend ${minRedeem.toLocaleString()}+ points for $${minRedeemDollars.toFixed(2)} off or more. Every ${(100 / pointValueCents).toFixed(0)} points = $1 discount.`,
              iconPath: "M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7",
            },
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
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--shop-black)" }}>{cfg.label}</p>
                      <p style={{ fontSize: 11, color: "var(--shop-muted)" }}>{tierBenefitLine(key)}</p>
                      <p style={{ fontSize: 10.5, color: "var(--shop-muted)", marginTop: 1, opacity: 0.85 }}>
                        {tierThresholdLabel(key)}
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
