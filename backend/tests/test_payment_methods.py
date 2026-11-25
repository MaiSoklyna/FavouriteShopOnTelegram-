"""Only payment methods the server can take, released to the right people, are offered and accepted.

Found in the 2026-11-25 production smoke test: checkout offered card, the server had no Stripe key, and an
order was created that nobody could pay. Card is released in steps (CARD_PAYMENTS = off | testers | on)
so it can be tested on production before real customers see it.
"""

import asyncio
from contextlib import asynccontextmanager

import pytest

from app.config import settings
from app.core.constants import Role
from app.core.exceptions import BadRequestError
from app.core.security import TokenClaims
from app.routes import orders as orders_route
from app.routes import payment_methods as route
from app.routes import payments_stripe
from app.services import payment_methods, payway, stripe_pay

TESTER, CUSTOMER = 5, 9


@pytest.fixture
def setup(monkeypatch):
    def configure(stripe=True, khqr=False, mode="testers", testers="5"):
        monkeypatch.setattr(stripe_pay, "is_configured", lambda: stripe)
        monkeypatch.setattr(payway, "is_configured", lambda: khqr)
        monkeypatch.setattr(settings, "CARD_PAYMENTS", mode)
        monkeypatch.setattr(settings, "CARD_TESTER_USER_IDS", testers)
    return configure


def test_no_stripe_key_no_card_for_anyone(setup):
    setup(stripe=False, mode="on")
    assert payment_methods.available(TESTER) == ["cod"]


def test_testers_mode(setup):
    setup()
    assert payment_methods.available(TESTER) == ["cod", "stripe"]
    assert payment_methods.available(CUSTOMER) == ["cod"]
    assert payment_methods.available(None) == ["cod"]


def test_off_and_on(setup):
    setup(mode="off")
    assert payment_methods.available(TESTER) == ["cod"]
    setup(mode="on")
    assert payment_methods.available(CUSTOMER) == ["cod", "stripe"]


def test_unknown_mode_means_off_and_tester_list_is_forgiving(setup):
    setup(mode="sure")
    assert payment_methods.available(TESTER) == ["cod"]
    setup(testers=" 5 , x, 7,")
    assert payment_methods.card_testers() == {5, 7}


def test_khqr_needs_its_keys(setup):
    setup(stripe=False, khqr=True)
    assert payment_methods.available(None) == ["cod", "khqr"]


@pytest.mark.parametrize("method, uid, ok", [
    ("cod", None, True), ("stripe", TESTER, True), ("stripe", CUSTOMER, False), ("khqr", TESTER, False), ("bitcoin", TESTER, False),
])
def test_messages(setup, method, uid, ok):
    setup()
    assert (payment_methods.unavailable_message(method, uid) is None) is ok


class DB:
    def __init__(self):
        self.users = [{"id": TESTER, "telegram_id": 111}, {"id": CUSTOMER, "telegram_id": 999}]

    def from_(self, table):
        db = self

        class Q:
            def __init__(self): self.f = []
            def eq(self, c, v): self.f.append((c, v)); return self
            async def select_one(self, *_):
                rows = [r for r in db.users if all(r.get(c) == v for c, v in self.f)] if table == "users" else []
                return rows[0] if rows else None
        return Q()


def use(monkeypatch, db, *mods):
    @asynccontextmanager
    async def service_role():
        yield db
    for m in mods:
        monkeypatch.setattr(m.SupabaseClient, "service_role", service_role)


def token(tg):
    return TokenClaims(sub=str(tg), role=Role.USER, telegram_id=tg)


def test_endpoint_answers_per_customer(setup, monkeypatch):
    setup()
    use(monkeypatch, DB(), route)
    assert asyncio.run(route.list_payment_methods(user=token(111)))["data"]["methods"] == ["cod", "stripe"]
    assert asyncio.run(route.list_payment_methods(user=token(999)))["data"]["methods"] == ["cod"]
    out = asyncio.run(route.list_payment_methods(user=None))["data"]
    assert out == {"methods": ["cod"], "card_mode": "testers"}


def test_a_non_tester_cannot_place_a_card_order(setup, monkeypatch):
    setup()
    use(monkeypatch, DB(), orders_route)
    body = {"merchant_id": 5, "delivery_address": "Pickup at shop", "payment_method": "stripe"}
    with pytest.raises(BadRequestError, match="Card payment"):
        asyncio.run(orders_route.place_order(body, user=token(999)))


def test_unknown_method_is_refused_before_anything(setup):
    setup()
    with pytest.raises(BadRequestError, match="Unknown"):
        asyncio.run(orders_route.place_order({"merchant_id": 5, "delivery_address": "x", "payment_method": "bitcoin"}, user=None))


def test_a_non_tester_cannot_start_a_card_payment(setup, monkeypatch):
    setup()

    async def own(db, order_id, user):
        return {"id": order_id, "user_id": CUSTOMER, "payment_method": "stripe", "payment_status": "pending",
                "status": "pending", "total": "10.00", "order_code": "X"}
    monkeypatch.setattr(payments_stripe, "_get_own_order", own)
    with pytest.raises(BadRequestError, match="not available"):
        asyncio.run(payments_stripe.ensure_payment_intent(DB(), 1, token(999)))
