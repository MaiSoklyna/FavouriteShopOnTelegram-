"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_TOKEN, MAP_STYLE, formatKm, type LatLng } from "@/lib/mapbox";

export interface MapShop {
  id: number;
  name: string;
  lat: number;
  lng: number;
  logo_url?: string | null;
  distance_km?: number;
}

interface Props {
  you: LatLng;
  shops: MapShop[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** CSS height of the map, e.g. "clamp(200px, 28vh, 260px)". */
  height: string;
}

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

/** Round shop logo with a distance tag under it; selected = bigger with a navy ring. */
function shopEl(s: MapShop, onClick: () => void) {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", s.name);
  el.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:0;padding:0;cursor:pointer;font-family:inherit;";
  const avatar = document.createElement("span");
  avatar.dataset.role = "avatar";
  avatar.style.cssText = "display:grid;place-items:center;overflow:hidden;border-radius:50%;border:3px solid #fff;background:#EEF2F8;color:#103562;font-weight:800;transition:all .18s ease;";
  if (s.logo_url) {
    const img = document.createElement("img");
    img.src = s.logo_url;
    img.alt = "";
    img.style.cssText = "width:100%;height:100%;object-fit:cover;";
    avatar.appendChild(img);
  } else {
    avatar.textContent = initials(s.name);
  }
  const tag = document.createElement("span");
  tag.dataset.role = "tag";
  tag.textContent = s.distance_km != null ? formatKm(s.distance_km) : s.name;
  tag.style.cssText = "height:20px;padding:0 7px;border-radius:999px;display:flex;align-items:center;font-size:10px;font-weight:800;white-space:nowrap;box-shadow:0 2px 6px rgba(8,29,60,.18);";
  el.append(avatar, tag);
  el.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return el;
}

function styleShop(el: HTMLElement, on: boolean) {
  const avatar = el.querySelector<HTMLElement>("[data-role=avatar]")!;
  const tag = el.querySelector<HTMLElement>("[data-role=tag]")!;
  avatar.style.width = avatar.style.height = on ? "54px" : "42px";
  avatar.style.fontSize = on ? "17px" : "13px";
  avatar.style.boxShadow = on ? "0 0 0 3px #103562, 0 8px 18px rgba(8,29,60,.35)" : "0 4px 12px rgba(8,29,60,.25)";
  tag.style.background = on ? "#103562" : "#fff";
  tag.style.color = on ? "#fff" : "#0E1A2B";
  el.style.zIndex = on ? "2" : "1";
}

function youEl() {
  const el = document.createElement("div");
  el.setAttribute("aria-label", "You");
  el.style.cssText = "width:44px;height:44px;border-radius:50%;background:rgba(255,122,26,.22);display:grid;place-items:center;";
  el.innerHTML = '<span style="width:18px;height:18px;border-radius:50%;background:#FF7A1A;border:3px solid #fff;box-sizing:border-box;box-shadow:0 2px 6px rgba(255,122,26,.5)"></span>';
  return el;
}

/** You + nearby shops; tapping a pin selects that shop. Load with `dynamic(..., { ssr: false })`. */
export default function ShopsMap({ you, shops, selectedId, onSelect, height }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef(new Map<number, mapboxgl.Marker>());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [failed, setFailed] = useState(!MAPBOX_TOKEN);

  useEffect(() => {
    if (!box.current || !MAPBOX_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const m = new mapboxgl.Map({
      container: box.current, style: MAP_STYLE, center: [you.lng, you.lat], zoom: 13.5, attributionControl: false,
    });
    m.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");
    new mapboxgl.Marker({ element: youEl(), anchor: "center" }).setLngLat([you.lng, you.lat]).addTo(m);
    m.on("error", (e) => {
      const status = (e as { error?: { status?: number } })?.error?.status;
      if (status === 401 || status === 403) setFailed(true);
    });
    map.current = m;
    return () => { m.remove(); map.current = null; markers.current.clear(); };
  }, [you.lat, you.lng]);

  // (Re)place shop pins and frame them with the customer
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current.clear();
    for (const s of shops) {
      const mk = new mapboxgl.Marker({ element: shopEl(s, () => onSelectRef.current(s.id)), anchor: "top" })
        .setLngLat([s.lng, s.lat]).addTo(m);
      styleShop(mk.getElement(), s.id === selectedId);
      markers.current.set(s.id, mk);
    }
    if (shops.length) {
      const b = new mapboxgl.LngLatBounds([you.lng, you.lat], [you.lng, you.lat]);
      shops.forEach((s) => b.extend([s.lng, s.lat]));
      m.fitBounds(b, { padding: { top: 70, bottom: 90, left: 48, right: 48 }, maxZoom: 15, duration: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shops, you.lat, you.lng]);

  // Selection: restyle pins and bring the chosen one into view
  useEffect(() => {
    markers.current.forEach((mk, id) => styleShop(mk.getElement(), id === selectedId));
    const mk = selectedId != null ? markers.current.get(selectedId) : null;
    const m = map.current;
    if (mk && m && !m.getBounds()?.contains(mk.getLngLat())) m.easeTo({ center: mk.getLngLat(), duration: 400 });
  }, [selectedId]);

  return (
    <div className="relative w-full bg-[#E9EEF5]" style={{ height }}>
      <div ref={box} className="h-full w-full" />
      {failed && (
        <p className="absolute inset-0 grid place-items-center px-6 text-center text-[13px] font-semibold text-ink-500">Map unavailable. The shops are listed below.</p>
      )}
    </div>
  );
}
