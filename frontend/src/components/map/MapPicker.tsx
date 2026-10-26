"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  DEFAULT_CENTER, MAPBOX_TOKEN, mapStyle, circlePolygon, distanceKm, formatKm,
  getCurrentPosition, reverseGeocode, type LatLng,
} from "@/lib/mapbox";

interface ShopInfo {
  name: string;
  logo_url?: string | null;
  icon_emoji?: string | null;
}

interface Props {
  /** Current pin; null until the user picks one. */
  value: LatLng | null;
  /** Called when the pin is dragged, the map is tapped, or "my location" resolves. */
  onChange: (pin: LatLng, address: string) => void;
  /** Optional shop marker, so the customer sees how far away it is. */
  shop?: LatLng | null;
  shopInfo?: ShopInfo | null;
  /** Draws the delivery radius around the shop and flags pins outside it. */
  radiusKm?: number | null;
  height?: number;
  /** Floating "Use my location" button (off when the parent has its own). */
  showLocate?: boolean;
}

const PRIMARY = "#71541A";
const SRC_RADIUS = "delivery-radius";
const SRC_ROUTE = "delivery-route";

/**
 * Tap or drag to drop a delivery pin. Load with
 * `dynamic(() => import("@/components/map/MapPicker"), { ssr: false })`.
 */
export default function MapPicker({
  value, onChange, shop, shopInfo, radiusKm, height = 260, showLocate = true,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const pin = useRef<mapboxgl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [denied, setDenied] = useState(false);

  async function place(p: LatLng, fly = false) {
    pin.current?.setLngLat([p.lng, p.lat]);
    if (fly) map.current?.flyTo({ center: [p.lng, p.lat], zoom: 15 });
    onChangeRef.current(p, await reverseGeocode(p));
  }

  /** Dashed line pin → shop, kept in step with the pin. */
  function drawRoute() {
    const src = map.current?.getSource(SRC_ROUTE) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    const v = valueRef.current;
    src.setData({
      type: "FeatureCollection",
      features: v && shop ? [{
        type: "Feature", properties: {},
        geometry: { type: "LineString", coordinates: [[v.lng, v.lat], [shop.lng, shop.lat]] },
      }] : [],
    });
  }

  useEffect(() => {
    if (!box.current || !MAPBOX_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const start = value ?? shop ?? DEFAULT_CENTER;
    const m = new mapboxgl.Map({
      container: box.current,
      style: mapStyle(),
      center: [start.lng, start.lat],
      zoom: value ? 15 : 13,
      attributionControl: false,
    });
    m.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    const marker = new mapboxgl.Marker({ element: customerEl(), draggable: true, anchor: "bottom" })
      .setLngLat([start.lng, start.lat]);
    if (value) marker.addTo(m);
    marker.on("dragend", () => {
      const { lat, lng } = marker.getLngLat();
      place({ lat, lng });
    });
    m.on("click", (e) => {
      if (!marker.getElement().isConnected) marker.addTo(m);
      place({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    if (shop) new mapboxgl.Marker({ element: shopEl(shopInfo), anchor: "center" }).setLngLat([shop.lng, shop.lat]).addTo(m);

    m.on("load", () => {
      if (shop && radiusKm) {
        m.addSource(SRC_RADIUS, { type: "geojson", data: circlePolygon(shop, radiusKm) });
        m.addLayer({ id: "radius-fill", type: "fill", source: SRC_RADIUS, paint: { "fill-color": PRIMARY, "fill-opacity": 0.08 } });
        m.addLayer({ id: "radius-line", type: "line", source: SRC_RADIUS, paint: { "line-color": PRIMARY, "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.7 } });
      }
      m.addSource(SRC_ROUTE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "route-line", type: "line", source: SRC_ROUTE, paint: { "line-color": PRIMARY, "line-width": 2.5, "line-dasharray": [1, 1.6] } });
      drawRoute();

      // Frame the shop and its delivery area, or the shop and the pin
      const v = valueRef.current;
      if (shop && v) {
        m.fitBounds(new mapboxgl.LngLatBounds([shop.lng, shop.lat], [shop.lng, shop.lat]).extend([v.lng, v.lat]), { padding: 70, maxZoom: 16, duration: 0 });
      } else if (shop && radiusKm) {
        const b = new mapboxgl.LngLatBounds();
        circlePolygon(shop, radiusKm).geometry.coordinates[0].forEach((c) => b.extend(c as [number, number]));
        m.fitBounds(b, { padding: 24, duration: 0 });
      }
      setReady(true);
    });
    // A bad/expired token or blocked style surfaces here — show a message instead of an endless skeleton
    // (a single missing tile is not fatal — only auth/style failures or a long stall)
    m.on("error", (e) => {
      const status = (e as { error?: { status?: number } })?.error?.status;
      if (status === 401 || status === 403 || !m.getStyle()) setFailed(true);
    });
    const stall = setTimeout(() => { if (!m.loaded()) setFailed(true); }, 15000);

    map.current = m;
    pin.current = marker;
    return () => { clearTimeout(stall); m.remove(); map.current = null; pin.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the marker in step when the parent changes the value (saved address picked)
  useEffect(() => {
    drawRoute();
    if (!value || !map.current || !pin.current) return;
    const cur = pin.current.getLngLat();
    if (Math.abs(cur.lat - value.lat) < 1e-6 && Math.abs(cur.lng - value.lng) < 1e-6 && pin.current.getElement().isConnected) return;
    if (!pin.current.getElement().isConnected) pin.current.addTo(map.current);
    pin.current.setLngLat([value.lng, value.lat]);
    if (shop) {
      map.current.fitBounds(new mapboxgl.LngLatBounds([shop.lng, shop.lat], [shop.lng, shop.lat]).extend([value.lng, value.lat]), { padding: 70, maxZoom: 16 });
    } else {
      map.current.flyTo({ center: [value.lng, value.lat], zoom: 15 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng]);

  async function useMyLocation() {
    setLocating(true); setDenied(false);
    const p = await getCurrentPosition();
    setLocating(false);
    if (!p) { setDenied(true); return; }
    if (map.current && pin.current && !pin.current.getElement().isConnected) pin.current.addTo(map.current);
    place(p, true);
  }

  if (!MAPBOX_TOKEN || failed) {
    return (
      <div style={{ ...frame, height, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 16, textAlign: "center" }}>
        <span style={{ fontSize: 26 }}>🗺️</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--shop-black)" }}>Map unavailable</span>
        <span style={{ fontSize: 12, color: "var(--shop-muted)" }}>
          {failed ? "The map couldn't load. Check your connection and try again." : "Type your address instead."}
        </span>
      </div>
    );
  }

  // Distance chip: how far the pin is from the shop, and whether the shop delivers that far
  const km = value && shop ? distanceKm(value, shop) : null;
  const outOfRange = km !== null && radiusKm != null && km > radiusKm;

  return (
    <div>
      <div style={{ position: "relative" }}>
        <div ref={box} style={{ ...frame, height }} />

        {!ready && <MapSkeleton height={height} />}

        {ready && km !== null && (
          <div style={{
            position: "absolute", top: 10, left: 10, right: 52, display: "flex", pointerEvents: "none",
          }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999,
              background: "var(--shop-surface)", boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
              fontSize: 12, fontWeight: 700, color: outOfRange ? "var(--shop-danger)" : "var(--shop-black)",
            }}>
              {outOfRange ? "⚠️ Too far to deliver" : `📍 ${formatKm(km)} from ${shopInfo?.name || "the shop"}`}
            </span>
          </div>
        )}

        {ready && !value && (
          <div style={{ position: "absolute", top: 10, left: 10, pointerEvents: "none" }}>
            <span style={{ padding: "6px 12px", borderRadius: 999, background: "var(--shop-surface)", boxShadow: "0 2px 10px rgba(0,0,0,0.18)", fontSize: 12, fontWeight: 600, color: "var(--shop-black)" }}>
              Tap the map to drop your pin
            </span>
          </div>
        )}

        {showLocate && ready && (
          <button type="button" onClick={useMyLocation} disabled={locating} style={locateBtn}>
            {locating ? "Locating…" : "📍 Use my location"}
          </button>
        )}
      </div>
      {denied && (
        <p style={{ fontSize: 12, color: "var(--shop-danger)", marginTop: 6 }}>
          Couldn&apos;t get your location — allow location access, or tap the map to drop a pin.
        </p>
      )}
    </div>
  );
}

/** Loading placeholder: shimmering tiles + a bouncing pin, never a flat grey box. */
function MapSkeleton({ height }: { height: number }) {
  return (
    <div className="shop-skeleton" aria-busy="true" style={{
      position: "absolute", inset: 0, height, borderRadius: "var(--shop-r-input)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
    }}>
      <span className="map-pin-bounce" style={{ fontSize: 34, lineHeight: 1 }}>📍</span>
      <span className="map-pin-shadow" style={{ width: 22, height: 6, borderRadius: "50%", background: "#000" }} />
      <span style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: "var(--shop-muted)" }}>Loading map…</span>
    </div>
  );
}

/** Customer pin: pulsing dot with a pointer, draggable. */
function customerEl(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "width:40px;height:48px;position:relative;cursor:grab;";
  el.innerHTML = `
    <span class="map-pulse" style="position:absolute;left:8px;bottom:-4px;width:24px;height:24px;border-radius:50%;background:${PRIMARY};"></span>
    <svg width="40" height="48" viewBox="0 0 40 48" style="position:absolute;inset:0;filter:drop-shadow(0 3px 4px rgba(0,0,0,.3))">
      <path d="M20 46C20 46 4 28 4 17a16 16 0 0132 0c0 11-16 29-16 29z" fill="${PRIMARY}"/>
      <circle cx="20" cy="17" r="6.5" fill="#fff"/>
    </svg>`;
  return el;
}

/** Shop pin: round badge with the logo/emoji and the shop name. */
function shopEl(info?: ShopInfo | null): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "position:relative;width:40px;height:40px;";
  const badge = document.createElement("div");
  badge.style.cssText = "width:40px;height:40px;border-radius:50%;background:#fff;border:3px solid #081D3C;box-shadow:0 3px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:20px;overflow:hidden;";
  if (info?.logo_url) {
    const img = document.createElement("img");
    img.src = info.logo_url; img.alt = "";
    img.style.cssText = "width:100%;height:100%;object-fit:cover;";
    badge.appendChild(img);
  } else {
    badge.textContent = info?.icon_emoji || "🏪";
  }
  el.appendChild(badge);
  if (info?.name) {
    const label = document.createElement("div");
    label.textContent = info.name;
    label.style.cssText = "position:absolute;top:44px;left:50%;transform:translateX(-50%);max-width:110px;padding:2px 8px;border-radius:999px;background:#081D3C;color:#fff;font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    el.appendChild(label);
  }
  return el;
}

const frame: React.CSSProperties = {
  width: "100%", borderRadius: "var(--shop-r-input)", overflow: "hidden",
  border: "1.5px solid var(--shop-divider)", background: "var(--shop-bg)",
};

const locateBtn: React.CSSProperties = {
  position: "absolute", left: 10, bottom: 10, padding: "10px 14px", minHeight: 40,
  borderRadius: 999, border: "none", background: "var(--shop-surface)", color: "var(--shop-black)",
  fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,0.22)",
};
