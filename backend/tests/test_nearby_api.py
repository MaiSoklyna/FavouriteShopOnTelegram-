"""GET /api/merchants/nearby: ordering, states, validation, no data leaks (database faked)."""

from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routes import merchants as merchants_route

CUSTOMER = (11.5704, 104.8996)
ALL_CLOSED = {d: [] for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")}


def shop(id, name, lat, lng, **extra):
    return {
        "id": id, "name": name, "slug": name.lower(), "status": "active", "latitude": lat, "longitude": lng,
        "delivery_radius_km": 5, "email": f"{name}@secret.example", "owner_name": "Private Owner", **extra,
    }


class FakeQuery:
    """Just enough of the query builder: the bounding-box filters and select()."""

    def __init__(self, rows):
        self.rows, self.filters = rows, []

    def eq(self, *_):
        return self

    def gte(self, col, v):
        self.filters.append((col, ">=", v))
        return self

    def lte(self, col, v):
        self.filters.append((col, "<=", v))
        return self

    async def select(self, *_):
        out = []
        for r in self.rows:
            ok = True
            for col, op, v in self.filters:
                ok &= r.get(col) is not None and (r[col] >= v if op == ">=" else r[col] <= v)
            if ok:
                out.append(r)
        return out


def fake_db(rows):
    class DB:
        def from_(self, _):
            return FakeQuery(rows)

    @asynccontextmanager
    async def service_role():
        yield DB()

    return service_role


@pytest.fixture
def client():
    return TestClient(app)


def call(client, monkeypatch, rows, **params):
    monkeypatch.setattr(merchants_route.SupabaseClient, "service_role", staticmethod(fake_db(rows)))
    return client.get("/api/merchants/nearby", params={"lat": CUSTOMER[0], "lng": CUSTOMER[1], **params})


def test_nearest_first_with_server_side_numbers(client, monkeypatch):
    rows = [shop(1, "Far", 11.5931, 104.8996), shop(2, "Near", 11.5731, 104.8996)]
    r = call(client, monkeypatch, rows)
    assert r.status_code == 200
    data = r.json()
    assert [s["name"] for s in data] == ["Near", "Far"]
    near = data[0]
    assert near["distance_m"] == 300 and near["delivery_fee"] == "0.50"
    assert near["eta_minutes"] == 10 and near["eta_max_minutes"] == 20
    assert near["can_deliver"] is True and near["is_open"] is True


def test_closed_shops_are_listed_last_even_if_nearer(client, monkeypatch):
    rows = [shop(1, "ClosedNear", 11.5731, 104.8996, opening_hours=ALL_CLOSED), shop(2, "OpenFar", 11.5931, 104.8996)]
    data = call(client, monkeypatch, rows).json()
    assert [s["name"] for s in data] == ["OpenFar", "ClosedNear"]
    assert data[1]["is_open"] is False


def test_out_of_radius_shop_is_listed_as_pickup_only(client, monkeypatch):
    s = call(client, monkeypatch, [shop(1, "Remote", 11.6304, 104.8996)]).json()[0]  # about 6.7 km, radius 5
    assert s["can_deliver"] is False and s["delivery_fee"] is None and s["delivery_unavailable_reason"]


def test_shops_without_a_location_or_outside_the_search_area_are_skipped(client, monkeypatch):
    rows = [shop(1, "NoPin", None, None), shop(2, "SiemReap", 13.3671, 103.8448), shop(3, "Here", 11.5731, 104.8996)]
    assert [s["name"] for s in call(client, monkeypatch, rows).json()] == ["Here"]


def test_pagination(client, monkeypatch):
    rows = [shop(i, f"S{i}", 11.5704 + i * 0.002, 104.8996) for i in range(1, 6)]
    page1 = call(client, monkeypatch, rows, limit=2).json()
    page2 = call(client, monkeypatch, rows, limit=2, offset=2).json()
    assert [s["name"] for s in page1] == ["S1", "S2"]
    assert [s["name"] for s in page2] == ["S3", "S4"]


def test_private_merchant_fields_are_not_exposed(client, monkeypatch):
    s = call(client, monkeypatch, [shop(1, "Here", 11.5731, 104.8996)]).json()[0]
    assert "email" not in s and "owner_name" not in s


@pytest.mark.parametrize("lat,lng", [(95, 104.9), (11.5, 190), (-91, 0)])
def test_invalid_coordinates_are_rejected(client, lat, lng):
    assert client.get("/api/merchants/nearby", params={"lat": lat, "lng": lng}).status_code == 400
