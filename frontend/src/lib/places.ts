/**
 * Place search for the location picker: malls, landmarks, businesses, streets
 * and areas in Cambodia, by name.
 *
 * Mapbox's Cambodian data has almost no shops, malls or numbered streets
 * ("Aeon Mall", "Olympia Mall", "Street 271" all return nothing), so search and
 * reverse lookup use Photon (OpenStreetMap data, photon.komoot.io). Mapbox is
 * kept for district/area names, which it does well, and as the fallback when
 * Photon is unreachable. Photon's public server is fair-use with no SLA — set
 * NEXT_PUBLIC_PHOTON_URL to a self-hosted instance before a large launch.
 */
import { MAPBOX_TOKEN, distanceKm, reverseGeocode, type LatLng } from "./mapbox";
import type { IconName } from "@/components/shop/Icon";

const PHOTON = (process.env.NEXT_PUBLIC_PHOTON_URL || "https://photon.komoot.io").replace(/\/$/, "");
/** Cambodia, as Photon's bbox (minLon,minLat,maxLon,maxLat) */
const KH_BBOX = "102.3,10.4,107.7,14.7";
const PHNOM_PENH: LatLng = { lat: 11.5564, lng: 104.9282 };

export interface Place {
  id: string;
  /** Headline: "AEON Mall 1", "Street 271", "Toul Kork District" */
  name: string;
  /** Rest of the address: "Samdech Sothearos Blvd, Koh Pich, Khan Chamkar Mon, Phnom Penh" */
  address: string;
  pos: LatLng;
  icon: IconName;
}

interface PhotonProps {
  osm_id?: number; osm_type?: string; osm_key?: string; osm_value?: string; type?: string;
  name?: string; housenumber?: string; street?: string; locality?: string; district?: string;
  city?: string; county?: string; state?: string; countrycode?: string;
}
interface PhotonFeature { geometry: { coordinates: [number, number] }; properties: PhotonProps }

/** "Phnom Penh Municipality" → "Phnom Penh"; Photon gives Khmer for some areas, which we keep. */
const tidy = (s?: string) => (s || "").replace(/\s+(Municipality|Province)$/i, "").trim();

function iconFor(p: PhotonProps): IconName {
  const v = p.osm_value || "";
  if (p.osm_key === "highway") return "map";
  if (["mall", "supermarket", "department_store", "convenience", "marketplace"].includes(v)) return "bag";
  if (["restaurant", "cafe", "fast_food", "bar", "food_court"].includes(v)) return "cup";
  if (["bank", "atm"].includes(v)) return "store";
  if (["school", "university", "college", "kindergarten"].includes(v)) return "list";
  if (["hotel", "guest_house", "hostel", "apartments", "house", "residential"].includes(v)) return "home";
  if (["office", "company", "coworking"].includes(v) || p.osm_key === "office") return "work";
  if (p.type === "district" || p.type === "city" || p.type === "locality" || p.osm_key === "place") return "pin";
  return p.osm_key === "shop" || p.osm_key === "amenity" ? "store" : "pin";
}

function addressOf(p: PhotonProps, skipStreet = false): string {
  const parts = [
    p.housenumber && p.street && !skipStreet ? `${p.housenumber} ${p.street}` : skipStreet ? "" : p.street,
    p.locality, p.district, p.city, tidy(p.state) || tidy(p.county),
  ];
  return Array.from(new Set(parts.map((x) => (x || "").trim()).filter(Boolean))).join(", ");
}

function fromPhoton(f: PhotonFeature): Place | null {
  const p = f.properties;
  if (p.countrycode && p.countrycode !== "KH") return null;
  const name = p.name || (p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street);
  if (!name) return null;
  const isStreet = p.osm_key === "highway";
  return {
    id: `osm:${p.osm_type}${p.osm_id}`,
    name,
    address: addressOf(p, isStreet || name === p.street) || "Cambodia",
    pos: { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] },
    icon: iconFor(p),
  };
}

async function photonSearch(q: string, near: LatLng, signal?: AbortSignal): Promise<Place[]> {
  const url = `${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=10&lang=en&bbox=${KH_BBOX}&lat=${near.lat}&lon=${near.lng}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const data = (await res.json()) as { features?: PhotonFeature[] };
  // Bus stops and traffic lights named after a place crowd out the place itself
  const noise = new Set(["bus_stop", "traffic_signals", "crossing", "platform", "stop_position"]);
  return (data.features || [])
    .filter((f) => !noise.has(f.properties.osm_value || ""))
    .map(fromPhoton).filter((x): x is Place => !!x);
}

/** Districts, sangkats and towns — the one thing Mapbox knows well in Cambodia. */
async function mapboxAreas(q: string, near: LatLng, signal?: AbortSignal): Promise<Place[]> {
  if (!MAPBOX_TOKEN) return [];
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=kh&limit=3&language=en`
    + `&types=place,district,locality,neighborhood&proximity=${near.lng},${near.lat}&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as { features?: { id: string; text: string; place_name: string; center: [number, number] }[] };
  return (data.features || []).map((f) => ({
    id: `mbx:${f.id}`,
    name: f.text,
    address: f.place_name.split(",").slice(1).map((s) => s.trim()).filter((s) => s && !/^\d+$/.test(s)).join(", ") || "Cambodia",
    pos: { lat: f.center[1], lng: f.center[0] },
    icon: "pin" as IconName,
  }));
}

/**
 * Places matching what the customer typed, nearest relevant first. Areas
 * whose name starts with the query lead ("Toul Kork" → the district).
 */
export async function searchPlaces(query: string, near: LatLng | null, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const at = near ?? PHNOM_PENH;
  const [osm, areas] = await Promise.all([
    photonSearch(q, at, signal).catch((e) => { if ((e as Error).name === "AbortError") throw e; return null; }),
    mapboxAreas(q, at, signal).catch(() => [] as Place[]),
  ]);
  const lead = areas.filter((a) => a.name.toLowerCase().startsWith(q.toLowerCase().slice(0, 4)));
  const merged = [...lead, ...(osm ?? areas.filter((a) => !lead.includes(a)))];
  // Same name within ~150 m is the same place (a mall and its entrance node, a street's segments)
  const out: Place[] = [];
  for (const p of merged) {
    if (out.some((o) => o.name.toLowerCase() === p.name.toLowerCase() && distanceKm(o.pos, p.pos) < 0.15)) continue;
    out.push(p);
  }
  return out.slice(0, 8);
}

/**
 * A readable label for a dropped pin: the place under it when there is one
 * within a few metres, otherwise the street, with the nearest landmark as a hint.
 */
export async function describePoint(pos: LatLng, signal?: AbortSignal): Promise<{ name: string; address: string }> {
  try {
    const res = await fetch(`${PHOTON}/reverse?lat=${pos.lat}&lon=${pos.lng}&limit=5&lang=en&radius=0.3`, { signal });
    if (!res.ok) throw new Error(`photon ${res.status}`);
    const feats = ((await res.json()) as { features?: PhotonFeature[] }).features || [];
    const kh = feats.filter((f) => !f.properties.countrycode || f.properties.countrycode === "KH");
    if (kh.length) {
      const near = kh[0];
      const p = near.properties;
      const metres = distanceKm(pos, { lat: near.geometry.coordinates[1], lng: near.geometry.coordinates[0] }) * 1000;
      const street = kh.map((f) => f.properties.street).find(Boolean);
      const area = addressOf({ ...p, street: undefined, housenumber: undefined });
      if (p.name && metres <= 25) return { name: p.name, address: [street, area].filter(Boolean).join(", ") };
      if (street) return { name: street, address: [p.name ? `Near ${p.name}` : "", area].filter(Boolean).join(" · ") };
      if (p.name) return { name: `Near ${p.name}`, address: area };
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
  }
  // Photon unreachable or nothing nearby: Mapbox's address, minus the leading postcode
  const full = await reverseGeocode(pos).catch(() => "");
  const parts = full.split(",").map((s) => s.trim()).filter((s) => s && !/^\d+$/.test(s));
  return { name: parts[0] || "Pinned location", address: parts.slice(1).join(", ") };
}

/** One line for the order's delivery_address: "Details, Name, Address". */
export function placeLabel(p: { name: string; address: string }, details?: string): string {
  return [details?.trim(), p.name, p.address].filter(Boolean).join(", ");
}
