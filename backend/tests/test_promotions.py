"""Promotions: which cart lines a promotion discounts, when it is live, and form validation."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.routes.orders import eligible_subtotal
from app.routes.promotions import PromotionIn, _is_live

CART = [
    {"product_id": 1, "unit_price": "10.00", "quantity": 2},   # 20.00
    {"product_id": 2, "unit_price": "7.50", "quantity": 1},    # 7.50
    {"product_id": 3, "unit_price": "3.25", "quantity": 4},    # 13.00
]
NOW = datetime(2026, 10, 26, 12, tzinfo=timezone.utc)


def test_only_covered_lines_count():
    assert eligible_subtotal(CART, {1, 3}) == Decimal("33.00")


def test_nothing_covered_is_zero():
    assert eligible_subtotal(CART, set()) == Decimal("0.00")


@pytest.mark.parametrize("row,live", [
    ({"is_active": True}, True),
    ({"is_active": False}, False),
    ({"is_active": True, "starts_at": (NOW + timedelta(days=1)).isoformat()}, False),
    ({"is_active": True, "ends_at": (NOW - timedelta(minutes=1)).isoformat()}, False),
    ({"is_active": True, "starts_at": "2026-10-01T00:00:00Z", "ends_at": "2026-12-07T12:50:00+00:00"}, True),
])
def test_live_window(row, live):
    assert _is_live(row, NOW) is live


def form(**kw):
    base = {"title": "Serum week", "scope": "shop", "code": "giveyoubest", "discount_type": "percent", "discount_value": 30}
    return PromotionIn(**(base | kw))


def test_code_is_uppercased():
    assert form().code == "GIVEYOUBEST"


def test_code_rejects_spaces():
    with pytest.raises(ValidationError):
        form(code="GIVE YOU")


def test_unknown_display_location_is_rejected():
    with pytest.raises(ValidationError):
        form(display_locations=["home_promotions", "sidebar"])


def test_display_locations_are_deduplicated_and_featured_is_home():
    # Home has one Promotions section: the old 'home_featured' means the same place
    assert form(display_locations=["shop_page", "home_featured", "shop_page"]).display_locations == ["home_promotions", "shop_page"]


def test_a_promotion_can_be_only_a_banner():
    banner = PromotionIn(title="Khmer New Year", scope="shop", merchant_id=3)
    assert banner.code is None and banner.discount_value is None


def test_code_and_discount_go_together():
    with pytest.raises(ValidationError):
        PromotionIn(title="x", scope="shop", code="SAVE10")
    with pytest.raises(ValidationError):
        PromotionIn(title="x", scope="shop", discount_type="percent", discount_value=10)
