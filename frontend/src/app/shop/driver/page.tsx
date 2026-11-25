"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/providers/AuthProvider";
import { LoginGate } from "@/components/shop/LoginGate";
import { api } from "@/lib/api";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { DELIVERY_LABEL, directionsUrl, isFinished, jobTitle, money, nextAction, telUrl } from "@/lib/deliveries";
import type { DriverJob, DriverProfile } from "@/types";
import { Icon } from "@/components/shop/Icon";

export default function DriverPage() {
  const { user } = useAuth();
  if (!user) return <LoginGate><div /></LoginGate>;
  return <DriverContent />;
}

type Scope = "active" | "done";

function DriverContent() {
  const [driver, setDriver] = useState<DriverProfile | null | undefined>(undefined); // undefined = still loading
  const [scope, setScope] = useState<Scope>("active");
  const [jobs, setJobs] = useState<DriverJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [failing, setFailing] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  // "Delivered" asks for the customer's 4-digit code first
  const [delivering, setDelivering] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<{ driver: DriverProfile | null }>("/deliveries/me").then((r) => setDriver(r.driver)).catch(() => setDriver(null));
  }, []);

  const load = useCallback(async () => {
    if (!driver?.is_active) { setLoadingJobs(false); return; }
    try {
      const r = await api.get<{ data: DriverJob[] }>("/deliveries/me/jobs", { params: { scope } });
      setJobs(r.data);
    } catch { /* offline: keep what is shown */ }
    finally { setLoadingJobs(false); }
  }, [driver, scope]);

  useEffect(() => { setLoadingJobs(true); setJobs([]); load(); }, [load]);
  useAutoRefresh(load, { interval: 10000 });

  async function act(job: DriverJob, action: string, body?: { reason?: string; code?: string }) {
    setBusy(job.order.id); setError("");
    try {
      await api.post(`/deliveries/jobs/${job.order.id}/${action}`, body);
      setFailing(null); setReason(""); setDelivering(null); setCode("");
      await load();
    } catch (e: unknown) {
      setError((e instanceof Error && e.message) || "That didn't work. Please try again.");
      await load();
    } finally { setBusy(null); }
  }

  async function toggleShift() {
    if (!driver) return;
    const next = !driver.is_available;
    setDriver({ ...driver, is_available: next });
    api.patch("/deliveries/me/availability", { is_available: next }).catch(() => setDriver((d) => (d ? { ...d, is_available: !next } : d)));
  }

  if (driver === undefined) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--shop-muted, #8A8F9C)" }}>Loading…</div>;
  }
  if (driver === null) {
    return (
      <div style={{ minHeight: "100vh", padding: "64px 24px", textAlign: "center", background: "var(--shop-bg, #F7F8FB)" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--fos-brand-tint)", color: "var(--fos-brand)", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
          <Icon name="truck" size={28} />
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 8px", color: "var(--shop-black, #0B0B0F)" }}>You're not set up as a driver</h1>
        <p style={{ fontSize: 14, color: "var(--shop-muted, #8A8F9C)", margin: "0 auto 20px", maxWidth: 300 }}>
          Ask the shop you deliver for to add your Telegram account as a driver. Then your jobs will show up here.
        </p>
        <Link href="/shop" style={{ color: "var(--fos-brand)", fontWeight: 700, fontSize: 14 }}>Back to shopping</Link>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg, #F7F8FB)", paddingBottom: 90 }}>
      <div style={{ background: "var(--shop-surface, #fff)", borderBottom: "1px solid var(--shop-divider, #ECEEF3)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px" }}>
          <div>
            <h1 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: "var(--shop-black, #0B0B0F)" }}>My deliveries</h1>
            <p style={{ fontSize: 12, margin: "2px 0 0", color: "var(--shop-muted, #8A8F9C)" }}>
              {driver.full_name}{driver.merchant_id ? " · shop rider" : ""}
            </p>
          </div>
          <button type="button" onClick={toggleShift} disabled={!driver.is_active} aria-pressed={driver.is_available}
            style={{
              height: 36, padding: "0 14px", borderRadius: 999, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 13,
              background: driver.is_available ? "var(--tone-positive-bg, #DDF2E6)" : "var(--shop-divider, #ECEEF3)",
              color: driver.is_available ? "#067647" : "var(--shop-muted, #8A8F9C)",
            }}>
            {driver.is_available ? "● On shift" : "○ Off shift"}
          </button>
        </div>
        <div role="tablist" style={{ display: "flex", gap: 8, padding: "0 16px 10px" }}>
          {(["active", "done"] as Scope[]).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={scope === s} onClick={() => setScope(s)} style={{
              height: 32, padding: "0 14px", borderRadius: 999, cursor: "pointer", fontSize: 13, fontWeight: 700,
              border: scope === s ? "none" : "1.5px solid var(--shop-divider, #ECEEF3)",
              background: scope === s ? "var(--fos-brand)" : "var(--shop-surface, #fff)", color: scope === s ? "#fff" : "var(--shop-black, #0B0B0F)",
            }}>{s === "active" ? "To do" : "Done"}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "12px 16px" }}>
        {!driver.is_active && (
          <p role="alert" style={{ background: "#FDECEC", color: "#B42318", borderRadius: 12, padding: 12, fontSize: 13, fontWeight: 600 }}>
            Your driver account is switched off. Please contact the shop.
          </p>
        )}
        {driver.is_active && !driver.is_available && scope === "active" && (
          <p style={{ background: "var(--shop-divider, #ECEEF3)", borderRadius: 12, padding: 12, fontSize: 13, color: "var(--shop-muted, #6B7280)" }}>
            You're off shift, so shops can't give you new deliveries. Switch on when you're ready.
          </p>
        )}
        {error && <p role="alert" style={{ background: "#FDECEC", color: "#B42318", borderRadius: 12, padding: 12, fontSize: 13, fontWeight: 600 }}>{error}</p>}

        {loadingJobs ? (
          <div style={{ height: 160, background: "var(--shop-divider, #ECEEF3)", borderRadius: 16, animation: "pulse 1.5s infinite" }} />
        ) : jobs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "56px 0", color: "var(--shop-muted, #8A8F9C)" }}>
            <Icon name="truck" size={36} />
            <p style={{ fontSize: 14, marginTop: 8 }}>{scope === "active" ? "No deliveries right now" : "Nothing finished yet"}</p>
          </div>
        ) : jobs.map((job) => (
          <JobCard key={job.order.id} job={job} busy={busy === job.order.id} failing={failing === job.order.id}
            reason={reason} setReason={setReason}
            delivering={delivering === job.order.id} code={code} setCode={setCode}
            onStartDeliver={() => { setDelivering(job.order.id); setCode(""); setFailing(null); }}
            onCancelDeliver={() => setDelivering(null)}
            onDeliver={() => act(job, "deliver", { code })}
            onAct={(a) => act(job, a)} onStartFail={() => { setFailing(job.order.id); setReason(""); }} onCancelFail={() => setFailing(null)}
            onFail={() => act(job, "fail", { reason })} />
        ))}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}

function Contact({ label, name, phone, address, place }: {
  label: string; name?: string | null; phone?: string | null; address?: string | null;
  place: { lat?: number | null; lng?: number | null; address?: string | null };
}) {
  const call = telUrl(phone);
  const dir = directionsUrl(place);
  const chip = { display: "inline-flex", alignItems: "center", gap: 4, height: 32, padding: "0 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, textDecoration: "none", background: "var(--fos-brand-tint)", color: "var(--fos-brand)" } as const;
  return (
    <div style={{ padding: "10px 0", borderTop: "1px solid var(--shop-divider, #ECEEF3)" }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--shop-muted, #8A8F9C)" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", marginTop: 2 }}>{name || "—"}</div>
      {address && <div style={{ fontSize: 13, color: "var(--shop-text, #4A4E5A)", marginTop: 2 }}>{address}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {call && <a href={call} style={chip}><Icon name="phone" size={14} /> Call</a>}
        {dir && <a href={dir} target="_blank" rel="noreferrer" style={chip}><Icon name="map" size={14} /> Directions</a>}
      </div>
    </div>
  );
}

function JobCard({ job, busy, failing, reason, setReason, delivering, code, setCode, onStartDeliver, onCancelDeliver, onDeliver, onAct, onStartFail, onCancelFail, onFail }: {
  job: DriverJob; busy: boolean; failing: boolean; reason: string; setReason: (v: string) => void;
  delivering: boolean; code: string; setCode: (v: string) => void;
  onStartDeliver: () => void; onCancelDeliver: () => void; onDeliver: () => void;
  onAct: (a: "accept" | "pickup" | "deliver" | "decline") => void; onStartFail: () => void; onCancelFail: () => void; onFail: () => void;
}) {
  const status = job.delivery.status;
  const next = nextAction(status);
  const finished = isFinished(status);
  const toShop = status === "assigned" || status === "accepted";
  const btn = (primary: boolean) => ({
    flex: 1, height: 48, borderRadius: 14, border: primary ? "none" : "1.5px solid var(--shop-divider, #ECEEF3)", cursor: busy ? "default" : "pointer",
    fontWeight: 800, fontSize: 15, opacity: busy ? 0.6 : 1,
    background: primary ? "var(--fos-brand)" : "var(--shop-surface, #fff)", color: primary ? "#fff" : "var(--shop-black, #0B0B0F)",
  }) as const;
  return (
    <article data-status={status} style={{ background: "var(--shop-surface, #fff)", borderRadius: 16, padding: 14, marginBottom: 12, boxShadow: "0 2px 10px rgba(8,29,60,.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 15 }}>{jobTitle(job)}</strong>
        <span style={{ fontSize: 11, fontWeight: 800, padding: "4px 10px", borderRadius: 999, background: finished ? "var(--shop-divider, #ECEEF3)" : "#FFF3C7", color: finished ? "var(--shop-muted, #6B7280)" : "#8A5A00" }}>
          {DELIVERY_LABEL[status] ?? status}
        </span>
      </div>

      {job.collect_cash > 0 && !finished && (
        <div role="note" style={{ margin: "10px 0 2px", padding: "10px 12px", borderRadius: 12, background: "#FFF3C7", color: "#6B4A00", fontWeight: 800, fontSize: 14 }}>
          Collect {money(job.collect_cash)} cash from the customer
        </div>
      )}

      {/* Go to the shop first, then to the customer */}
      {toShop ? (
        <Contact label="Pick up at" name={job.shop.name} phone={job.shop.phone} address={job.shop.address} place={{ lat: job.shop.lat, lng: job.shop.lng, address: job.shop.address }} />
      ) : null}
      <Contact label="Deliver to" name={job.customer.name} phone={job.customer.phone} address={job.customer.address}
        place={{ lat: job.customer.lat, lng: job.customer.lng, address: job.customer.address }} />

      <div style={{ fontSize: 12, color: "var(--shop-muted, #6B7280)", paddingTop: 8, borderTop: "1px solid var(--shop-divider, #ECEEF3)" }}>
        {job.order.items.join(" · ")}
        {job.order.note && <div style={{ marginTop: 4 }}><em>“{job.order.note}”</em></div>}
        {status === "failed" && job.delivery.failure_reason && <div style={{ marginTop: 4, color: "#B42318" }}>Not delivered: {job.delivery.failure_reason}</div>}
      </div>

      {!finished && !failing && !delivering && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {status === "assigned" && <button type="button" style={btn(false)} disabled={busy} onClick={() => onAct("decline")}>Decline</button>}
          {status === "picked_up" && <button type="button" style={btn(false)} disabled={busy} onClick={onStartFail}>Couldn't deliver</button>}
          {next && <button type="button" style={btn(true)} disabled={busy}
            onClick={() => (next.action === "deliver" ? onStartDeliver() : onAct(next.action))}>{busy ? "…" : next.label}</button>}
        </div>
      )}
      {delivering && (
        <div style={{ marginTop: 12 }} data-testid="code-entry">
          <label htmlFor={`code-${job.order.id}`} style={{ fontSize: 12, fontWeight: 700 }}>Ask the customer for their 4-digit delivery code</label>
          <input id={`code-${job.order.id}`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric" autoComplete="one-time-code" maxLength={4} placeholder="••••" autoFocus
            style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 12, border: "1.5px solid var(--shop-divider, #ECEEF3)", fontSize: 24, fontWeight: 800, letterSpacing: "0.4em", textAlign: "center" }} />
          <p style={{ fontSize: 11, color: "var(--shop-muted, #6B7280)", marginTop: 6 }}>
            It is on the customer&apos;s order page and in their Telegram message. No code? Call the shop.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" style={btn(false)} onClick={onCancelDeliver}>Back</button>
            <button type="button" style={btn(true)} disabled={busy || code.length !== 4} onClick={onDeliver}>{busy ? "…" : "Confirm delivered"}</button>
          </div>
        </div>
      )}
      {failing && (
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Why couldn't you deliver it?</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. nobody answered the door"
            style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 12, border: "1.5px solid var(--shop-divider, #ECEEF3)", fontSize: 14 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" style={btn(false)} onClick={onCancelFail}>Back</button>
            <button type="button" style={btn(true)} disabled={busy || reason.trim().length < 3} onClick={onFail}>Report</button>
          </div>
        </div>
      )}
    </article>
  );
}
