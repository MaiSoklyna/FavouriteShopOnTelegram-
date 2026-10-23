"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { areaName, type HomeLocation } from "@/lib/useHomeLocation";
import type { LatLng } from "@/lib/mapbox";
import { Skeleton } from "./Skeleton";

const MapPicker = dynamic(() => import("@/components/map/MapPicker"), {
  ssr: false,
  loading: () => <Skeleton className="h-[280px] rounded-thumb" />,
});

interface Props {
  current: HomeLocation | null;
  onClose: () => void;
  onConfirm: (loc: HomeLocation) => void;
}

/** Bottom sheet with the map pin picker; the chosen area becomes the Home location. */
export function LocationSheet({ current, onClose, onConfirm }: Props) {
  const [pin, setPin] = useState<LatLng | null>(current ? { lat: current.lat, lng: current.lng } : null);
  const [address, setAddress] = useState(current?.area ?? "");

  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-navy-900/50" onClick={onClose} role="dialog" aria-modal aria-label="Choose your location">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-sheet bg-white px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <h2 className="text-title text-ink-900">Where to?</h2>
        <div className="mt-3">
          <MapPicker value={pin} height={280} onChange={(p, addr) => { setPin(p); if (addr) setAddress(addr); }} />
        </div>
        {address && <p className="mt-2 truncate text-[13px] font-semibold text-ink-900">📍 {address}</p>}
        <button
          type="button"
          disabled={!pin}
          onClick={() => pin && onConfirm({ lat: pin.lat, lng: pin.lng, area: areaName(address) })}
          className="fos-press mt-3 flex h-12 w-full items-center justify-center rounded-thumb bg-grad-cta text-[15px] font-bold text-white shadow-fos-cta disabled:opacity-50"
        >
          Confirm location
        </button>
      </div>
    </div>
  );
}
