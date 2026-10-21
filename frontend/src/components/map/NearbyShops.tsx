"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchNearbyShops, type NearbyShop } from "@/lib/addresses";
import { formatKm, getCurrentPosition } from "@/lib/mapbox";

/**
 * "Shops near you", nearest first. Asks for location on tap, not on page
 * load, so the browser permission prompt always has a visible reason.
 */
export default function NearbyShops() {
  const [shops, setShops] = useState<NearbyShop[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "denied" | "error">("idle");

  async function locate() {
    setState("loading");
    const pos = await getCurrentPosition();
    if (!pos) { setState("denied"); return; }
    try {
      setShops(await fetchNearbyShops(pos.lat, pos.lng));
      setState("idle");
    } catch {
      setState("error");
    }
  }

  // Re-use a previous grant silently so returning customers see the list straight away
  useEffect(() => {
    navigator.permissions?.query({ name: "geolocation" as PermissionName })
      .then((p) => { if (p.state === "granted") locate(); })
      .catch(() => {});
  }, []);

  return (
    <section style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--shop-black, #0B0B0F)", margin: "0 0 10px" }}>
        Shops near you
      </h3>

      {shops === null && (
        <button onClick={locate} disabled={state === "loading"} style={{
          width: "100%", padding: 14, borderRadius: "var(--shop-r-input, 12px)",
          border: "1.5px dashed var(--shop-primary, #1E6BFF)", background: "var(--shop-primary-tint, #E8F0FF)",
          color: "var(--shop-primary, #1E6BFF)", fontWeight: 600, fontSize: 14, cursor: "pointer",
        }}>
          {state === "loading" ? "Finding shops…" : "📍 Find shops near me"}
        </button>
      )}
      {state === "denied" && <p style={note}>Location is off. Allow it in your browser settings to see nearby shops.</p>}
      {state === "error" && <p style={note}>Couldn&apos;t load nearby shops. Try again.</p>}

      {shops?.length === 0 && <p style={note}>No shops with a map location near you yet.</p>}
      {shops && shops.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shops.map((s) => (
            <Link key={s.id} href={`/shop/merchant/${s.id}`} style={{
              display: "flex", alignItems: "center", gap: 12, padding: 12, textDecoration: "none",
              background: "var(--shop-surface, #FFFFFF)", borderRadius: "var(--shop-r-card, 16px)",
              boxShadow: "var(--shop-shadow, 0 8px 24px rgba(30,107,255,0.08))",
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, flexShrink: 0, overflow: "hidden",
                background: "var(--shop-primary-tint, #E8F0FF)", display: "flex",
                alignItems: "center", justifyContent: "center", fontSize: 22,
              }}>
                {s.logo_url ? <img src={s.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (s.icon_emoji || "🛍️")}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--shop-black, #0B0B0F)" }}>{s.name}</div>
                <div style={{ fontSize: 12, color: "var(--shop-muted, #8A8F9C)", marginTop: 2 }}>
                  {formatKm(s.distance_km)} away
                </div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, textAlign: "right", color: s.can_deliver ? "#2E7D32" : "#C62828" }}>
                {s.can_deliver ? `Delivery $${Number(s.delivery_fee).toFixed(2)}` : "Pickup only"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

const note: React.CSSProperties = { fontSize: 13, color: "var(--shop-muted, #8A8F9C)", margin: "8px 0 0" };
