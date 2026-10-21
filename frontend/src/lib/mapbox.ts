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

export const formatKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);
