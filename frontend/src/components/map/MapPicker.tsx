"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { DEFAULT_CENTER, MAPBOX_TOKEN, getCurrentPosition, reverseGeocode, type LatLng } from "@/lib/mapbox";

interface Props {
  /** Current pin; null until the user picks one. */
  value: LatLng | null;
  /** Called when the pin is dragged, the map is tapped, or "my location" resolves. */
  onChange: (pin: LatLng, address: string) => void;
  /** Optional shop marker, so the customer sees how far away it is. */
  shop?: LatLng | null;
  height?: number;
}

/**
 * Tap or drag to drop a delivery pin. Load with
 * `dynamic(() => import("@/components/map/MapPicker"), { ssr: false })`.
 */
export default function MapPicker({ value, onChange, shop, height = 260 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const pin = useRef<mapboxgl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [locating, setLocating] = useState(false);
  const [denied, setDenied] = useState(false);

  async function place(p: LatLng, fly = false) {
    pin.current?.setLngLat([p.lng, p.lat]);
    if (fly) map.current?.flyTo({ center: [p.lng, p.lat], zoom: 15 });
    onChangeRef.current(p, await reverseGeocode(p));
  }

  useEffect(() => {
    if (!box.current || !MAPBOX_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const start = value ?? shop ?? DEFAULT_CENTER;
    const m = new mapboxgl.Map({
      container: box.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [start.lng, start.lat],
      zoom: value ? 15 : 12,
    });
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    const marker = new mapboxgl.Marker({ color: "#1E6BFF", draggable: true })
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

    if (shop) new mapboxgl.Marker({ color: "#E65100" }).setLngLat([shop.lng, shop.lat]).addTo(m);

    map.current = m;
    pin.current = marker;
    return () => { m.remove(); map.current = null; pin.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the marker in step when the parent changes the value (saved address picked)
  useEffect(() => {
    if (!value || !map.current || !pin.current) return;
    const cur = pin.current.getLngLat();
    if (Math.abs(cur.lat - value.lat) < 1e-6 && Math.abs(cur.lng - value.lng) < 1e-6 && pin.current.getElement().isConnected) return;
    if (!pin.current.getElement().isConnected) pin.current.addTo(map.current);
    pin.current.setLngLat([value.lng, value.lat]);
    map.current.flyTo({ center: [value.lng, value.lat], zoom: 15 });
  }, [value?.lat, value?.lng]);

  async function useMyLocation() {
    setLocating(true); setDenied(false);
    const p = await getCurrentPosition();
    setLocating(false);
    if (!p) { setDenied(true); return; }
    if (map.current && pin.current && !pin.current.getElement().isConnected) pin.current.addTo(map.current);
    place(p, true);
  }

  if (!MAPBOX_TOKEN) {
    return (
      <div style={{ ...frame, height, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, textAlign: "center", fontSize: 13, color: "var(--shop-muted, #8A8F9C)" }}>
        Map unavailable (NEXT_PUBLIC_MAPBOX_TOKEN is not set). Type your address instead.
      </div>
    );
  }

  return (
    <div>
      <div style={{ position: "relative" }}>
        <div ref={box} style={{ ...frame, height }} />
        <button type="button" onClick={useMyLocation} disabled={locating} style={locateBtn}>
          {locating ? "Locating…" : "📍 Use my location"}
        </button>
      </div>
      {denied && (
        <p style={{ fontSize: 12, color: "#C62828", marginTop: 6 }}>
          Couldn&apos;t get your location — allow location access, or tap the map to drop a pin.
        </p>
      )}
    </div>
  );
}

const frame: React.CSSProperties = {
  width: "100%", borderRadius: "var(--shop-r-input, 12px)", overflow: "hidden",
  border: "1.5px solid var(--shop-divider, #ECEEF3)", background: "var(--shop-bg, #F7F8FB)",
};

const locateBtn: React.CSSProperties = {
  position: "absolute", left: 10, bottom: 10, padding: "8px 12px",
  borderRadius: 999, border: "none", background: "#FFFFFF", color: "#0B0B0F",
  fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
};
