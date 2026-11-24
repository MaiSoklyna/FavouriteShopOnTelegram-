"""POST /api/orders/quote with merchant_id prices one shop's cart only (database and pricing faked)."""

from contextlib import asynccontextmanager
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.core.constants import Role
from app.core.dependencies import get_current_user
from app.core.exceptions import BadRequestError
from app.core.security import TokenClaims
from app.main import app
from app.routes import orders as orders_route

CARTS = [{"id": 10, "merchant_id": 1}, {"id": 20, "merchant_id": 2}]


class FakeQuery:
    def eq(self, *_):
        return self

    async def select(self, *_):
        return CARTS


async def fake_price_cart(db, user_id, merchant_id, promo_code, delivery_type, dest):
    if merchant_id == 2:
        # Shop 2 can't reach the customer: pricing the whole cart would fail
        raise BadRequestError("Delivery unavailable for this location. Shop 2 delivers within 5 km")
    return {
        "subtotal": Decimal("25.00"), "discount": Decimal("0.00"), "delivery_fee": Decimal("0.75"),
        "distance_km": Decimal("4.1"), "total": Decimal("25.75"), "promo": None, "promo_error": None,
        "promo_owned": False, "eta": (25, 35), "shop_open": True, "min_order": None,
    }


@pytest.fixture
def client(monkeypatch):
    class DB:
        def from_(self, _):
            return FakeQuery()

    @asynccontextmanager
    async def service_role():
        yield DB()

    async def fake_user(db, user):
        return {"id": 1}

    monkeypatch.setattr(orders_route.SupabaseClient, "service_role", staticmethod(service_role))
    monkeypatch.setattr(orders_route, "_price_cart", fake_price_cart)
    monkeypatch.setattr(orders_route, "_get_db_user", fake_user)
    app.dependency_overrides[get_current_user] = lambda: TokenClaims(sub="1", role=Role.USER)
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_one_shop_is_priced_alone(client):
    r = client.post("/api/orders/quote", json={"merchant_id": 1, "delivery_type": "delivery", "lat": 11.57, "lng": 104.9})
    assert r.status_code == 200
    data = r.json()["data"]
    assert [o["merchant_id"] for o in data["orders"]] == [1]
    assert data["totals"]["total"] == "25.75"


def test_without_merchant_id_every_shop_is_priced(client):
    r = client.post("/api/orders/quote", json={"delivery_type": "delivery", "lat": 11.57, "lng": 104.9})
    assert r.status_code == 400


def test_shop_not_in_cart_returns_no_orders(client):
    r = client.post("/api/orders/quote", json={"merchant_id": 99})
    assert r.status_code == 200
    assert r.json()["data"]["orders"] == []
