"use client";

import { Icon } from "./Icon";
import type { DeliveryCheck } from "@/lib/deliveryCheck";

const km = (n?: number) => (n == null ? "" : n < 10 ? String(Number(n.toFixed(1))) : String(Math.round(n)));   // 5 → "5", 3.24 → "3.2", 22.4 → "22"

/**
 * Shown on shop and product pages when the customer is outside the shop's delivery area. They can still
 * browse and order for pickup; only delivery is not possible. "Change location" opens the location sheet.
 */
export function OutOfAreaBanner({ check, onChangeLocation, compact = false }: {
  check: DeliveryCheck;
  onChangeLocation: () => void;
  compact?: boolean;
}) {
  if (check.can_deliver) return null;
  const noPin = !check.located;
  return (
    <section role="status" data-testid="out-of-area"
      className={`rounded-hero border-[1.5px] border-caution-500/40 bg-tint-caution ${compact ? "p-3" : "p-3.5"}`}>
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card text-caution-500"><Icon name="pin" size={18} strokeWidth={2.2} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-extrabold leading-5 text-ink-900">
            {noPin ? "Delivery isn't set up for this shop yet" : `You're outside this shop's delivery area (${km(check.radius_km)} km)`}
          </p>
          {!compact && (
            <p className="mt-0.5 text-[12.5px] leading-5 text-ink-700">
              {noPin
                ? "You can browse products and order for pickup at the shop."
                : <>You&apos;re {km(check.distance_km)} km away. Please check your location. You can browse products and order <b>for pickup</b>, but delivery isn&apos;t available here.</>}
            </p>
          )}
          {compact && !noPin && <p className="text-[12px] text-ink-700">{km(check.distance_km)} km away · pickup only</p>}
        </div>
      </div>
      {!noPin && (
        <button type="button" onClick={onChangeLocation} data-testid="change-location"
          className="fos-press mt-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-thumb bg-navy-700 text-[13px] font-extrabold text-white">
          <Icon name="pin" size={15} strokeWidth={2.2} />Change location
        </button>
      )}
    </section>
  );
}
