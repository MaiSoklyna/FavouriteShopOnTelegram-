"use client";

import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { areaName, type HomeLocation } from "@/lib/useHomeLocation";
import type { LatLng } from "@/lib/mapbox";
import type { Zone } from "@/components/map/LocationPicker";

const LocationPicker = dynamic(() => import("@/components/map/LocationPicker"), { ssr: false });

interface Props {
  current: HomeLocation | null;
  onClose: () => void;
  onConfirm: (loc: HomeLocation) => void;
}

/** How many shops deliver to this spot — the Home location's "delivery zone". */
async function shopsDelivering(pos: LatLng): Promise<Zone> {
  const shops = await api.get<{ can_deliver: boolean; is_open: boolean }[]>("/merchants/nearby", {
    params: { lat: pos.lat, lng: pos.lng, radius_km: 15, limit: 50 },
  });
  const n = shops.filter((s) => s.can_deliver).length;
  if (n === 0) return { ok: false, text: shops.length ? "No shop delivers here yet · pickup only" : "No shops nearby yet" };
  return { ok: true, text: n === 1 ? "1 shop delivers here" : `${n} shops deliver here` };
}

/** Where the customer is shopping from: search a place or move the map; the area becomes the Home location. */
export function LocationSheet({ current, onClose, onConfirm }: Props) {
  return (
    <LocationPicker
      title="Where to?"
      initial={current ? { pos: { lat: current.lat, lng: current.lng } } : null}
      zone={shopsDelivering}
      onClose={onClose}
      onConfirm={(loc) => onConfirm({
        lat: loc.pos.lat, lng: loc.pos.lng,
        area: loc.name.length <= 24 ? loc.name : areaName(loc.address),
      })}
    />
  );
}
