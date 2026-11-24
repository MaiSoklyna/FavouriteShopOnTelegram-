"""Distance, fee, ETA, opening hours and order-rule tests for map delivery."""

from datetime import datetime
from decimal import Decimal

import pytest

from app.core.exceptions import BadRequestError
from app.routes.orders import _delivery_for, _enforce_shop_rules
from app.services.delivery import (
    SHOP_TZ, delivery_fee, eta_for_distance, haversine_km, is_open, quote_delivery,
)

SHOP = {"latitude": 11.5704, "longitude": 104.8996, "delivery_radius_km": 5}


def at(day: str, hhmm: str) -> datetime:
    """A Cambodia-time datetime on a given weekday (2026-10-19 is a Monday)."""
    days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    h, m = hhmm.split(":")
    return datetime(2026, 10, 19 + days.index(day), int(h), int(m), tzinfo=SHOP_TZ)


# ── distance ────────────────────────────────────────────────────

def test_same_point_is_zero():
    assert haversine_km(11.5704, 104.8996, 11.5704, 104.8996) == 0


def test_known_distance_300m_north():
    # 0.0027 degrees of latitude is about 300 m
    assert round(haversine_km(11.5704, 104.8996, 11.5731, 104.8996) * 1000) == 300


def test_distance_is_symmetric():
    a, b = (11.5704, 104.8996), (11.5564, 104.9282)
    assert haversine_km(*a, *b) == pytest.approx(haversine_km(*b, *a))


def test_phnom_penh_to_siem_reap_is_about_the_real_distance():
    assert 200 < haversine_km(11.5564, 104.9282, 13.3671, 103.8448) < 240


# ── fee ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("km,fee", [(0, "0.50"), (3, "0.50"), (3.01, "0.75"), (5, "0.75"), (8, "1.50"), (10, "3.00")])
def test_platform_fee_bands(km, fee):
    assert delivery_fee(km) == Decimal(fee)


def test_no_delivery_past_last_band():
    assert delivery_fee(10.01) is None


def test_shop_own_fee_is_base_plus_per_km():
    assert delivery_fee(3.2, base_fee=0.5, per_km_fee=0.25) == Decimal("1.30")


def test_shop_own_fee_still_capped_by_max_distance():
    assert delivery_fee(11, base_fee=0.5, per_km_fee=0.25) is None


# ── ETA ─────────────────────────────────────────────────────────

def test_eta_is_a_ten_minute_window_rounded_to_five():
    assert eta_for_distance(0.3) == (10, 20)
    assert eta_for_distance(3.2) == (20, 30)


# ── quote_delivery ──────────────────────────────────────────────

def test_quote_inside_radius():
    q = quote_delivery(SHOP, (11.5731, 104.8996))
    assert q.can_deliver and q.fee == Decimal("0.50")
    assert q.distance_m == 300 and q.distance_km == Decimal("0.30")


def test_quote_outside_shop_radius_is_pickup_only():
    # about 6.7 km away: inside the platform 10 km cap but beyond this shop's 5 km radius
    q = quote_delivery(SHOP, (11.6304, 104.8996))
    assert not q.can_deliver and q.fee is None and "5 km" in q.reason


def test_quote_uses_default_radius_when_unset():
    shop = {**SHOP, "delivery_radius_km": None}
    assert quote_delivery(shop, (11.6304, 104.8996)).can_deliver is False
    assert quote_delivery(shop, (11.5731, 104.8996)).can_deliver is True


@pytest.mark.parametrize("shop", [{}, {"latitude": None, "longitude": None}, {"latitude": 999, "longitude": 0}])
def test_quote_without_a_valid_shop_location_is_none(shop):
    assert quote_delivery(shop, (11.5, 104.9)) is None


# ── opening hours ───────────────────────────────────────────────

HOURS = {"mon": [["08:00", "20:00"]], "tue": [["08:00", "12:00"], ["14:00", "20:00"]], "fri": [["20:00", "02:00"]]}


def test_no_hours_means_always_open():
    assert is_open(None) and is_open({})


def test_open_and_closed_within_a_day():
    assert is_open(HOURS, at("mon", "08:00"))
    assert is_open(HOURS, at("mon", "19:59"))
    assert not is_open(HOURS, at("mon", "20:00"))
    assert not is_open(HOURS, at("mon", "07:59"))


def test_split_shift():
    assert is_open(HOURS, at("tue", "11:00"))
    assert not is_open(HOURS, at("tue", "13:00"))
    assert is_open(HOURS, at("tue", "15:00"))


def test_day_without_hours_is_closed():
    assert not is_open(HOURS, at("wed", "12:00"))


def test_overnight_window_spans_midnight():
    assert is_open(HOURS, at("fri", "23:00"))
    assert is_open(HOURS, at("sat", "01:00"))      # Friday's window is still running
    assert not is_open(HOURS, at("sat", "02:00"))


def test_malformed_hours_never_lock_customers_out():
    assert is_open({"mon": [["8am", "late"]]}, at("mon", "12:00"))
    assert is_open({"mon": "nonsense"}, at("mon", "12:00"))


# ── order rules ─────────────────────────────────────────────────

def test_pickup_is_free_and_ignores_the_pin():
    assert _delivery_for(SHOP, "pickup", (11.9, 105.5)) == (None, Decimal("0.00"), None)


def test_delivery_without_a_pin_uses_default_fee_so_a_failed_map_never_blocks():
    km, fee, eta = _delivery_for(SHOP, "delivery", None)
    assert km is None and fee == Decimal("5.00") and eta is None


def test_delivery_from_shop_without_location_uses_default_fee():
    assert _delivery_for({}, "delivery", (11.5, 104.9))[1] == Decimal("5.00")


def test_delivery_inside_radius_is_priced_server_side():
    assert _delivery_for(SHOP, "delivery", (11.5731, 104.8996)) == (Decimal("0.30"), Decimal("0.50"), (10, 20))


def test_delivery_outside_radius_is_rejected():
    with pytest.raises(BadRequestError, match="unavailable"):
        _delivery_for(SHOP, "delivery", (11.6304, 104.8996))


def test_closed_shop_is_rejected():
    with pytest.raises(BadRequestError, match="closed"):
        _enforce_shop_rules({"shop_open": False, "min_order": None, "subtotal": Decimal("10")})


def test_below_minimum_order_is_rejected():
    with pytest.raises(BadRequestError, match="minimum order"):
        _enforce_shop_rules({"shop_open": True, "min_order": Decimal("15.00"), "subtotal": Decimal("12.00")})


def test_open_shop_meeting_minimum_passes():
    _enforce_shop_rules({"shop_open": True, "min_order": Decimal("15.00"), "subtotal": Decimal("15.00")})
    _enforce_shop_rules({"shop_open": True, "min_order": None, "subtotal": Decimal("1")})
