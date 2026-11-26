"""GET /merchants/{id}/delivery-check: can this shop deliver to the customer, at any distance.

Customers outside a shop's area can still browse and order for pickup; the shop and product pages use this
to show a clear "outside the delivery area" banner instead of the customer finding out at checkout.
"""

from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from app.db.client import SupabaseClient
from app.main import app

SHOP = {"id": 1, "name": "Cakes", "status": "active", "setup_completed_at": "2026-01-01T00:00:00Z",
        "latitude": 11.55, "longitude": 104.92, "delivery_radius_km": 18, "delivery_base_fee": 1.0,
        "delivery_per_km_fee": 0.2, "opening_hours": None}


@pytest.fixture
def client(monkeypatch):
    rows = {1: dict(SHOP), 2: {**SHOP, "id": 2, "setup_completed_at": None}, 3: {**SHOP, "id": 3, "latitude": None, "longitude": None}}

    class Q:
        def __init__(self): self.mid = None
        def eq(self, c, v): self.mid = v; return self
        async def select_one(self, *a): return rows.get(self.mid)

    class DB:
        def from_(self, t): return Q()

    @asynccontextmanager
    async def service_role():
        yield DB()
    monkeypatch.setattr(SupabaseClient, "service_role", staticmethod(service_role))
    return TestClient(app)


def km_north(km):
    return SHOP["latitude"] + km / 111.0


def test_inside_the_area(client):
    r = client.get("/api/merchants/1/delivery-check", params={"lat": km_north(5), "lng": SHOP["longitude"]}).json()
    assert r["can_deliver"] and r["radius_km"] == 18 and 4.8 < r["distance_km"] < 5.2 and r["delivery_fee"] and r["pickup"]


def test_outside_the_area_at_any_distance(client):
    for km in (19, 25, 60):   # 25 and 60 km are beyond the nearby search: still answered
        r = client.get("/api/merchants/1/delivery-check", params={"lat": km_north(km), "lng": SHOP["longitude"]}).json()
        assert not r["can_deliver"] and r["radius_km"] == 18 and r["distance_km"] > 18
        assert "18 km" in r["reason"] and r["pickup"] is True


def test_shop_without_a_location(client):
    r = client.get("/api/merchants/3/delivery-check", params={"lat": 11.5, "lng": 104.9}).json()
    assert r["located"] is False and r["can_deliver"] is False and r["pickup"] is True


def test_hidden_shop_and_bad_points(client):
    assert client.get("/api/merchants/2/delivery-check", params={"lat": 11.5, "lng": 104.9}).status_code == 404
    assert client.get("/api/merchants/1/delivery-check", params={"lat": 200, "lng": 104.9}).status_code == 400
