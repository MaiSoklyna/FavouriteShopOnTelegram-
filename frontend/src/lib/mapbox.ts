/**
 * Mapbox helpers shared by the map components.
 *
 * Needs NEXT_PUBLIC_MAPBOX_TOKEN (a public `pk.` token, restricted to your
 * domains in the Mapbox dashboard). Without it the map shows a notice and
 * checkout falls back to the default delivery fee.
 */

export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export interface LatLng {
  lat: number;
  lng: number;
}

/** Phnom Penh — where the map opens when we have no pin and no GPS. */
export const DEFAULT_CENTER: LatLng = { lat: 11.5564, lng: 104.9282 };

/** Ask the browser for the customer's position. Resolves null on denial/timeout. */
export function getCurrentPosition(): Promise<LatLng | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

/** Street address for a pin. Returns "" when geocoding is unavailable. */
export async function reverseGeocode({ lat, lng }: LatLng): Promise<string> {
  if (!MAPBOX_TOKEN) return "";
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?limit=1&access_token=${MAPBOX_TOKEN}`,
    );
    if (!res.ok) return "";
    const data = await res.json();
    return data.features?.[0]?.place_name || "";
  } catch {
    return "";
  }
}

/** Straight-line km — display only; the backend recomputes the charged distance. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

/** "< 50 m", "300 m" under a kilometre, otherwise "3.2 km". */
export const formatKm = (km: number) =>
  km < 0.05 ? "< 50 m" : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;

/**
 * Light, low-contrast basemap so pins, the radius and the route read first
 * (the Grab / Foodpanda look). Swap for a custom Mapbox Studio style URL
 * (`mapbox://styles/<user>/<id>`) to brand it further.
 */
export const MAP_STYLE = "mapbox://styles/mapbox/light-v11";

/** "10–20 min" from the server's eta window. */
export const formatEta = (min: number, max: number) => `${min}–${max} min`;

export interface GeocodeHit {
  label: string;
  pos: LatLng;
}

/** Address search (Cambodia only) for customers who won't share their location. */
export async function searchAddress(query: string): Promise<GeocodeHit[]> {
  const q = query.trim();
  if (!MAPBOX_TOKEN || q.length < 3) return [];
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=kh&limit=5&access_token=${MAPBOX_TOKEN}`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features || []).map((f: { place_name: string; center: [number, number] }) => ({
      label: f.place_name,
      pos: { lat: f.center[1], lng: f.center[0] },
    }));
  } catch {
    return [];
  }
}

/** GeoJSON polygon approximating a circle of `radiusKm` around `center` (for the delivery radius). */
export function circlePolygon(center: LatLng, radiusKm: number, steps = 72): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const dLat = radiusKm / 110.574;
  const dLng = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    coords.push([center.lng + dLng * Math.cos(t), center.lat + dLat * Math.sin(t)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}
