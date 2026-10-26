"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchNearbyShops, type NearbyShop } from "@/lib/addresses";
import { formatEta, formatKm, getCurrentPosition, searchAddress, type GeocodeHit, type LatLng } from "@/lib/mapbox";
import { haptic } from "@/lib/telegram";
import { EmptyStateIcon } from "@/components/brand/Icons";

type State = "idle" | "loading" | "denied" | "error" | "ready";

const PAGE = 20;

/**
 * "Shops near you", open shops nearest first, closed ones last. Asks for
 * location on tap, not on page load, so the permission prompt always has a
 * visible reason. Every number on a card comes from the server.
 */
export default function NearbyShops() {
  const [shops, setShops] = useState<NearbyShop[]>([]);
  const [state, setState] = useState<State>("idle");
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const origin = useRef<LatLng | null>(null);

  async function load(pos: LatLng) {
    origin.current = pos;
    setState("loading");
    try {
      const rows = await fetchNearbyShops(pos.lat, pos.lng, 0, PAGE);
      setShops(rows);
      setMore(rows.length === PAGE);
      setState("ready");
      haptic("light");
    } catch {
      setState("error");
      haptic("error");
    }
  }

  async function locate() {
    setState("loading");
    const pos = await getCurrentPosition();
    if (!pos) { setState("denied"); return; }
    load(pos);
  }

  async function showMore() {
    if (!origin.current) return;
    setLoadingMore(true);
    try {
      const rows = await fetchNearbyShops(origin.current.lat, origin.current.lng, shops.length, PAGE);
      setShops((cur) => [...cur, ...rows]);
      setMore(rows.length === PAGE);
    } catch { /* keep what we have; the button stays for another try */ }
    setLoadingMore(false);
  }

  // Re-use a previous grant silently so returning customers see the list straight away
  useEffect(() => {
    navigator.permissions?.query({ name: "geolocation" as PermissionName })
      .then((p) => { if (p.state === "granted") locate(); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The closest shop that is open and delivers to the customer (the server sorts open shops first)
  const nearestId = shops.find((s) => s.is_open && s.can_deliver)?.id;
  const refresh = () => (origin.current ? load(origin.current) : locate());

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 12px" }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--shop-black)", margin: 0 }}>Shops near you</h3>
        {state === "ready" && shops.length > 0 && (
          <button onClick={refresh} aria-label="Refresh nearby shops" style={linkBtn}>↻ Refresh</button>
        )}
      </div>

      {state === "idle" && (
        <StateCard icon="📍" title="See shops around you" text="Share your location to find the nearest shops, their delivery fee and time.">
          <button onClick={locate} style={primaryBtn}>Find shops near me</button>
        </StateCard>
      )}

      {state === "loading" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-busy="true">
          {[0, 1].map((i) => <ShopCardSkeleton key={i} />)}
        </div>
      )}

      {state === "denied" && (
        <StateCard icon="🔒" title="Location is off" text="Allow location access and try again, or type where you are.">
          <button onClick={locate} style={primaryBtn}>Try again</button>
          <ManualAddress onPick={(hit) => load(hit.pos)} />
        </StateCard>
      )}

      {state === "error" && (
        <StateCard icon="⚠️" title="Couldn't load shops" text="Check your connection and try again.">
          <button onClick={refresh} style={primaryBtn}>Retry</button>
        </StateCard>
      )}

      {state === "ready" && shops.length === 0 && (
        <StateCard icon={<EmptyStateIcon size={44} style={{ color: "var(--shop-primary)" }} />} title="No shops nearby" text="Try expanding your search area.">
          <button onClick={refresh} style={primaryBtn}>Refresh</button>
        </StateCard>
      )}

      {state === "ready" && shops.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {shops.map((s) => <ShopCard key={s.id} shop={s} nearest={s.id === nearestId} />)}
          {more && (
            <button onClick={showMore} disabled={loadingMore} style={{ ...linkBtn, minHeight: 44, alignSelf: "center" }}>
              {loadingMore ? "Loading…" : "Show more shops"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function ShopCard({ shop: s, nearest }: { shop: NearbyShop; nearest: boolean }) {
  const fee = s.delivery_fee == null ? null : Number(s.delivery_fee);
  const closed = !s.is_open;
  return (
    <Link href={`/shop/merchant/${s.id}`} onClick={() => haptic("select")} className="shop-press shop-fade-up" style={{
      display: "block", padding: 14, textDecoration: "none", color: "inherit",
      background: "var(--shop-surface)", borderRadius: "var(--shop-r-card)",
      boxShadow: "var(--shop-shadow)",
      border: nearest ? "1.5px solid var(--shop-primary)" : "1.5px solid transparent",
      opacity: closed ? 0.6 : 1,
    }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14, flexShrink: 0, overflow: "hidden",
          background: "var(--shop-primary-tint)", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, fontWeight: 700, color: "var(--shop-primary)",
        }}>
          {s.logo_url ? <img src={s.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials(s.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--shop-black)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
              {s.name}
            </span>
            {nearest && <Pill bg="var(--shop-primary)" fg="#fff">Nearest</Pill>}
            {s.is_open
              ? <Pill bg="var(--shop-success-tint)" fg="var(--shop-success)">Open</Pill>
              : <Pill bg="var(--shop-danger-tint)" fg="var(--shop-danger)">Closed</Pill>}
          </div>
          <div style={{ fontSize: 12, color: "var(--shop-muted)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {s.rating != null && <span style={{ color: "var(--shop-warning)", fontWeight: 700 }}>★ {Number(s.rating).toFixed(1)}{s.review_count ? ` (${s.review_count})` : ""} · </span>}
            {s.tagline || s.address || "Local shop"}
          </div>
        </div>
      </div>

      {/* The facts a shopper decides on: how far, what it costs, how long, can they get it */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <Chip>📍 {formatKm(s.distance_km)} away</Chip>
        {s.can_deliver && fee !== null ? (
          <>
            <Chip tone="good">🚚 {fee === 0 ? "Free delivery" : `$${fee.toFixed(2)} delivery`}</Chip>
            <Chip>⏱ {formatEta(s.eta_minutes, s.eta_max_minutes)}</Chip>
          </>
        ) : (
          <Chip tone="bad">🏪 Pickup only{s.delivery_unavailable_reason ? " · too far to deliver" : ""}</Chip>
        )}
        {s.min_order_amount && Number(s.min_order_amount) > 0 && <Chip>Min ${Number(s.min_order_amount).toFixed(2)}</Chip>}
      </div>

      <div style={{
        marginTop: 12, minHeight: 44, borderRadius: "var(--shop-r-input)", display: "flex", alignItems: "center", justifyContent: "center",
        background: nearest ? "var(--shop-primary)" : "var(--shop-primary-tint)",
        color: nearest ? "#fff" : "var(--shop-primary)", fontWeight: 700, fontSize: 14,
      }}>
        View shop
      </div>
    </Link>
  );
}

/** Type an address instead of sharing location. */
function ManualAddress({ onPick }: { onPick: (hit: GeocodeHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setHits(await searchAddress(q));
    setSearched(true);
    setBusy(false);
  }

  return (
    <div style={{ marginTop: 16, textAlign: "left" }}>
      <form onSubmit={search} style={{ display: "flex", gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Street, district or landmark" aria-label="Your address"
          style={{ flex: 1, minHeight: 44, padding: "0 14px", borderRadius: "var(--shop-r-input)", border: "1.5px solid var(--shop-divider)", background: "var(--shop-bg)", color: "var(--shop-black)", fontSize: 14 }} />
        <button type="submit" disabled={busy || q.trim().length < 3} style={{ ...primaryBtn, padding: "0 16px", opacity: busy || q.trim().length < 3 ? 0.55 : 1 }}>
          {busy ? "…" : "Search"}
        </button>
      </form>
      {searched && hits.length === 0 && <p style={{ fontSize: 12, color: "var(--shop-muted)", margin: "8px 0 0" }}>No match. Try a nearby landmark.</p>}
      {hits.map((h) => (
        <button key={h.label} onClick={() => onPick(h)} style={{
          display: "block", width: "100%", textAlign: "left", minHeight: 44, padding: "10px 4px", background: "none", border: "none",
          borderBottom: "1px solid var(--shop-divider)", fontSize: 13, color: "var(--shop-text)", cursor: "pointer",
        }}>📍 {h.label}</button>
      ))}
    </div>
  );
}

function ShopCardSkeleton() {
  return (
    <div style={{ padding: 14, background: "var(--shop-surface)", borderRadius: "var(--shop-r-card)", boxShadow: "var(--shop-shadow)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div className="shop-skeleton" style={{ width: 56, height: 56, borderRadius: 14 }} />
        <div style={{ flex: 1 }}>
          <div className="shop-skeleton" style={{ height: 14, width: "55%", borderRadius: 6 }} />
          <div className="shop-skeleton" style={{ height: 11, width: "35%", borderRadius: 6, marginTop: 8 }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {[84, 96, 72].map((w) => <div key={w} className="shop-skeleton" style={{ height: 26, width: w, borderRadius: 999 }} />)}
      </div>
      <div className="shop-skeleton" style={{ height: 44, borderRadius: "var(--shop-r-input)", marginTop: 12 }} />
    </div>
  );
}

function StateCard({ icon, title, text, children }: { icon: React.ReactNode; title: string; text: string; children?: React.ReactNode }) {
  return (
    <div style={{
      textAlign: "center", padding: "28px 20px", background: "var(--shop-surface)",
      borderRadius: "var(--shop-r-card)", boxShadow: "var(--shop-shadow)",
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: "50%", margin: "0 auto 12px", fontSize: 30,
        background: "var(--shop-primary-tint)", display: "flex", alignItems: "center", justifyContent: "center",
      }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 15, color: "var(--shop-black)" }}>{title}</div>
      <p style={{ fontSize: 13, color: "var(--shop-muted)", margin: "6px 0 16px", lineHeight: 1.5 }}>{text}</p>
      {children}
    </div>
  );
}

function Pill({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return (
    <span style={{ padding: "2px 8px", borderRadius: 999, background: bg, color: fg, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function Chip({ tone, children }: { tone?: "good" | "bad"; children: React.ReactNode }) {
  const c = tone === "good" ? ["var(--shop-success-tint)", "var(--shop-success)"]
    : tone === "bad" ? ["var(--shop-danger-tint)", "var(--shop-danger)"]
    : ["var(--shop-bg)", "var(--shop-text)"];
  return (
    <span style={{ padding: "5px 10px", borderRadius: 999, background: c[0], color: c[1], fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "🛍️";

const primaryBtn: React.CSSProperties = {
  minHeight: 44, padding: "0 24px", borderRadius: "var(--shop-r-input)", border: "none",
  background: "var(--shop-primary)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
};

const linkBtn: React.CSSProperties = {
  background: "none", border: "none", color: "var(--shop-primary)", fontWeight: 700, fontSize: 13,
  cursor: "pointer", minHeight: 36, padding: "0 4px",
};
