"""Option B (2026-11-25): a shop may deliver up to 20 km (decision 2026-11-26), but beyond 10 km it must use its own fees."""

import pytest
from pydantic import ValidationError

from app.core.exceptions import BadRequestError
from app.models.merchant import MerchantUpdate
from app.routes.merchants import _check_long_distance
from app.services import shop_setup


def test_radius_limit_is_20_km():
    assert MerchantUpdate(delivery_radius_km=20).delivery_radius_km == 20
    with pytest.raises(ValidationError):
        MerchantUpdate(delivery_radius_km=21)


@pytest.mark.parametrize("existing, change, refused", [
    ({"delivery_radius_km": 5, "delivery_fee_mode": "platform"}, {"delivery_radius_km": 18}, True),
    ({"delivery_radius_km": 18, "delivery_fee_mode": "custom"}, {"delivery_fee_mode": "platform"}, True),
    ({"delivery_radius_km": 5, "delivery_fee_mode": "custom"}, {"delivery_radius_km": 18}, False),
    ({"delivery_radius_km": 5, "delivery_fee_mode": None}, {"delivery_radius_km": 18}, False),   # not chosen yet: setup asks
    ({"delivery_radius_km": 5, "delivery_fee_mode": "platform"}, {"delivery_radius_km": 10}, False),
])
def test_platform_fees_cannot_cover_more_than_10_km(existing, change, refused):
    if refused:
        with pytest.raises(BadRequestError, match="own delivery fees"):
            _check_long_distance(existing, change)
    else:
        _check_long_distance(existing, change)


@pytest.mark.parametrize("shop, done", [
    ({"delivery_radius_km": 10, "delivery_fee_mode": "platform"}, True),
    ({"delivery_radius_km": 18, "delivery_fee_mode": "platform"}, False),
    ({"delivery_radius_km": 18, "delivery_fee_mode": "custom", "delivery_base_fee": 1.5}, True),
    ({"delivery_radius_km": 18, "delivery_fee_mode": "custom", "delivery_base_fee": None}, False),
])
def test_setup_counts_delivery_done_only_with_fees_that_reach(shop, done):
    assert shop_setup.delivery_set(shop) is done
