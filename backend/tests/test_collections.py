"""Merchant collections (database faked).

A collection belongs to one shop, holds only that shop's products in the shop's order, and is shown to
customers only when active, inside its dates, manual, and with at least one active product. Owners and
staff manage them; every change is in the activity log. Smart collections cannot be created yet.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core import dependencies
from app.db.client import SupabaseClient
from app.main import app
from app.models.collection import MAX_COLLECTIONS_PER_SHOP
from app.routes import collections as route
from tests.test_merchant_staff import MANAGER, OWNER, STAFF, SUPER, FakeDb, bearer

NOW = datetime.now(timezone.utc)
PAST, FUTURE = (NOW - timedelta(days=2)).isoformat(), (NOW + timedelta(days=2)).isoformat()
OTHER_OWNER = bearer(20, merchant_id=2, merchant_role="owner", name="Other Owner")


class CollectionsDb(FakeDb):
    def __init__(self, migrated=True):
        super().__init__()
        self.migrated = migrated
        self.t["products"] += [
            {"id": 7, "merchant_id": 1, "name": "Chocolate Cake", "base_price": 20.0, "stock": 5, "is_active": True},
            {"id": 8, "merchant_id": 1, "name": "Old Cake", "base_price": 9.0, "stock": 0, "is_active": False},
        ]
        self.t["product_images"] = [{"id": 1, "product_id": 7, "url": "https://img/7.jpg", "sort_order": 0}]
        self.t["product_variants"] = [{"id": 1, "product_id": 5}]
        self.t[route.TABLE] = []
        self.t[route.LINKS] = []

    def check(self, table, write=False):
        if not self.migrated and table in (route.TABLE, route.LINKS):
            req = httpx.Request("GET", "http://db/x")
            raise httpx.HTTPStatusError("missing", request=req, response=httpx.Response(
                404, json={"code": "PGRST205", "message": f"Could not find the table 'public.{table}'"}, request=req))
        super().check(table, write)

    def add(self, cid, *, merchant_id=1, products=(), **kw):
        row = {"id": cid, "merchant_id": merchant_id, "type": "manual", "title": f"C{cid}", "description": None,
               "cover_url": None, "sort_order": cid, "is_active": True, "starts_at": None, "ends_at": None, **kw}
        self.t[route.TABLE].append(row)
        for i, p in enumerate(products):
            self.t[route.LINKS].append({"collection_id": cid, "product_id": p, "sort_order": i, "added_at": None})
        return row


@pytest.fixture
def db(monkeypatch):
    fake = CollectionsDb()

    @asynccontextmanager
    async def service_role():
        yield fake

    monkeypatch.setattr(SupabaseClient, "service_role", staticmethod(service_role))
    dependencies._staff_checks.clear()
    yield fake
    dependencies._staff_checks.clear()


@pytest.fixture
def client(db):
    return TestClient(app)


# ── What customers see ──────────────────────────────────────────


def test_shop_page_shows_only_live_collections_in_order(client, db):
    db.add(1, products=[7, 5], title="Birthday Cakes", sort_order=2)
    db.add(2, products=[5], title="Best Sellers", sort_order=1)
    db.add(3, products=[5], is_active=False)                 # switched off
    db.add(4, products=[5], starts_at=FUTURE)                # not started
    db.add(5, products=[5], ends_at=PAST)                    # over
    db.add(6, products=[8])                                  # only an inactive product
    db.add(7, products=[])                                   # empty
    db.add(8, products=[5], type="smart")                    # reserved type
    db.add(9, merchant_id=2, products=[6])                   # another shop's
    db.add(10, products=[5], starts_at=PAST, ends_at=FUTURE)  # inside its dates
    r = client.get("/api/merchants/1/collections")
    assert r.status_code == 200
    rows = r.json()
    assert [c["title"] for c in rows] == ["Best Sellers", "Birthday Cakes", "C10"]
    cakes = rows[1]
    assert [p["name"] for p in cakes["products"]] == ["Chocolate Cake", "Matcha Cake"]  # the shop's order
    assert cakes["product_count"] == 2
    assert cakes["products"][0]["images"][0]["url"] == "https://img/7.jpg" and cakes["products"][1]["has_variants"]


def test_inactive_and_foreign_products_never_show(client, db):
    db.add(1, products=[8, 6, 7])  # 8 inactive, 6 belongs to shop 2 (could only get here by hand)
    rows = client.get("/api/merchants/1/collections").json()
    assert [p["id"] for p in rows[0]["products"]] == [7]


def test_suspended_shop_shows_nothing(client, db):
    db.add(1, products=[5])
    db.t["merchants"][0]["status"] = "suspended"
    assert client.get("/api/merchants/1/collections").json() == []
    assert client.get("/api/collections/1").status_code == 404


def test_collection_page(client, db):
    db.add(1, products=[7, 8, 5], title="Birthday Cakes", description="For your special day")
    r = client.get("/api/collections/1")
    assert r.status_code == 200
    body = r.json()
    assert [p["id"] for p in body["products"]] == [7, 5] and body["merchant"]["name"] == "Cake Shop"
    for hidden in (dict(is_active=False), dict(starts_at=FUTURE), dict(ends_at=PAST), dict(type="smart")):
        db.t[route.TABLE][0].update({"is_active": True, "starts_at": None, "ends_at": None, "type": "manual", **hidden})
        assert client.get("/api/collections/1").status_code == 404, hidden
    db.t[route.TABLE][0].update({"is_active": True, "starts_at": None, "ends_at": None, "type": "manual"})
    db.t[route.LINKS] = [l for l in db.t[route.LINKS] if l["product_id"] == 8]  # only an inactive product left
    assert client.get("/api/collections/1").status_code == 404


def test_customers_see_nothing_before_the_migration(client, db):
    db.migrated = False
    assert client.get("/api/merchants/1/collections").json() == []
    assert client.get("/api/collections/1").status_code == 404
    r = client.get("/api/collections/admin/list", headers=OWNER)
    assert r.status_code == 400 and "035" in r.text


# ── Shops manage them ───────────────────────────────────────────


def test_manager_creates_a_collection_with_their_products(client, db):
    r = client.post("/api/collections/admin", headers=MANAGER, json={
        "title": " Birthday Cakes ", "description": "For your day", "product_ids": [7, 5, 7],
        "starts_at": PAST, "ends_at": FUTURE, "merchant_id": 2,  # a shop account's merchant_id is ignored
    })
    assert r.status_code == 200, r.text
    c = db.t[route.TABLE][0]
    assert (c["merchant_id"], c["title"], c["type"]) == (1, "Birthday Cakes", "manual")
    assert [l["product_id"] for l in sorted(db.t[route.LINKS], key=lambda l: l["sort_order"])] == [7, 5]
    e = db.log("collection.created")[0]
    assert (e["actor_name"], e["actor_type"], e["target_label"]) == ("Kosal", "manager", "Birthday Cakes")
    assert e["new_value"]["products"] == ["Chocolate Cake", "Matcha Cake"]


@pytest.mark.parametrize("payload,status,text", [
    ({"title": "X", "product_ids": [6]}, 400, "not in this shop"),            # another shop's product
    ({"title": "X", "product_ids": [999]}, 400, "not in this shop"),          # no such product
    ({"title": "X", "type": "smart"}, 400, "not available yet"),
    ({"title": "X", "type": "rules"}, 422, ""),
    ({"title": "   "}, 422, ""),
    ({"title": "X", "starts_at": FUTURE, "ends_at": PAST}, 422, "end date"),
    ({"title": "X", "product_ids": list(range(1, 62))}, 422, "up to 60"),
])
def test_bad_collections_are_refused(client, db, payload, status, text):
    r = client.post("/api/collections/admin", headers=OWNER, json=payload)
    assert r.status_code == status and text in r.text
    assert db.t[route.TABLE] == [] and db.log() == []


def test_a_shop_has_at_most_20_collections(client, db):
    for i in range(MAX_COLLECTIONS_PER_SHOP):
        db.add(i + 1)
    r = client.post("/api/collections/admin", headers=OWNER, json={"title": "One more"})
    assert r.status_code == 400 and "up to 20" in r.text


def test_reordering_products_is_logged_once(client, db):
    db.add(1, products=[5, 7], title="Cakes")
    r = client.put("/api/collections/admin/1/products", headers=MANAGER, json={"product_ids": [7, 5]})
    assert r.status_code == 200
    assert [l["product_id"] for l in sorted(db.t[route.LINKS], key=lambda l: l["sort_order"])] == [7, 5]
    client.put("/api/collections/admin/1/products", headers=MANAGER, json={"product_ids": [7, 5]})  # no change
    entries = db.log("collection.products_changed")
    assert len(entries) == 1
    assert entries[0]["old_value"] == {"products": ["Matcha Cake", "Chocolate Cake"]}
    assert entries[0]["new_value"] == {"products": ["Chocolate Cake", "Matcha Cake"]}
    assert client.put("/api/collections/admin/1/products", headers=MANAGER, json={"product_ids": [6]}).status_code == 400


def test_editing_and_deleting_are_logged(client, db):
    db.add(1, products=[5], title="Cakes", sort_order=0)
    r = client.put("/api/collections/admin/1", headers=OWNER, json={"title": "Cakes", "is_active": False, "sort_order": 0})
    assert r.status_code == 200
    e = db.log("collection.updated")[0]
    assert e["old_value"] == {"is_active": True} and e["new_value"] == {"is_active": False}
    assert client.delete("/api/collections/admin/1", headers=OWNER).status_code == 200
    assert db.t[route.TABLE] == []
    assert db.log("collection.deleted")[0]["old_value"]["products"] == 1


def test_other_shops_cannot_touch_a_collection(client, db):
    db.add(1, products=[5])
    assert client.put("/api/collections/admin/1", headers=OTHER_OWNER, json={"title": "Mine now"}).status_code == 404
    assert client.put("/api/collections/admin/1/products", headers=OTHER_OWNER, json={"product_ids": []}).status_code == 404
    assert client.delete("/api/collections/admin/1", headers=OTHER_OWNER).status_code == 404
    assert client.get("/api/collections/admin/list", headers=OTHER_OWNER).json()["data"] == []
    assert db.t[route.TABLE][0]["title"] == "C1"


def test_dashboard_list_shows_status(client, db):
    db.add(1, products=[5]); db.add(2, products=[5], is_active=False); db.add(3, products=[5], starts_at=FUTURE)
    db.add(4, products=[5], ends_at=PAST); db.add(5, products=[8])
    rows = client.get("/api/collections/admin/list", headers=STAFF).json()["data"]
    assert [(c["id"], c["status"], c["draft_reason"]) for c in rows] == [
        (1, "live", None), (2, "draft", "off"), (3, "scheduled", None), (4, "ended", None), (5, "draft", "no_products")]
    assert {c["status"] for c in rows} <= {"draft", "live", "scheduled", "ended"}
    assert rows[4]["product_ids"] == [8] and rows[4]["visible_product_count"] == 0


def test_super_admin_must_choose_the_shop(client, db):
    assert client.get("/api/collections/admin/list", headers=SUPER).status_code == 400
    r = client.post("/api/collections/admin", headers=SUPER, json={"title": "Platform pick", "merchant_id": 1, "product_ids": [5]})
    assert r.status_code == 200 and db.t[route.TABLE][0]["merchant_id"] == 1
    assert db.log("collection.created")[0]["actor_type"] == "super_admin"


def test_customers_cannot_manage(client, db):
    from app.core.constants import Role
    from app.core.security import mint_jwt
    cust = {"Authorization": "Bearer " + mint_jwt(sub="9", role=Role.USER, telegram_id=99, expires_in=60)}
    assert client.post("/api/collections/admin", headers=cust, json={"title": "X"}).status_code == 403


def test_status_rules():
    base = {"is_active": True, "starts_at": None, "ends_at": None}
    assert route.status_of(base, 1, NOW) == ("live", None)
    assert route.status_of(base, 0, NOW) == ("draft", "no_products")
    assert route.status_of({**base, "is_active": False}, 1, NOW) == ("draft", "off")
    assert route.status_of({**base, "is_active": False, "starts_at": FUTURE}, 1, NOW) == ("draft", "off")  # off wins
    assert route.status_of({**base, "starts_at": FUTURE}, 1, NOW) == ("scheduled", None)
    assert route.status_of({**base, "ends_at": PAST}, 1, NOW) == ("ended", None)
    assert route.status_of({**base, "ends_at": NOW.isoformat()}, 1, NOW) == ("ended", None)  # the end moment is already over
    assert route.is_visible({**base, "type": "smart"}, NOW) is False
