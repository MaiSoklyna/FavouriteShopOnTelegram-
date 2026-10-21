"""Distance-based delivery pricing."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from math import asin, cos, radians, sin, sqrt

from app.core.constants import DELIVERY_FEE_TIERS, MAX_DELIVERY_KM

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
