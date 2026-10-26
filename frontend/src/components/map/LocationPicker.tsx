"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  DEFAULT_CENTER, MAPBOX_TOKEN, mapStyle, circlePolygon, distanceKm, formatKm, getCurrentPosition, type LatLng,
} from "@/lib/mapbox";
import { describePoint, searchPlaces, type Place } from "@/lib/places";
import { Icon, type IconName } from "@/components/shop/Icon";
import { haptic } from "@/lib/telegram";

export interface PickedLocation {
  pos: LatLng;
  name: string;
  address: string;
}

/** Delivery-zone line under the address: ok → jade, not ok → ruby. */
export interface Zone { ok: boolean; text: string }

export interface Suggestion { id: string | number; name: string; address: string; pos: LatLng; icon: IconName }

interface Props {
  initial?: { pos: LatLng; name?: string; address?: string } | null;
  /** The shop delivering this order: drawn on the map, with its delivery radius. */
  shop?: LatLng | null;
  shopInfo?: { name: string; logo_url?: string | null; icon_emoji?: string | null } | null;
  radiusKm?: number | null;
  /** Custom zone check (e.g. "3 shops deliver here"); otherwise distance vs the shop's radius. */
  zone?: (pos: LatLng) => Promise<Zone | null>;
  /** Shown under the search box before typing — saved addresses. */
  suggestions?: Suggestion[];
  title?: string;
  onConfirm: (loc: PickedLocation) => void;
  onClose: () => void;
}

const NAVY = "#103562";
const SRC_RADIUS = "picker-radius";

/**
 * Full-screen location picker: search a place by name, or move the map under
 * the centre pin. The card at the bottom previews the place, its address and
 * whether it's in the delivery zone, and confirms it. Load with
 * `dynamic(() => import("@/components/map/LocationPicker"), { ssr: false })`.
 */
export default function LocationPicker({ initial, shop, shopInfo, radiusKm, zone, suggestions = [], title = "Delivery location", onConfirm, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  /** Set when the map moves to a place we already have a name for (search hit, saved address). */
  const known = useRef<PickedLocation | null>(null);
  const resolveCtl = useRef<AbortController | null>(null);

  const [picked, setPicked] = useState<PickedLocation | null>(
    initial?.name ? { pos: initial.pos, name: initial.name, address: initial.address || "" } : null,
  );
  const [moving, setMoving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoneState, setZoneState] = useState<Zone | null | "checking">(null);

  const [searching, setSearching] = useState(false); // search panel open
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(false);

  // Lock page scroll behind the overlay
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  async function resolve(pos: LatLng) {
    resolveCtl.current?.abort();
    if (known.current) {
      setPicked(known.current);
      known.current = null;
      return;
    }
    const ctl = new AbortController();
    resolveCtl.current = ctl;
    setResolving(true);
    try {
      const d = await describePoint(pos, ctl.signal);
      if (!ctl.signal.aborted) setPicked({ pos, ...d });
    } catch { /* superseded by a newer move */ }
    finally { if (!ctl.signal.aborted) setResolving(false); }
  }

  useEffect(() => {
    if (!box.current || !MAPBOX_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const start = initial?.pos ?? shop ?? DEFAULT_CENTER;
    const m = new mapboxgl.Map({
      container: box.current, style: mapStyle(), center: [start.lng, start.lat],
      zoom: initial ? 16.5 : 13, attributionControl: false,
    });
    m.addControl(new mapboxgl.AttributionControl({ compact: true }), "top-right");

    if (shop) new mapboxgl.Marker({ element: shopEl(shopInfo), anchor: "center" }).setLngLat([shop.lng, shop.lat]).addTo(m);

    m.on("movestart", () => setMoving(true));
    m.on("moveend", () => {
      setMoving(false);
      const c = m.getCenter();
      resolve({ lat: c.lat, lng: c.lng });
    });
    m.on("load", () => {
      if (shop && radiusKm) {
        m.addSource(SRC_RADIUS, { type: "geojson", data: circlePolygon(shop, radiusKm) });
        m.addLayer({ id: "picker-radius-fill", type: "fill", source: SRC_RADIUS, paint: { "fill-color": NAVY, "fill-opacity": 0.06 } });
        m.addLayer({ id: "picker-radius-line", type: "line", source: SRC_RADIUS, paint: { "line-color": NAVY, "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.6 } });
      }
      setReady(true);
      if (initial && !initial.name) resolve(initial.pos);
    });
    m.on("error", (e) => {
      const status = (e as { error?: { status?: number } })?.error?.status;
      if (status === 401 || status === 403 || !m.getStyle()) setFailed(true);
    });
    map.current = m;
    return () => { resolveCtl.current?.abort(); m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Delivery zone for the place under the pin
  useEffect(() => {
    if (!picked) { setZoneState(null); return; }
    let live = true;
    if (zone) {
      setZoneState("checking");
      zone(picked.pos).then((z) => { if (live) setZoneState(z); }).catch(() => { if (live) setZoneState(null); });
    } else if (shop) {
      const km = distanceKm(picked.pos, shop);
      const who = shopInfo?.name || "the shop";
      setZoneState(radiusKm != null && km > radiusKm
        ? { ok: false, text: `Outside ${who}'s ${radiusKm} km delivery area` }
        : { ok: true, text: `Delivers here · ${formatKm(km)} from ${who}` });
    } else setZoneState(null);
    return () => { live = false; };
  }, [picked?.pos.lat, picked?.pos.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search as you type (debounced; older requests cancelled)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); setLoadingResults(false); return; }
    setLoadingResults(true);
    const ctl = new AbortController();
    const c = map.current?.getCenter();
    const t = setTimeout(() => {
      searchPlaces(q, c ? { lat: c.lat, lng: c.lng } : null, ctl.signal)
        .then((r) => { setResults(r); setLoadingResults(false); })
        .catch((e) => { if ((e as Error).name !== "AbortError") { setResults([]); setLoadingResults(false); } });
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query]);

  function goTo(loc: PickedLocation) {
    haptic("select");
    known.current = loc;
    setSearching(false);
    searchInput.current?.blur();
    const m = map.current;
    if (!m) { setPicked(loc); return; }
    const c = m.getCenter();
    // Already there: no moveend will fire, so set it directly
    if (Math.abs(c.lat - loc.pos.lat) < 1e-6 && Math.abs(c.lng - loc.pos.lng) < 1e-6) { known.current = null; setPicked(loc); return; }
    m.flyTo({ center: [loc.pos.lng, loc.pos.lat], zoom: 17, duration: 900 });
  }

  async function useMyLocation() {
    setLocating(true); setLocError(false);
    const p = await getCurrentPosition();
    setLocating(false);
    if (!p) { setLocError(true); haptic("error"); return; }
    setSearching(false);
    searchInput.current?.blur();
    map.current?.flyTo({ center: [p.lng, p.lat], zoom: 17, duration: 900 });
  }

  const busy = moving || resolving;
  const showPanel = searching;
  const here = map.current?.getCenter();

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-surface" role="dialog" aria-modal aria-label={title}>
      {/* Header: back + search */}
      <div className="relative z-20 bg-card px-gutter pb-3 pt-[max(12px,env(safe-area-inset-top))] shadow-fos-sm">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => (searching ? (setSearching(false), searchInput.current?.blur()) : onClose())} aria-label={searching ? "Back to map" : "Close"}
            className="fos-press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-ink-900">
            <Icon name="back" size={20} strokeWidth={2} />
          </button>
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-surface px-3.5 focus-within:ring-2 focus-within:ring-navy-500">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-ink-500" aria-hidden>
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input ref={searchInput} value={query} onChange={(e) => setQuery(e.target.value)} onFocus={() => setSearching(true)}
              placeholder="Search a place, street or landmark" aria-label="Search places" enterKeyHint="search"
              className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-[14px] font-semibold text-ink-900 outline-none placeholder:font-medium placeholder:text-ink-500" />
            {query && (
              <button type="button" onClick={() => { setQuery(""); searchInput.current?.focus(); }} aria-label="Clear search"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-line text-ink-500"><Icon name="close" size={12} strokeWidth={2.6} /></button>
            )}
          </label>
        </div>
      </div>

      {/* Map with the fixed centre pin */}
      <div className="relative flex-1">
        {/* Inline position: mapbox-gl.css sets .mapboxgl-map { position: relative }, which beats a class */}
        <div ref={box} style={{ position: "absolute", inset: 0 }} />
        {(!ready || failed || !MAPBOX_TOKEN) && (
          <div className="absolute inset-0 grid place-items-center bg-tint-map p-6 text-center">
            {failed || !MAPBOX_TOKEN
              ? <p className="text-[14px] font-bold text-ink-500">The map couldn&apos;t load — search for your place instead.</p>
              : <span className="fos-shimmer absolute inset-0" aria-hidden />}
          </div>
        )}
        {ready && !failed && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2" aria-hidden>
            <div className={`-translate-y-full transition-transform duration-200 ${moving ? "-mt-3" : ""}`}>
              <svg width="44" height="52" viewBox="0 0 40 48" className="drop-shadow-[0_6px_6px_rgba(8,29,60,.3)]">
                <path d="M20 46C20 46 4 28 4 17a16 16 0 0132 0c0 11-16 29-16 29z" fill="#B8862B" />
                <circle cx="20" cy="17" r="6.5" fill="#fff" />
              </svg>
            </div>
            <span className={`absolute left-1/2 top-0 block h-1.5 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-navy-900/30 transition-all duration-200 ${moving ? "w-2.5 opacity-50" : ""}`} />
          </div>
        )}
        {ready && !failed && (
          <button type="button" onClick={useMyLocation} disabled={locating} aria-label="Use my current location"
            className="fos-press absolute bottom-4 right-gutter grid h-12 w-12 place-items-center rounded-full bg-card text-navy-700 shadow-fos-md disabled:opacity-60">
            <Icon name="locate" size={22} strokeWidth={2} className={locating ? "animate-pulse" : ""} />
          </button>
        )}
        {locError && (
          <p className="absolute inset-x-gutter top-3 rounded-thumb bg-card p-2.5 text-center text-caption font-semibold text-ruby-500 shadow-fos-md">
            Couldn&apos;t get your location — allow access, or search for your place.
          </p>
        )}
      </div>

      {/* Preview card */}
      <div className="relative z-10 rounded-t-sheet bg-card px-gutter pb-[calc(16px+env(safe-area-inset-bottom))] pt-3 shadow-fos-lg">
        <span className="mx-auto mb-3 block h-1 w-10 rounded-full bg-line" aria-hidden />
        <div className="flex items-start gap-3" aria-live="polite">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-tint-mango text-mango-500"><Icon name="pin" size={22} strokeWidth={2} /></span>
          <div className="min-h-[60px] min-w-0 flex-1">
            {busy || (!picked && ready) ? (
              busy ? (
                <>
                  <span className="fos-shimmer block h-[18px] w-2/3 rounded-md" />
                  <span className="fos-shimmer mt-2 block h-3 w-11/12 rounded-md" />
                </>
              ) : (
                <>
                  <div className="text-[16px] font-extrabold text-ink-900">Where should we deliver?</div>
                  <div className="text-caption text-ink-500">Search a place above, or move the map under the pin</div>
                </>
              )
            ) : picked ? (
              <>
                <div className="truncate text-[16px] font-extrabold text-ink-900">{picked.name}</div>
                <div className="line-clamp-2 text-caption text-ink-500">{picked.address || "Cambodia"}</div>
              </>
            ) : null}
            {!busy && picked && zoneState && (
              zoneState === "checking"
                ? <span className="mt-2 inline-flex h-6 items-center rounded-full bg-tint-neutral px-2.5 text-[11px] font-bold text-ink-500">Checking delivery…</span>
                : <span className={`mt-2 inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-bold ${zoneState.ok ? "bg-tint-jade text-tone-jade" : "bg-tint-ruby text-ruby-500"}`}>
                    <Icon name={zoneState.ok ? "check" : "alert"} size={12} strokeWidth={2.6} />{zoneState.text}
                  </span>
            )}
          </div>
        </div>
        <button type="button" disabled={!picked || busy}
          onClick={() => { if (picked) { haptic("success"); onConfirm(picked); } }}
          className="fos-press mt-3 h-[52px] w-full rounded-thumb bg-grad-cta text-[15px] font-extrabold text-white shadow-fos-cta disabled:opacity-40 disabled:shadow-none">
          Confirm location
        </button>
      </div>

      {/* Search panel over the map */}
      {showPanel && (
        <div className="absolute inset-x-0 bottom-0 top-[calc(68px+env(safe-area-inset-top))] z-30 overflow-y-auto bg-card px-gutter pb-8">
          {query.trim().length < 2 ? (
            <ul className="pt-1">
              <li>
                <button type="button" onClick={useMyLocation} className="flex w-full items-center gap-3 py-3 text-left">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-tint-navy text-navy-700"><Icon name="locate" size={20} strokeWidth={2} /></span>
                  <span className="text-[14px] font-extrabold text-navy-700">{locating ? "Finding you…" : "Use my current location"}</span>
                </button>
              </li>
              {suggestions.length > 0 && <li className="pb-1 pt-3 text-[11px] font-extrabold uppercase tracking-wide text-ink-500">Saved</li>}
              {suggestions.map((s) => (
                <li key={s.id}>
                  <ResultRow icon={s.icon} name={s.name} address={s.address} onPick={() => goTo({ pos: s.pos, name: s.name, address: s.address })} />
                </li>
              ))}
              <li className="pt-4 text-caption text-ink-500">Try a mall, market, school, bank, street number or district — e.g. “Aeon Mall”, “Street 271”, “Toul Kork”.</li>
            </ul>
          ) : loadingResults && !results ? (
            <ul className="pt-2">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex items-center gap-3 py-3">
                  <span className="fos-shimmer h-10 w-10 shrink-0 rounded-[12px]" />
                  <span className="flex-1"><span className="fos-shimmer block h-3.5 w-1/2 rounded" /><span className="fos-shimmer mt-2 block h-3 w-4/5 rounded" /></span>
                </li>
              ))}
            </ul>
          ) : results && results.length > 0 ? (
            <ul className={`pt-1 transition-opacity ${loadingResults ? "opacity-60" : ""}`}>
              {results.map((r) => (
                <li key={r.id}>
                  <ResultRow icon={r.icon} name={r.name} address={r.address} query={query}
                    distance={here ? formatKm(distanceKm({ lat: here.lat, lng: here.lng }, r.pos)) : undefined}
                    onPick={() => goTo({ pos: r.pos, name: r.name, address: r.address })} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="pt-10 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-surface text-ink-500"><Icon name="map" size={22} /></span>
              <p className="mt-3 text-[14px] font-extrabold text-ink-900">No places found for “{query.trim()}”</p>
              <p className="mt-1 text-caption text-ink-500">Try a nearby landmark or street, or move the pin on the map.</p>
              <button type="button" onClick={() => { setSearching(false); searchInput.current?.blur(); }}
                className="fos-press mt-4 h-10 rounded-full bg-navy-700 px-5 text-[13px] font-extrabold text-white">Pick on the map</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultRow({ icon, name, address, distance, query, onPick }: {
  icon: IconName; name: string; address: string; distance?: string; query?: string; onPick: () => void;
}) {
  return (
    <button type="button" onClick={onPick} className="flex w-full items-center gap-3 border-b border-line py-3 text-left active:bg-surface">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-surface text-navy-700"><Icon name={icon} size={19} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold text-ink-900">{highlight(name, query)}</span>
        <span className="block truncate text-caption text-ink-500">{address}</span>
      </span>
      {distance && <span className="shrink-0 text-[11px] font-bold tabular-nums text-ink-500">{distance}</span>}
    </button>
  );
}

/** Bold the part of the name that matches what was typed. */
function highlight(text: string, query?: string) {
  const q = query?.trim();
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<span className="font-extrabold text-navy-700">{text.slice(i, i + q.length)}</span>{text.slice(i + q.length)}</>;
}

/** Shop badge on the map: round logo/initial with a navy ring. */
function shopEl(info?: Props["shopInfo"]): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `width:36px;height:36px;border-radius:50%;background:#fff;border:3px solid ${NAVY};box-shadow:0 3px 8px rgba(8,29,60,.3);display:flex;align-items:center;justify-content:center;overflow:hidden;font:800 14px sans-serif;color:${NAVY};`;
  if (info?.logo_url) {
    const img = document.createElement("img");
    img.src = info.logo_url; img.alt = "";
    img.style.cssText = "width:100%;height:100%;object-fit:cover;";
    el.appendChild(img);
  } else {
    el.textContent = info?.icon_emoji || (info?.name?.[0] ?? "S").toUpperCase();
  }
  return el;
}
