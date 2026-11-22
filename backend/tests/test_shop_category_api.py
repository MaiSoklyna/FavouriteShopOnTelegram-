"""Browsing shops by category: the shop list and nearby list carry and filter on it, and
/shop-categories counts the active shops under each category (database faked)."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.shop_fakes import FakeDb, install

CUSTOMER = (11.5704, 104.8996)


@pytest.fixture
def client(monkeypatch):
    install(monkeypatch, FakeDb())
    return TestClient(app)


def ids(response):
    assert response.status_code == 200
    return {s["id"] for s in response.json()}


# ── shop list ───────────────────────────────────────────────────────

def test_shops_carry_their_category_ids_and_names(client):
    shops = {s["id"]: s for s in client.get("/api/merchants").json()}
    cake = shops[1]
    assert (cake["shop_category_id"], cake["shop_subcategory_id"]) == (1, 1)
    assert (cake["shop_category"], cake["shop_subcategory"]) == ("Food & Beverage", "Cake Shop")
    assert shops[4]["shop_category"] is None and shops[4]["shop_subcategory"] is None  # not categorised yet


def test_public_list_hides_suspended_shops_and_private_fields(client):
    shops = client.get("/api/merchants").json()
    assert {s["id"] for s in shops} == {1, 2, 3, 4}
    assert all("email" not in s and "owner_name" not in s for s in shops)


def test_filter_by_category(client):
    assert ids(client.get("/api/merchants", params={"shop_category_id": 1})) == {1, 2}
    assert ids(client.get("/api/merchants", params={"shop_category_id": 2})) == {3}


def test_filter_by_subcategory(client):
    assert ids(client.get("/api/merchants", params={"shop_subcategory_id": 2})) == {2}


def test_category_and_subcategory_together(client):
    assert ids(client.get("/api/merchants", params={"shop_category_id": 1, "shop_subcategory_id": 1})) == {1}
    assert ids(client.get("/api/merchants", params={"shop_category_id": 2, "shop_subcategory_id": 1})) == set()


def test_filter_never_shows_suspended_shops(client):
    # shop 5 is Food / Cake Shop but suspended
    assert 5 not in ids(client.get("/api/merchants", params={"shop_category_id": 1}))


def test_unknown_category_returns_nothing(client):
    assert ids(client.get("/api/merchants", params={"shop_category_id": 99})) == set()


def test_filter_combines_with_search(client):
    assert ids(client.get("/api/merchants", params={"shop_category_id": 1, "search": "coffee"})) == {2}


def test_non_numeric_filter_is_rejected(client):
    assert client.get("/api/merchants", params={"shop_category_id": "food"}).status_code == 422


def test_shop_detail_has_category_names(client):
    shop = client.get("/api/merchants/3").json()
    assert (shop["shop_category"], shop["shop_subcategory"]) == ("Fashion", "Clothing")
    assert "email" not in shop


# ── nearby ──────────────────────────────────────────────────────────

def nearby(client, **params):
    return client.get("/api/merchants/nearby", params={"lat": CUSTOMER[0], "lng": CUSTOMER[1], **params})


def test_nearby_carries_and_filters_by_category(client):
    everything = ids(nearby(client))
    assert everything == {1, 2, 3, 4}  # suspended shop excluded
    assert ids(nearby(client, shop_category_id=1)) == {1, 2}
    assert ids(nearby(client, shop_subcategory_id=3)) == {3}
    first = nearby(client, shop_category_id=2).json()[0]
    assert (first["shop_category"], first["shop_subcategory"]) == ("Fashion", "Clothing")
    assert "email" not in first


# ── /shop-categories counts ─────────────────────────────────────────

def test_counts_active_shops_per_category_and_subcategory(client):
    data = {c["id"]: c for c in client.get("/api/shop-categories").json()["data"]}
    assert data[1]["shop_count"] == 2          # Cake Corner + Coffee Spot; the suspended shop is not counted
    assert data[2]["shop_count"] == 1
    assert data[3]["shop_count"] == 0
    subs = {s["id"]: s["shop_count"] for c in data.values() for s in c["subcategories"]}
    assert subs == {1: 1, 2: 1, 3: 1, 4: 0}


def test_default_keeps_empty_categories_for_forms_and_admin(client):
    names = [c["name"] for c in client.get("/api/shop-categories").json()["data"]]
    assert names == ["Food & Beverage", "Fashion", "Electronics"]


def test_with_shops_hides_empty_categories_and_subcategories(client):
    data = client.get("/api/shop-categories", params={"with_shops": "true"}).json()["data"]
    assert [c["name"] for c in data] == ["Food & Beverage", "Fashion"]
    assert [s["name"] for s in data[0]["subcategories"]] == ["Cake Shop", "Coffee Shop"]
    assert all(s["shop_count"] > 0 for c in data for s in c["subcategories"])


def test_uncategorised_shops_are_in_no_count(client):
    total = sum(c["shop_count"] for c in client.get("/api/shop-categories").json()["data"])
    assert total == 3  # shops 1, 2, 3; shop 4 has no category, shop 5 is suspended
