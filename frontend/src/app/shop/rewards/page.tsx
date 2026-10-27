"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/providers/AuthProvider";
import { LoginGate } from "@/components/shop/LoginGate";
import { api } from "@/lib/api";
import type { LoyaltyAccount, LoyaltySettings } from "@/types";
import { Icon, type IconName } from "@/components/shop/Icon";

/** Hero card look per tier: the balance sits on the tier's metal */
const TIERS: Record<string, { label: string; color: string; card: string; ink: string; soft: string; bar: string }> = {
  bronze: { label: "Bronze", color: "#B9762F", card: "linear-gradient(135deg,#E2A86A 0%,#B9762F 55%,#7E4E1E 100%)", ink: "#FFFFFF", soft: "rgba(255,255,255,.78)", bar: "#FFFFFF" },
  silver: { label: "Silver", color: "#8D97A5", card: "linear-gradient(135deg,#E9EDF2 0%,#B5BECA 55%,#7E8896 100%)", ink: "#081D3C", soft: "rgba(8,29,60,.7)", bar: "#081D3C" },
  gold: { label: "Gold", color: "#B8964E", card: "linear-gradient(120deg,#F3E3B8 0%,#D6BA80 50%,#B8964E 100%)", ink: "#081D3C", soft: "rgba(8,29,60,.72)", bar: "#081D3C" },
};

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "history", label: "History" },
  { key: "how", label: "How It Works" },
] as const;
type Tab = (typeof TABS)[number]["key"];

interface PointsTransaction { id: number; type: string; points: number; description?: string; created_at: string; }

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pts = (n: number) => n.toLocaleString("en-US");

/** The next round balance to aim for once there is no higher tier: 15,000 when holding 13,458. */
function nextMilestone(balance: number, minRedeem: number): { from: number; to: number } {
  const steps = [minRedeem, 500, 1000, 2500, 5000].filter((s, i, a) => s > 0 && a.indexOf(s) === i).sort((a, b) => a - b);
  let from = 0;
  for (const s of steps) {
    if (balance < s) return { from, to: s };
    from = s;
  }
  const to = (Math.floor(balance / 5000) + 1) * 5000;
  return { from: to - 5000, to };
}

export default function RewardsPage() {
  const { user } = useAuth();
  const [account, setAccount] = useState<LoyaltyAccount | null>(null);
  const [settings, setSettings] = useState<LoyaltySettings | null>(null);
  const [history, setHistory] = useState<PointsTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  /** The account couldn't be loaded (network, server restart) — not the same as rewards being off */
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    setFailed(false);
    // Each part loads on its own: a failed history or settings call must not hide the balance
    Promise.allSettled([
      api.get<LoyaltyAccount>("/loyalty/account"),
      api.get<PointsTransaction[]>("/loyalty/history", { params: { limit: 20 } }),
      api.get<LoyaltySettings>("/loyalty/settings"),
    ]).then(([acct, hist, cfg]) => {
      if (acct.status === "fulfilled") setAccount(acct.value);
      else setFailed(true);
      if (hist.status === "fulfilled") setHistory(hist.value || []);
      if (cfg.status === "fulfilled") setSettings(cfg.value || null);
    }).finally(() => setLoading(false));
  }, [user, attempt]);

  if (!user) return <LoginGate><div /></LoginGate>;
  if (loading) return <Page><Skeleton /></Page>;
  if (failed || !account) {
    return (
      <Page>
        <Empty icon="gift" msg="Couldn't load your rewards. Check your connection and try again." />
        <div className="text-center">
          <button type="button" onClick={() => setAttempt((n) => n + 1)}
            className="fos-press inline-flex h-11 items-center rounded-thumb bg-grad-cta px-6 text-[14px] font-bold text-white shadow-fos-cta">Try again</button>
        </div>
      </Page>
    );
  }
  if (!account.enabled) return <Page><Empty icon="gift" msg="Rewards program coming soon!" /></Page>;

  const tier = TIERS[account.tier] || TIERS.bronze;

  // Thresholds & multipliers from settings (with fallbacks if /loyalty/settings is unavailable)
  const silverAt = settings?.silver_threshold ?? 500;
  const goldAt = settings?.gold_threshold ?? 2000;
  const pointsPerDollar = settings?.points_per_dollar ?? 10;
  const pointValueCents = settings?.points_value_cents ?? 1;
  const minRedeem = settings?.min_redeem_points ?? 100;
  const silverMult = settings?.silver_multiplier ?? 1.5;
  const goldMult = settings?.gold_multiplier ?? 2.0;
  const worth = (points: number) => (points * pointValueCents) / 100;

  // Progress: to the next tier (lifetime points) or, at the top tier, to the next balance milestone
  const tierStart = account.tier === "bronze" ? 0 : account.tier === "silver" ? silverAt : goldAt;
  const nextTierAt = account.next_tier === "silver" ? silverAt : account.next_tier === "gold" ? goldAt : null;
  const nextMultiplier = account.next_tier === "silver" ? silverMult : account.next_tier === "gold" ? goldMult : null;
  const milestone = nextMilestone(account.balance, minRedeem);
  const goal = nextTierAt !== null && account.next_tier
    ? {
        from: tierStart, to: nextTierAt, at: account.lifetime_points,
        left: account.points_to_next ?? Math.max(0, nextTierAt - account.lifetime_points),
        target: `${TIERS[account.next_tier]?.label ?? account.next_tier} Tier`,
        perk: nextMultiplier ? `${nextMultiplier}× points on every order` : null,
      }
    : {
        from: milestone.from, to: milestone.to, at: account.balance,
        left: milestone.to - account.balance,
        target: `${pts(milestone.to)} pts`,
        perk: `${money(worth(milestone.to))} in rewards`,
      };
  const progress = goal.to > goal.from ? Math.min(100, Math.max(0, ((goal.at - goal.from) / (goal.to - goal.from)) * 100)) : 100;

  const balanceWorth = worth(account.balance);
  const canRedeem = account.balance >= minRedeem;
  const multiplier = account.multiplier && account.multiplier > 1 ? account.multiplier : null;
  const exampleBase = Math.max(minRedeem, 100);
  const examples = [exampleBase, exampleBase * 5, exampleBase * 10];

  const tierBenefitLine = (key: string) => {
    if (key === "bronze") return `Base rate · earn ${pointsPerDollar} pts per $1`;
    if (key === "silver") return `${silverMult}× multiplier · ${Math.round(pointsPerDollar * silverMult)} pts per $1`;
    return `${goldMult}× multiplier · ${Math.round(pointsPerDollar * goldMult)} pts per $1`;
  };
  const tierThresholdLabel = (key: string) => {
    if (key === "bronze") return "Starting tier";
    if (key === "silver") return `Reach ${pts(silverAt)} lifetime pts`;
    return `Reach ${pts(goldAt)} lifetime pts`;
  };

  return (
    <Page>
      {/* 1. Hero: the balance is the biggest thing on the page */}
      <section className="relative overflow-hidden rounded-hero p-5 shadow-fos-lg" style={{ background: tier.card, color: tier.ink }}>
        <span aria-hidden className="absolute -right-12 -top-14 h-44 w-44 rounded-full border-[22px] border-white/20" />
        <span aria-hidden className="absolute -bottom-10 right-20 h-24 w-24 rounded-full bg-white/15" />
        <div className="relative">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white/30 px-3 text-[12px] font-extrabold uppercase tracking-[0.08em]">
            <Icon name="trophy" size={14} strokeWidth={2.2} />{tier.label} Tier
          </span>
          <p className="mt-4 flex items-baseline gap-2">
            <span className="text-[52px] font-extrabold leading-none tracking-[-0.03em]">{pts(account.balance)}</span>
            <span className="text-[18px] font-extrabold">pts</span>
          </p>
          <p className="mt-2 text-[15px] font-bold" style={{ color: tier.soft }}>
            ≈ <b className="font-extrabold" style={{ color: tier.ink }}>{money(balanceWorth)}</b> available rewards
          </p>
          {multiplier && (
            <span className="mt-4 inline-flex h-7 items-center gap-1 rounded-full px-3 text-[12px] font-extrabold" style={{ background: tier.ink, color: account.tier === "bronze" ? "#7E4E1E" : "#D6BA80" }}>
              <Icon name="bolt" size={13} strokeWidth={2.4} />{multiplier}× points on every order
            </span>
          )}
        </div>
      </section>

      {/* 2. Progress: what the next order gets you closer to */}
      <section className="mt-3 rounded-card bg-card p-4 shadow-fos-md">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[14px] font-extrabold text-ink-900">{tier.label} Tier</p>
          <p className="text-[12px] font-bold text-ink-500">{pts(goal.at)} / {pts(goal.to)}</p>
        </div>
        <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <div className="h-full rounded-full bg-grad-gold transition-[width] duration-700" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2.5 text-[14px] font-bold text-ink-900">
          <span className="font-extrabold text-gold-700">{pts(goal.left)} pts</span> until {goal.target}
        </p>
        {goal.perk && <p className="mt-0.5 text-caption text-ink-500">Unlocks {goal.perk}. Keep shopping to get there.</p>}
      </section>

      {/* 3. Reward card: what the points are worth to the customer */}
      <section className="mt-3 overflow-hidden rounded-card bg-navy-900 p-4 text-white shadow-fos-md">
        {canRedeem ? (
          <>
            <p className="flex items-center gap-1.5 text-[12px] font-extrabold uppercase tracking-[0.08em] text-gold-400">
              <Icon name="gift" size={15} strokeWidth={2.2} />Available Reward
            </p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-white/70">Use {pts(account.balance)} pts</p>
                <p className="text-[24px] font-extrabold leading-[30px] tracking-[-0.01em]">Save up to <span className="text-gold-400">{money(balanceWorth)}</span></p>
              </div>
              <Link href="/shop" className="fos-press inline-flex h-10 shrink-0 items-center gap-1 rounded-full bg-gold-400 px-4 text-[13px] font-extrabold text-navy-900">
                Shop now<span aria-hidden>→</span>
              </Link>
            </div>
            <p className="mt-3 flex items-center gap-1.5 border-t border-white/10 pt-3 text-[12px] font-semibold text-white/60">
              <Icon name="clock" size={13} strokeWidth={2.2} />Redeeming points at checkout is coming soon. Your points are saved until then.
            </p>
          </>
        ) : (
          <>
            <p className="flex items-center gap-1.5 text-[12px] font-extrabold uppercase tracking-[0.08em] text-gold-400">
              <Icon name="lock" size={15} strokeWidth={2.2} />Your First Reward
            </p>
            <p className="mt-2 text-[20px] font-extrabold leading-[26px]">
              Earn {pts(minRedeem - account.balance)} more pts to unlock <span className="text-gold-400">{money(worth(minRedeem))} off</span>
            </p>
            <Link href="/shop" className="fos-press mt-3 inline-flex h-10 items-center gap-1 rounded-full bg-gold-400 px-4 text-[13px] font-extrabold text-navy-900">
              Start shopping<span aria-hidden>→</span>
            </Link>
          </>
        )}
      </section>

      {/* 4. Tabs: full-width segmented control with a solid active pill */}
      <div role="tablist" aria-label="Rewards sections" className="mt-5 grid grid-cols-3 gap-1 rounded-full border border-line bg-card p-1 shadow-fos-sm">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.key)}
              className={`fos-press h-10 rounded-full text-[13px] transition-colors duration-200 ${active ? "bg-navy-900 font-extrabold text-gold-400 shadow-fos-md" : "font-bold text-ink-500"}`}>
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "overview" && (
        <div className="mt-4">
          {/* 5. Balance worth leads; the rest are supporting facts */}
          <div className="flex items-center gap-3 rounded-card border border-gold-400/60 bg-tint-gold p-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-grad-gold text-navy-900"><Icon name="gift" size={22} strokeWidth={2} /></span>
            <div className="min-w-0">
              <p className="text-[28px] font-extrabold leading-[32px] tracking-[-0.02em] text-ink-900">{money(balanceWorth)}</p>
              <p className="text-[13px] font-bold text-gold-700">Available rewards · {pts(account.balance)} pts</p>
            </div>
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            <MiniStat icon="bolt" label="Earn rate" value={`${Math.round(pointsPerDollar * (account.multiplier || 1))} pts`} sub="per $1" />
            <MiniStat icon="star" label="Lifetime" value={pts(account.lifetime_points)} sub="pts earned" />
            <MiniStat icon="ticket" label="Min redeem" value={`${pts(minRedeem)} pts`} sub={`${money(worth(minRedeem))} off`} />
          </div>

          {/* 6. What points are worth, at a glance */}
          <h2 className="mt-5 text-section text-ink-900">Popular Redemptions</h2>
          <div className="mt-2.5 overflow-hidden rounded-card bg-card shadow-fos-md">
            {examples.map((p, i) => {
              const owned = account.balance >= p;
              return (
                <div key={p} className={`flex items-center gap-3 px-4 py-3.5 ${i ? "border-t border-line" : ""}`}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${owned ? "bg-tint-gold text-gold-700" : "bg-surface text-ink-500"}`}>
                    <Icon name={owned ? "check" : "lock"} size={16} strokeWidth={2.4} />
                  </span>
                  <p className="flex-1 text-[15px] font-extrabold text-ink-900">{pts(p)} pts</p>
                  <span aria-hidden className="text-ink-500">=</span>
                  <p className="w-20 text-right text-[16px] font-extrabold text-gold-700">{money(worth(p))}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="mt-4">
          {history.length === 0 ? (
            <div className="rounded-card bg-card p-8 text-center shadow-fos-md">
              <div className="mb-2 flex justify-center text-ink-500"><Icon name="list" size={32} strokeWidth={1.5} /></div>
              <p className="text-[13px] text-ink-500">No points yet. Your first order earns your first points.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {history.map((tx) => {
                const isEarn = tx.points > 0;
                return (
                  <div key={tx.id} className="flex items-center justify-between gap-3 rounded-card bg-card px-4 py-3 shadow-fos-sm">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${isEarn ? "bg-tint-jade text-tone-jade" : "bg-tint-ruby text-ruby-500"}`}>
                        <Icon name={isEarn ? "plus" : "gift"} size={16} strokeWidth={2.4} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold capitalize text-ink-900">{tx.type}</p>
                        {tx.description && <p className="truncate text-[11px] text-ink-500">{tx.description}</p>}
                      </div>
                    </div>
                    <span className={`shrink-0 text-[15px] font-extrabold ${isEarn ? "text-tone-jade" : "text-ruby-500"}`}>
                      {isEarn ? "+" : ""}{pts(tx.points)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "how" && (
        <div className="mt-4 flex flex-col gap-2.5">
          {([
            { icon: "bag", title: "Shop & Earn", desc: `Earn ${pointsPerDollar} points for every $1 you spend. Higher tiers earn even more.` },
            { icon: "trophy", title: "Level Up", desc: `Earn ${pts(silverAt)} lifetime points to reach Silver (${silverMult}×) and ${pts(goldAt)} for Gold (${goldMult}×).` },
            { icon: "gift", title: "Redeem", desc: `Every ${pts(Math.round(100 / pointValueCents))} points is worth $1. Redeem from ${pts(minRedeem)} points (${money(worth(minRedeem))} off). Redeeming at checkout is coming soon.` },
          ] as { icon: IconName; title: string; desc: string }[]).map((item) => (
            <div key={item.title} className="flex items-start gap-3.5 rounded-card bg-card p-4 shadow-fos-sm">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-thumb bg-tint-gold text-gold-700"><Icon name={item.icon} size={19} strokeWidth={2} /></span>
              <div>
                <p className="text-[14px] font-extrabold text-ink-900">{item.title}</p>
                <p className="mt-0.5 text-[12px] leading-[18px] text-ink-500">{item.desc}</p>
              </div>
            </div>
          ))}

          <div className="mt-1 rounded-card bg-card p-4 shadow-fos-sm">
            <h3 className="mb-3 text-[14px] font-extrabold text-ink-900">Tier Benefits</h3>
            <div className="flex flex-col gap-1.5">
              {Object.entries(TIERS).map(([key, cfg]) => {
                const isActive = account.tier === key;
                return (
                  <div key={key} className={`flex items-center gap-3 rounded-thumb border-[1.5px] px-3 py-2.5 ${isActive ? "border-gold-400 bg-tint-gold" : "border-transparent bg-surface"}`}>
                    <span className="flex" style={{ color: cfg.color }}><Icon name="trophy" size={22} strokeWidth={2} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-extrabold text-ink-900">{cfg.label}</p>
                      <p className="text-[11px] text-ink-500">{tierBenefitLine(key)}</p>
                      <p className="text-[11px] text-ink-500 opacity-80">{tierThresholdLabel(key)}</p>
                    </div>
                    {isActive && <span className="rounded-full bg-navy-900 px-2.5 py-1 text-[10px] font-extrabold text-gold-400">Current</span>}
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
    <div className="min-h-screen bg-surface">
      <div className="sticky top-0 z-10 flex h-14 items-center border-b border-line bg-card px-4">
        <h1 className="text-[17px] font-extrabold text-ink-900">Rewards</h1>
      </div>
      <div className="px-4 pb-28 pt-4">{children}</div>
    </div>
  );
}

function Empty({ icon, msg }: { icon: IconName; msg: string }) {
  return (
    <div className="pb-4 pt-20 text-center">
      <div className="mb-3 flex justify-center text-ink-500"><Icon name={icon} size={44} strokeWidth={1.5} /></div>
      <p className="text-[14px] text-ink-500">{msg}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[176, 96, 120, 48, 88].map((h, i) => (
        <div key={i} className="animate-pulse rounded-card bg-line" style={{ height: h }} />
      ))}
    </div>
  );
}

function MiniStat({ icon, label, value, sub }: { icon: IconName; label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 rounded-card bg-card p-3 shadow-fos-sm">
      <span className="text-ink-500"><Icon name={icon} size={15} strokeWidth={2} /></span>
      <p className="mt-1.5 text-[11px] font-bold text-ink-500">{label}</p>
      <p className="truncate text-[15px] font-extrabold text-ink-900">{value}</p>
      <p className="truncate text-[11px] text-ink-500">{sub}</p>
    </div>
  );
}
