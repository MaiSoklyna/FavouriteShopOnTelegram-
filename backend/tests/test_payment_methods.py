"""Only payment methods the server can actually take are offered and accepted.

Found in the 2026-11-25 production smoke test: checkout offered card, the server had no Stripe key, and
an order was created that nobody could pay.
"""

import asyncio

import pytest

from app.core.exceptions import BadRequestError
from app.routes import orders as orders_route
from app.routes import payment_methods as route
from app.services import payment_methods, payway, stripe_pay


@pytest.fixture
def keys(monkeypatch):
    def set_keys(stripe=False, khqr=False):
        monkeypatch.setattr(stripe_pay, "is_configured", lambda: stripe)
        monkeypatch.setattr(payway, "is_configured", lambda: khqr)
    return set_keys


def test_cash_always_and_online_only_with_keys(keys):
    keys()
    assert payment_methods.available() == ["cod"]
    keys(stripe=True)
    assert payment_methods.available() == ["cod", "stripe"]
    keys(stripe=True, khqr=True)
    assert asyncio.run(route.list_payment_methods()) == {"data": {"methods": ["cod", "stripe", "khqr"]}}


@pytest.mark.parametrize("method, ok", [("cod", True), ("stripe", False), ("khqr", False), ("bitcoin", False)])
def test_messages(keys, method, ok):
    keys()
    assert (payment_methods.unavailable_message(method) is None) is ok


@pytest.mark.parametrize("method", ["stripe", "khqr", "bitcoin"])
def test_an_order_with_an_unavailable_method_is_refused_before_anything_happens(keys, method):
    keys()
    body = {"merchant_id": 5, "delivery_address": "Pickup at shop", "payment_method": method}
    with pytest.raises(BadRequestError):
        asyncio.run(orders_route.place_order(body, user=None))   # refused before the database is touched
