"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** Can a shop deliver to the customer's location? (GET /merchants/{id}/delivery-check, any distance) */
export interface DeliveryCheck {
  located: boolean;          // false: the shop hasn't set its map location
  distance_km?: number;
  radius_km: number;
  can_deliver: boolean;
  delivery_fee?: string | null;
  reason?: string | null;
  eta_minutes?: number | null;
  eta_max_minutes?: number | null;
  is_open: boolean;
  pickup: boolean;           // pickup orders are always possible
}

/** The check for `merchantId` from `location` (null until both are known, or if it fails). */
export function useDeliveryCheck(merchantId: number | null | undefined, location: { lat: number; lng: number } | null) {
  const [check, setCheck] = useState<DeliveryCheck | null>(null);
  useEffect(() => {
    if (!merchantId || !location) { setCheck(null); return; }
    let live = true;
    api.get<DeliveryCheck>(`/merchants/${merchantId}/delivery-check`, { params: { lat: location.lat, lng: location.lng } })
      .then((r) => { if (live) setCheck(r); })
      .catch(() => { if (live) setCheck(null); });
    return () => { live = false; };
  }, [merchantId, location?.lat, location?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return check;
}
