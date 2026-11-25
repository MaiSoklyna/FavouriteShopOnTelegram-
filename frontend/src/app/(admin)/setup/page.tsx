"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useShopCategories } from "@/lib/useShopCategories";
import { BrandLoader } from "@/components/ui/Spinner";
import { copyLink, shopLink } from "@/lib/deeplink";
import { HeroImagesEditor } from "@/components/admin/HeroImagesEditor";
import {
  ALWAYS_OPEN, DAYS, DAY_LABEL, STEPS, isAlwaysOpen, stepDone,
  type Hours, type SetupData, type StepKey,
} from "@/lib/setup";

const MapPicker = dynamic(() => import("@/components/map/MapPicker"), { ssr: false });

export default function SetupPage() {
  return <Suspense fallback={<BrandLoader />}><Setup /></Suspense>;
}

/**
 * The shop setup wizard. Eight steps; the first seven are required before customers can see the shop,
 * the last is optional. Every step saves on its own, so the owner can stop and come back. The shop goes
 * live by itself (on the server) the moment the last required item is done.
 */
function Setup() {
  const router = useRouter();
  const params = useSearchParams();
  const { isSuperAdmin } = useAuth();
  const [data, setData] = useState<SetupData | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState({ show: false, msg: "", ok: true });
  const step = (params.get("step") as StepKey) || firstOpenStep(data) || "basics";

  const flash = (msg: string, ok = true) => { setToast({ show: true, msg, ok }); setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000); };
  const load = useCallback(async () => {
    try { setData(await api.get<SetupData>("/merchant-setup")); setError(""); }
    catch (e: any) { setError(e?.detail || "Could not load your shop's setup"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const go = (s: StepKey) => router.replace(`/setup?step=${s}`, { scroll: false });
  const nextStep = () => {
    const i = STEPS.findIndex((s) => s.key === step);
    if (i < STEPS.length - 1) go(STEPS[i + 1].key);
  };
  const saved = async (msg = "Saved") => {
    const wasLive = data?.checklist.live;
    flash(msg);
    const fresh = await api.get<SetupData>("/merchant-setup").catch(() => null);
    if (fresh) {
      setData(fresh);
      if (!wasLive && fresh.checklist.live) flash("🎉 Your shop is live: customers can see it now");
    }
  };

  if (isSuperAdmin) {
    return <div className="admin-card">The setup wizard is for shop owners. See each shop&apos;s progress on the Merchants page.</div>;
  }
  if (error) return <div className="admin-card" style={{ color: "var(--danger)" }}>{error}</div>;
  if (!data) return <BrandLoader />;

  const c = data.checklist;
  const owner = data.can_edit_settings;
  const props = { data, owner, saved, flash, next: nextStep };

  return (
    <div>
      {toast.show && <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>{toast.msg}</div>}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Shop setup</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }} data-testid="setup-status">
          {c.live
            ? (c.complete ? "Your shop is live and fully set up." : `Your shop is live. ${c.total - c.done} item(s) still need attention.`)
            : `${c.done} of ${c.total} done. Customers will see your shop once everything required is done.`}
        </p>
        <div style={{ height: 6, borderRadius: 3, background: "var(--bg-secondary)", marginTop: 8, overflow: "hidden" }}>
          <div style={{ width: `${(c.done / c.total) * 100}%`, height: "100%", background: c.complete ? "var(--success)" : "var(--accent, #0088cc)" }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(170px, 220px) 1fr", gap: 16, alignItems: "start" }} className="setup-grid">
        <nav className="admin-card" style={{ padding: 8 }} aria-label="Setup steps">
          {STEPS.map((s, i) => {
            const done = stepDone(c, s.key);
            const on = s.key === step;
            return (
              <button key={s.key} onClick={() => go(s.key)} data-testid={`step-${s.key}`}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "9px 10px",
                  borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: on ? 700 : 500,
                  background: on ? "var(--info-light)" : "transparent", color: "var(--text)",
                }}>
                <span style={{
                  width: 22, height: 22, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, flexShrink: 0,
                  background: done ? "var(--success)" : "var(--bg-secondary)", color: done ? "#fff" : "var(--text-muted)",
                }}>{done ? "✓" : i + 1}</span>
                <span style={{ flex: 1 }}>{s.title}</span>
                {!s.required && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>optional</span>}
              </button>
            );
          })}
        </nav>

        <section className="admin-card" data-testid={`panel-${step}`}>
          {!owner && ["basics", "location", "hours", "delivery", "telegram"].includes(step) && (
            <p style={{ fontSize: 13, background: "var(--warning-light)", color: "var(--warning)", padding: "8px 12px", borderRadius: 8, marginBottom: 12 }}>
              Only the shop owner can change these settings. You can add categories and products.
            </p>
          )}
          {step === "basics" && <Basics {...props} />}
          {step === "location" && <Location {...props} />}
          {step === "hours" && <HoursStep {...props} />}
          {step === "delivery" && <Delivery {...props} />}
          {step === "telegram" && <Telegram {...props} reload={load} />}
          {step === "categories" && <Categories {...props} />}
          {step === "products" && <Products {...props} />}
          {step === "extras" && <Extras {...props} />}
        </section>
      </div>
      <style>{`@media (max-width: 720px) { .setup-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function firstOpenStep(d: SetupData | null): StepKey | null {
  if (!d) return null;
  return STEPS.find((s) => s.required && !stepDone(d.checklist, s.key))?.key ?? null;
}

type StepProps = {
  data: SetupData; owner: boolean; saved: (msg?: string) => Promise<void>;
  flash: (msg: string, ok?: boolean) => void; next: () => void;
};

const h2 = { fontSize: 17, fontWeight: 700, marginBottom: 4 } as const;
const hint = { fontSize: 13, color: "var(--text-muted)", marginBottom: 14 } as const;
const label = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 12 } as const;

function useSave(flash: StepProps["flash"]) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, after: () => Promise<void> | void) => {
    setBusy(true);
    try { await fn(); await after(); }
    catch (e: any) { flash(e?.detail || e?.message || "Could not save", false); }
    setBusy(false);
  };
  return { busy, run };
}

function Footer({ busy, onSave, next, saveLabel = "Save and continue", disabled }: { busy: boolean; onSave?: () => void; next: () => void; saveLabel?: string; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
      <button className="btn-outline" onClick={next}>Skip for now</button>
      {onSave && <button className="btn-primary" onClick={onSave} disabled={busy || disabled} data-testid="step-save">{busy ? "Saving…" : saveLabel}</button>}
    </div>
  );
}

// ── 1 Basics ─────────────────────────────────────────────────────

function Basics({ data, owner, saved, flash, next }: StepProps) {
  const { categories: types } = useShopCategories(false);
  const [name, setName] = useState(data.shop.name || "");
  const [type, setType] = useState<number | "">(data.shop.shop_category_id ?? "");
  const [sub, setSub] = useState<number | "">(data.shop.shop_subcategory_id ?? "");
  const [logo, setLogo] = useState(data.shop.logo_url);
  const file = useRef<HTMLInputElement>(null);
  const { busy, run } = useSave(flash);
  const subs = types.find((t) => t.id === type)?.subcategories ?? [];

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    await run(async () => { const r = await api.upload<{ logo_url: string }>(`/merchants/${data.shop.id}/logo`, fd); setLogo(r.logo_url); }, () => saved("Logo uploaded"));
  }

  function save() {
    if (!name.trim()) { flash("Enter your shop's name", false); return; }
    const body: Record<string, unknown> = { name: name.trim() };
    if (data.can_change_type) { body.shop_category_id = type || null; body.shop_subcategory_id = sub || null; }
    run(() => api.patch(`/merchants/${data.shop.id}`, body), async () => { await saved(); next(); });
  }

  return (
    <div>
      <h2 style={h2}>Basics</h2>
      <p style={hint}>Your shop&apos;s name, what kind of shop it is, and its logo.</p>
      <label style={label}>Shop name
        <input className="admin-input" value={name} onChange={(e) => setName(e.target.value)} disabled={!owner} maxLength={200} />
      </label>
      <label style={label}>Shop type
        <select className="admin-input" value={type} disabled={!owner || !data.can_change_type}
          onChange={(e) => { setType(e.target.value ? Number(e.target.value) : ""); setSub(""); }} data-testid="shop-type">
          <option value="">Choose…</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {subs.length > 0 && (
        <label style={label}>Kind of {types.find((t) => t.id === type)?.name} shop (optional)
          <select className="admin-input" value={sub} disabled={!owner || !data.can_change_type} onChange={(e) => setSub(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Not specified</option>
            {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      {!data.can_change_type && <p style={{ ...hint, marginTop: -6 }}>Your shop is live, so only the platform can change its type. Ask support if it is wrong.</p>}
      <div style={label}>Logo
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
          {logo ? <img src={logo} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: "cover", border: "1px solid var(--border)" }} />
            : <div style={{ width: 64, height: 64, borderRadius: 12, background: "var(--bg-secondary)", display: "grid", placeItems: "center", color: "var(--text-muted)" }}>—</div>}
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={uploadLogo} />
          <button className="btn-outline" onClick={() => file.current?.click()} disabled={!owner || busy}>{logo ? "Change logo" : "Upload logo"}</button>
        </div>
      </div>
      <Footer busy={busy} onSave={owner ? save : undefined} next={next} />
    </div>
  );
}

// ── 2 Location ───────────────────────────────────────────────────

function Location({ data, owner, saved, flash, next }: StepProps) {
  const s = data.shop;
  const [pin, setPin] = useState(s.latitude != null && s.longitude != null ? { lat: Number(s.latitude), lng: Number(s.longitude) } : null);
  const [address, setAddress] = useState(s.address || "");
  const [radius, setRadius] = useState(String(s.delivery_radius_km ?? 5));
  const { busy, run } = useSave(flash);

  function save() {
    if (!pin) { flash("Tap the map where your shop is", false); return; }
    if (!address.trim()) { flash("Enter the shop's address", false); return; }
    const r = Number(radius);
    if (!(r > 0 && r <= 30)) { flash("Delivery radius must be between 0.5 and 30 km", false); return; }
    if (r > 10 && s.delivery_fee_mode === "platform") { flash("Over 10 km you need your own delivery fees: set them in the Delivery step first, or keep 10 km or less", false); return; }
    run(() => api.patch(`/merchants/${s.id}`, { latitude: pin.lat, longitude: pin.lng, address: address.trim(), delivery_radius_km: r }),
      async () => { await saved(); next(); });
  }

  return (
    <div>
      <h2 style={h2}>Location</h2>
      <p style={hint}>Tap the map where your shop is (or drag the pin). Customers nearby find you on the map, and delivery fees count from here.</p>
      <div style={{ borderRadius: 12, overflow: "hidden", marginBottom: 12, pointerEvents: owner ? "auto" : "none", opacity: owner ? 1 : 0.7 }}>
        <MapPicker value={pin} height={300}
          onChange={(p, a) => { setPin(p); if (a && !address.trim()) setAddress(a); }} />
      </div>
      <label style={label}>Address
        <input className="admin-input" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!owner} placeholder="Street, area, city" />
      </label>
      <label style={label}>Delivery radius (km)
        <input className="admin-input" inputMode="decimal" value={radius} onChange={(e) => setRadius(e.target.value.replace(/[^\d.]/g, ""))} disabled={!owner} style={{ maxWidth: 140 }} />
        <span style={{ display: "block", fontSize: 12, fontWeight: 400, color: "var(--text-muted)", marginTop: 4 }}>
          Up to 30 km. Over 10 km you set your own delivery fees (Delivery step): platform fees only cover 10 km.
        </span>
      </label>
      <Footer busy={busy} onSave={owner ? save : undefined} next={next} />
    </div>
  );
}

// ── 3 Opening hours ──────────────────────────────────────────────

function HoursStep({ data, owner, saved, flash, next }: StepProps) {
  const initial = data.shop.opening_hours;
  const [always, setAlways] = useState(isAlwaysOpen(initial));
  const [week, setWeek] = useState<Record<string, { open: boolean; from: string; to: string }>>(() =>
    Object.fromEntries(DAYS.map((d) => {
      const w = !isAlwaysOpen(initial) ? initial?.[d]?.[0] : undefined;
      return [d, { open: !!w || !initial, from: w?.[0] ?? "08:00", to: w?.[1] ?? "20:00" }];
    })));
  const { busy, run } = useSave(flash);
  const set = (d: string, patch: Partial<{ open: boolean; from: string; to: string }>) => setWeek((w) => ({ ...w, [d]: { ...w[d], ...patch } }));

  function save() {
    let hours: Hours;
    if (always) hours = ALWAYS_OPEN;
    else {
      const open = DAYS.filter((d) => week[d].open);
      if (!open.length) { flash("Choose at least one open day, or 24/7", false); return; }
      if (open.some((d) => week[d].from === week[d].to)) { flash("Opening and closing time can't be the same", false); return; }
      hours = Object.fromEntries(DAYS.map((d) => [d, week[d].open ? [[week[d].from, week[d].to]] : []])) as Hours;
    }
    run(() => api.patch(`/merchants/${data.shop.id}`, { opening_hours: hours }), async () => { await saved(); next(); });
  }

  return (
    <div>
      <h2 style={h2}>Opening hours</h2>
      <p style={hint}>Customers can order while you are open. A closing time earlier than the opening time runs past midnight.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className={!always ? "btn-primary" : "btn-outline"} onClick={() => setAlways(false)} disabled={!owner}>Weekly schedule</button>
        <button className={always ? "btn-primary" : "btn-outline"} onClick={() => setAlways(true)} disabled={!owner} data-testid="always-open">Open 24/7</button>
      </div>
      {!always && (
        <div style={{ display: "grid", gap: 8 }}>
          {DAYS.map((d) => (
            <div key={d} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label style={{ width: 120, display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={week[d].open} onChange={(e) => set(d, { open: e.target.checked })} disabled={!owner} />{DAY_LABEL[d]}
              </label>
              {week[d].open ? (
                <>
                  <input type="time" className="admin-input" value={week[d].from} onChange={(e) => set(d, { from: e.target.value })} disabled={!owner} style={{ maxWidth: 130 }} />
                  <span>–</span>
                  <input type="time" className="admin-input" value={week[d].to} onChange={(e) => set(d, { to: e.target.value })} disabled={!owner} style={{ maxWidth: 130 }} />
                </>
              ) : <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Closed</span>}
            </div>
          ))}
          <button className="btn-outline" style={{ justifySelf: "start" }} disabled={!owner}
            onClick={() => setWeek((w) => Object.fromEntries(DAYS.map((d) => [d, { ...w.mon }])))}>Copy Monday to every day</button>
        </div>
      )}
      <Footer busy={busy} onSave={owner ? save : undefined} next={next} />
    </div>
  );
}

// ── 4 Delivery ───────────────────────────────────────────────────

function Delivery({ data, owner, saved, flash, next }: StepProps) {
  const s = data.shop;
  const longDistance = Number(s.delivery_radius_km ?? 5) > 10;   // platform fee bands stop at 10 km
  const [mode, setMode] = useState<"platform" | "custom" | "">(longDistance && s.delivery_fee_mode === "platform" ? "custom" : (s.delivery_fee_mode ?? ""));
  const [base, setBase] = useState(s.delivery_base_fee != null ? String(s.delivery_base_fee) : "");
  const [perKm, setPerKm] = useState(s.delivery_per_km_fee != null ? String(s.delivery_per_km_fee) : "");
  const [minOrder, setMinOrder] = useState(s.min_order_amount != null ? String(s.min_order_amount) : "");
  const { busy, run } = useSave(flash);

  function save() {
    if (!mode) { flash("Choose how delivery is charged", false); return; }
    if (mode === "custom" && base === "") { flash("Enter your base delivery fee", false); return; }
    const num = (v: string) => (v === "" ? null : Number(v));
    run(() => api.patch(`/merchants/${s.id}`, {
      delivery_fee_mode: mode,
      delivery_base_fee: mode === "custom" ? num(base) : null,
      delivery_per_km_fee: mode === "custom" ? num(perKm) ?? 0 : null,
      min_order_amount: num(minOrder),
    }), async () => { await saved(); next(); });
  }

  const radio = (v: "platform" | "custom", title: string, text: string, off = false) => (
    <label style={{ display: "flex", gap: 10, padding: 12, borderRadius: 10, border: `1.5px solid ${mode === v ? "var(--accent, #0088cc)" : "var(--border)"}`, cursor: off ? "not-allowed" : "pointer", marginBottom: 8, opacity: off ? 0.55 : 1 }}>
      <input type="radio" name="fee" checked={mode === v} onChange={() => setMode(v)} disabled={!owner || off} data-testid={`fee-${v}`} />
      <span><b style={{ fontSize: 14 }}>{title}</b><br /><span style={{ fontSize: 12, color: "var(--text-muted)" }}>{text}</span></span>
    </label>
  );

  return (
    <div>
      <h2 style={h2}>Delivery</h2>
      <p style={hint}>How customers pay for delivery. Pickup at your shop is always free. Delivery is only offered within your radius ({s.delivery_radius_km ?? 5} km).</p>
      {radio("platform", "Platform standard fees", longDistance
        ? `Only covers deliveries up to 10 km. Your radius is ${s.delivery_radius_km} km, so set your own fees, or lower the radius in Location.`
        : "Byme24's distance-based fee: the further away, the more it costs (up to 10 km). Simplest to start.", longDistance)}
      {radio("custom", "My own fees", "A base fee plus an amount per km that you choose.")}
      {mode === "custom" && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "4px 0 8px" }}>
          <label style={label}>Base fee ($)<input className="admin-input" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value.replace(/[^\d.]/g, ""))} disabled={!owner} style={{ maxWidth: 130 }} /></label>
          <label style={label}>Per km ($)<input className="admin-input" inputMode="decimal" value={perKm} onChange={(e) => setPerKm(e.target.value.replace(/[^\d.]/g, ""))} disabled={!owner} style={{ maxWidth: 130 }} placeholder="0" /></label>
        </div>
      )}
      <label style={label}>Minimum order ($, optional)
        <input className="admin-input" inputMode="decimal" value={minOrder} onChange={(e) => setMinOrder(e.target.value.replace(/[^\d.]/g, ""))} disabled={!owner} style={{ maxWidth: 160 }} placeholder="No minimum" />
      </label>
      <Footer busy={busy} onSave={owner ? save : undefined} next={next} />
    </div>
  );
}

// ── 5 Telegram ───────────────────────────────────────────────────

function Telegram({ data, owner, flash, next, reload }: StepProps & { reload: () => Promise<void> }) {
  const [link, setLink] = useState<{ code: string; command: string; expires_in: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const linked = data.shop.telegram_group_linked;

  // While a code is on screen, check every few seconds whether the bot has linked the group
  useEffect(() => {
    if (!link || linked) return;
    const id = setInterval(reload, 5000);
    const stop = setTimeout(() => setLink(null), link.expires_in * 1000);
    return () => { clearInterval(id); clearTimeout(stop); };
  }, [link, linked, reload]);

  async function getCode() {
    try { setLink(await api.post("/merchant-setup/telegram-code")); setCopied(false); }
    catch (e: any) { flash(e?.detail || "Could not create a code", false); }
  }

  return (
    <div>
      <h2 style={h2}>Telegram order group</h2>
      <p style={hint}>New orders are posted in a Telegram group, so everyone working in your shop sees them.</p>
      {linked && (
        <p data-testid="group-linked" style={{ background: "var(--success-light, #DCFCE7)", color: "var(--success, #16A34A)", padding: "10px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
          ✓ Your order group is linked. To use a different group, link it the same way.
        </p>
      )}
      <div style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 12 }}>
        <div>1. In Telegram, open your shop&apos;s order group, or create a new group.</div>
        <div>2. Add <b>@{data.bot_username}</b> to the group.</div>
        <div>3. Send the command below in the group. The bot replies when it is linked.</div>
      </div>
      {owner && !link && <button className="btn-primary" onClick={getCode} data-testid="get-code">Get my link code</button>}
      {link && (
        <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: 14 }}>
          <code data-testid="link-command" style={{ display: "block", fontSize: 18, fontWeight: 700, letterSpacing: 1, marginBottom: 10, wordBreak: "break-all" }}>{link.command}</code>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn-outline" onClick={() => navigator.clipboard.writeText(link.command).then(() => setCopied(true)).catch(() => {})}>{copied ? "Copied" : "Copy"}</button>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Works for about {Math.round(link.expires_in / 60)} minutes. Waiting for the bot…</span>
          </div>
        </div>
      )}
      {!owner && <p style={hint}>Ask the shop owner to link the group.</p>}
      <Footer busy={false} next={next} />
    </div>
  );
}

// ── 6 Categories ─────────────────────────────────────────────────

function Categories({ data, saved, flash, next }: StepProps) {
  const [picked, setPicked] = useState<string[]>(data.suggestions.slice(0, 3).map((s) => s.name));
  const [custom, setCustom] = useState("");
  const { busy, run } = useSave(flash);
  const have = data.checklist.required.find((r) => r.key === "category")?.done;

  function save() {
    const names = [...picked, ...custom.split(",").map((x) => x.trim()).filter(Boolean)];
    if (!names.length) { flash("Pick or type at least one category", false); return; }
    run(() => api.post("/merchant-setup/categories", { names }), async () => { setCustom(""); await saved("Categories added"); next(); });
  }

  return (
    <div>
      <h2 style={h2}>Categories</h2>
      <p style={hint}>Group your products so customers can browse them. {have ? "You already have categories; add more or continue." : "Pick some to start with; you can rename or add more later under Categories."}</p>
      {data.suggestions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {data.suggestions.map((s) => {
            const on = picked.includes(s.name);
            return (
              <button key={s.id} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.name) : [...p, s.name]))} data-testid={`suggest-${s.name}`}
                className={on ? "btn-primary" : "btn-outline"} style={{ borderRadius: 999 }}>
                {s.icon_emoji} {s.name}
              </button>
            );
          })}
        </div>
      )}
      {data.suggestions.length === 0 && !data.shop.shop_category_id && <p style={hint}>Choose your shop type in Basics to see suggestions.</p>}
      <label style={label}>Your own (comma-separated, optional)
        <input className="admin-input" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. Birthday cakes, Party packs" />
      </label>
      <Footer busy={busy} onSave={save} next={next} saveLabel="Add categories" />
    </div>
  );
}

// ── 7 Products ───────────────────────────────────────────────────

function Products({ data, next }: StepProps) {
  const done = data.checklist.required.find((r) => r.key === "product")?.done;
  return (
    <div>
      <h2 style={h2}>Products</h2>
      <p style={hint}>{done ? "You have at least one product. Add more any time." : "Add your first product: name, price, photo and stock. Customers see it once your shop is live."}</p>
      <a href="/products?new=1" className="btn-primary" style={{ textDecoration: "none", display: "inline-block" }} data-testid="add-product">Add a product</a>
      <Footer busy={false} next={next} />
    </div>
  );
}

// ── 8 Extras (optional) ──────────────────────────────────────────

function Extras({ data, owner, saved, flash }: StepProps) {
  const [tagline, setTagline] = useState(data.shop.tagline || "");
  const [description, setDescription] = useState(data.shop.description || "");
  const [fb, setFb] = useState(data.shop.fb_page || "");
  const [ig, setIg] = useState(data.shop.instagram || "");
  const { busy, run } = useSave(flash);
  const opt = Object.fromEntries(data.checklist.optional.map((o) => [o.key, o.done]));
  const tick = (k: string) => (opt[k] ? "✓ " : "");

  return (
    <div>
      <h2 style={h2}>Extras (optional)</h2>
      <p style={hint}>Not needed to go live, but they help customers trust and find your shop.</p>
      <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: 12, marginBottom: 16 }} data-testid="shop-link">
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Your shop&apos;s Telegram link</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <code style={{ fontSize: 13, wordBreak: "break-all", flex: 1 }}>{shopLink(data.shop.id)}</code>
          <button className="btn-outline" onClick={async () => flash((await copyLink(shopLink(data.shop.id))) ? "Link copied" : "Copy it from the box", true)}>Copy</button>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
          Share it in your Telegram channel, groups or bio: it opens your shop inside Telegram.{!data.checklist.live && " It works once your shop is live."} Each product has its own link too (🔗 on the Products page).
        </p>
      </div>
      <label style={label}>{tick("description")}Tagline
        <input className="admin-input" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={300} disabled={!owner} placeholder="One line about your shop" />
      </label>
      <label style={label}>Description
        <textarea className="admin-input" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} disabled={!owner} />
      </label>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label style={{ ...label, flex: 1, minWidth: 200 }}>{tick("social")}Facebook page
          <input className="admin-input" value={fb} onChange={(e) => setFb(e.target.value)} maxLength={300} disabled={!owner} placeholder="https://facebook.com/…" />
        </label>
        <label style={{ ...label, flex: 1, minWidth: 200 }}>Instagram
          <input className="admin-input" value={ig} onChange={(e) => setIg(e.target.value)} maxLength={300} disabled={!owner} placeholder="@yourshop" />
        </label>
      </div>
      {owner && <button className="btn-primary" disabled={busy} onClick={() => run(() => api.patch(`/merchants/${data.shop.id}`, {
        tagline: tagline.trim(), description: description.trim(), fb_page: fb.trim(), instagram: ig.trim(),
      }), () => saved())}>Save</button>}

      <h3 style={{ fontSize: 14, fontWeight: 700, margin: "20px 0 6px" }}>{tick("cover")}Cover photos</h3>
      {owner ? <HeroImagesEditor merchantId={data.shop.id} onError={(m) => flash(m, false)} /> : <p style={hint}>The owner can add cover photos.</p>}

      <h3 style={{ fontSize: 14, fontWeight: 700, margin: "20px 0 6px" }}>More</h3>
      <ul style={{ fontSize: 14, lineHeight: 2, paddingLeft: 18 }}>
        <li>{tick("payout")}<a href="/earnings">Payout account (ABA)</a>: where your earnings are sent</li>
        <li>{tick("owner_telegram")}<a href="/staff">Log in with Telegram</a>: add your Telegram ID to your own account under Staff</li>
        <li>{tick("staff")}<a href="/staff">Invite staff</a>: managers and staff with their own logins</li>
      </ul>
    </div>
  );
}
