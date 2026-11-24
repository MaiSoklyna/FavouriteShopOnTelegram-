"""Distance-based delivery pricing."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time as dtime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from math import asin, cos, radians, sin, sqrt

from app.core.constants import (
    DEFAULT_DELIVERY_RADIUS_KM,
    DELIVERY_FEE_TIERS,
    ETA_MINUTES_PER_KM,
    ETA_PREP_MINUTES,
    ETA_WINDOW_MINUTES,
    MAX_DELIVERY_KM,
)

EARTH_RADIUS_KM = 6371.0088


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Straight-line distance between two WGS84 points."""
    dlat, dlng = radians(lat2 - lat1), radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_KM * asin(sqrt(a))


def valid_point(lat, lng) -> bool:
    try:
        return -90 <= float(lat) <= 90 and -180 <= float(lng) <= 180
    except (TypeError, ValueError):
        return False


def fee_for_distance(km: float) -> Decimal | None:
    """Flat fee for the band `km` falls in, or None when out of range."""
    if km > MAX_DELIVERY_KM:
        return None
    for max_km, fee in DELIVERY_FEE_TIERS:
        if km <= max_km:
            return Decimal(str(fee)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return None


# ── Shop-level delivery quote ────────────────────────────────────
# The one place that decides distance, fee, ETA and availability for a shop →
# pin. The nearby list, /orders/quote and place_order all call this, so the
# numbers the customer sees are the numbers they are charged.

# Cambodia has no DST, so a fixed offset is exact (and needs no tzdata on Windows).
SHOP_TZ = timezone(timedelta(hours=7))
_DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


@dataclass(frozen=True)
class DeliveryQuote:
    distance_km: Decimal
    distance_m: int
    fee: Decimal | None          # None → shop cannot deliver to this point
    eta_minutes: int
    eta_max_minutes: int
    can_deliver: bool
    reason: str | None = None    # why not, for the UI


def shop_location(shop: dict) -> tuple[float, float] | None:
    """The shop's pin, or None when it has not set a (valid) one."""
    lat, lng = shop.get("latitude"), shop.get("longitude")
    if lat is None or lng is None or not valid_point(lat, lng):
        return None
    return float(lat), float(lng)


def eta_for_distance(km: float) -> tuple[int, int]:
    """(min, max) minutes: preparation plus ~3 min/km, rounded to 5, in a 10-minute window."""
    low = max(10, int(round((ETA_PREP_MINUTES + km * ETA_MINUTES_PER_KM) / 5.0)) * 5)
    return low, low + ETA_WINDOW_MINUTES


def delivery_fee(km: float, base_fee=None, per_km_fee=None) -> Decimal | None:
    """Fee for `km`, or None when out of range.

    A shop with its own `base_fee` charges base + per_km × km; every other
    shop uses the platform's distance bands.
    """
    if km > MAX_DELIVERY_KM:
        return None
    if base_fee is not None:
        fee = Decimal(str(base_fee)) + Decimal(str(per_km_fee or 0)) * Decimal(str(km))
        return fee.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return fee_for_distance(km)


def quote_delivery(shop: dict, dest: tuple[float, float]) -> DeliveryQuote | None:
    """Distance, fee, ETA and availability from `shop` to `dest`; None if the shop has no location."""
    origin = shop_location(shop)
    if origin is None:
        return None
    km = Decimal(str(haversine_km(*origin, *dest))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    radius = float(shop.get("delivery_radius_km") or DEFAULT_DELIVERY_RADIUS_KM)
    eta_min, eta_max = eta_for_distance(float(km))
    reason = None
    fee = None
    if float(km) > radius:
        reason = f"Outside this shop's {radius:g} km delivery area"
    else:
        fee = delivery_fee(float(km), shop.get("delivery_base_fee"), shop.get("delivery_per_km_fee"))
        if fee is None:
            reason = "Too far to deliver"
    return DeliveryQuote(km, int(round(float(km) * 1000)), fee, eta_min, eta_max, fee is not None, reason)


def _parse_hhmm(v: str) -> dtime:
    h, m = v.split(":")
    return dtime(int(h), int(m))


def is_open(opening_hours, now: datetime | None = None) -> bool:
    """Whether the shop is open now (Cambodia time).

    `opening_hours` is {"mon": [["08:00","20:00"]], ...}; a day that is missing or
    empty is closed, and an end before the start runs past midnight. A shop with
    no hours at all (None) is treated as always open.
    """
    if not opening_hours:
        return True
    now = (now or datetime.now(SHOP_TZ)).astimezone(SHOP_TZ)
    today, yesterday = _DAYS[now.weekday()], _DAYS[(now.weekday() - 1) % 7]
    t = now.time()
    try:
        for start, end in opening_hours.get(today) or []:
            s, e = _parse_hhmm(start), _parse_hhmm(end)
            if (s <= t < e) if s < e else (t >= s):   # same-day window / opens tonight, closes after midnight
                return True
        for start, end in opening_hours.get(yesterday) or []:
            s, e = _parse_hhmm(start), _parse_hhmm(end)
            if e < s and t < e:                       # last night's window still running
                return True
    except (ValueError, TypeError, AttributeError):
        return True  # malformed hours must never lock customers out
    return False
