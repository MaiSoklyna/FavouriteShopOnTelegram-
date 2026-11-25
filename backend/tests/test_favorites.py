"""Favorites: saving products and shops, once each, per customer (database faked).

The fake database keeps what matters: the two partial unique indexes and the one-target CHECK of migration 032,
every call yields to other tasks (so two taps really race), and with `migrated=False` the table is missing as
before the migration.
"""

import asyncio
import functools
from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.constants import Role
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.security import mint_jwt
from app.db.client import SupabaseClient
from app.main import app
from app.routes.merchants import public_view, shop_category_names
from app.services import favorites


def arun(fn):
    @functools.wraps(fn)
    def wrapper(*a, **k):
        return asyncio.run(fn(*a, **k))
    return wrapper


def pg_error(code, message="error", status=400):
    req = httpx.Request("POST", "http://db/x")
    return httpx.HTTPStatusError("e", request=req, response=httpx.Response(status, json={"code": code, "message": message}, request=req))


class Q:
    def __init__(self, db, table):
        self.db, self.table, self.f, self.order_by = db, table, [], None

    def eq(self, col, val): self.f.append(("eq", col, val)); return self
    def in_(self, col, vals): self.f.append(("in", col, list(vals))); return self
    def order(self, col, *, desc=False, **k): self.order_by = (col, desc); return self
    def limit(self, n): return self

    def _check(self):
        if not self.db.migrated and self.table == "favorites":
            raise pg_error("PGRST205", "Could not find the table 'public.favorites' in the schema cache", 404)

    def _rows(self):
        out = [r for r in self.db.tables.setdefault(self.table, [])
               if all((r.get(c) == v) if op == "eq" else (r.get(c) in v) for op, c, v in self.f)]
        if self.order_by:
            col, desc = self.order_by
            out = sorted(out, key=lambda r: r.get(col) or "", reverse=desc)
        return out

    async def select(self, cols="*"):
        self._check(); await asyncio.sleep(0)
        return [dict(r) for r in self._rows()]

    async def select_one(self, cols="*"):
        rows = await self.select(cols)
        return rows[0] if rows else None

    async def insert(self, data):
        self._check(); await asyncio.sleep(0)
        rows = self.db.tables.setdefault(self.table, [])
        if self.table == "favorites":
            if (data["kind"] == "product") != (data.get("product_id") is not None) or (data["kind"] == "shop") != (data.get("merchant_id") is not None):
                raise pg_error("23514", "violates check constraint favorites_one_target")
            col = "product_id" if data["kind"] == "product" else "merchant_id"
            if any(r["user_id"] == data["user_id"] and r["kind"] == data["kind"] and r.get(col) == data[col] for r in rows):
                raise pg_error("23505", "duplicate key value violates unique constraint", 409)
        self.db.next_id += 1
        self.db.clock += 1
        new = {"id": self.db.next_id, "created_at": f"2026-11-22T10:{self.db.clock:02d}:00Z", **data}
        rows.append(new)
        return [dict(new)]

    async def delete(self):
        self._check(); await asyncio.sleep(0)
        gone = self._rows()
        self.db.tables[self.table] = [r for r in self.db.tables[self.table] if r not in gone]


class Db:
    def __init__(self, migrated=True):
        self.migrated, self.next_id, self.clock = migrated, 1000, 0
        self.tables = {
            "users": [{"id": 1, "telegram_id": 111}, {"id": 2, "telegram_id": 222}],
            "merchants": [
                {"id": 3, "name": "Bloom", "status": "active", "setup_completed_at": "2026-01-01T00:00:00Z", "shop_category_id": 1, "shop_subcategory_id": None, "commission_rate": 9, "bank_account": "SECRET", "rating": 4.5},
                {"id": 4, "name": "Cakes", "status": "active", "setup_completed_at": "2026-01-01T00:00:00Z", "shop_category_id": None, "shop_subcategory_id": None},
                {"id": 5, "name": "Closed Co", "status": "suspended", "shop_category_id": None, "shop_subcategory_id": None},
            ],
            "products": [
                {"id": 10, "merchant_id": 3, "name": "Rose", "base_price": 5, "stock": 4, "is_active": True, "primary_image": "r.jpg"},
                {"id": 11, "merchant_id": 4, "name": "Cake", "base_price": 9, "stock": 0, "is_active": True},
                {"id": 12, "merchant_id": 3, "name": "Old", "base_price": 1, "stock": 1, "is_active": False},
                {"id": 13, "merchant_id": 5, "name": "Closed item", "base_price": 1, "stock": 1, "is_active": True},
            ],
            "product_variants": [{"id": 1, "product_id": 10}],
            "shop_categories": [{"id": 1, "name": "Flowers"}], "shop_subcategories": [],
            "favorites": [],
        }

    def from_(self, table): return Q(self, table)
    def rows(self, **kw): return [r for r in self.tables["favorites"] if all(r.get(k) == v for k, v in kw.items())]


# ── saving ─────────────────────────────────────────────────────────

@arun
async def test_a_live_product_and_a_live_shop_can_be_saved():
    db = Db()
    assert await favorites.add(db, 1, "product", 10) is True
    assert await favorites.add(db, 1, "shop", 3) is True
    assert [(r["kind"], r.get("product_id"), r.get("merchant_id")) for r in db.rows()] == [("product", 10, None), ("shop", None, 3)]


@arun
async def test_saving_twice_keeps_one_row_and_is_not_an_error():
    db = Db()
    assert await favorites.add(db, 1, "product", 10) is True
    assert await favorites.add(db, 1, "product", 10) is False
    assert len(db.rows()) == 1


@arun
async def test_two_taps_at_once_keep_one_row():
    db = Db()
    results = await asyncio.gather(*[favorites.add(db, 1, "shop", 3) for _ in range(6)])
    assert len(db.rows(kind="shop")) == 1 and sum(1 for r in results if r) == 1


@arun
async def test_a_race_lost_on_the_unique_index_is_treated_as_already_saved():
    db = Db()
    await favorites.add(db, 1, "product", 10)
    class Blind(Q):                                   # the early "already saved?" look misses it
        async def select(self, cols="*"):
            return [] if self.table == "favorites" else await super().select(cols)
    db.from_ = lambda t: Blind(db, t)
    assert await favorites.add(db, 1, "product", 10) is False
    assert len(db.rows()) == 1


@arun
async def test_things_that_do_not_exist_or_are_not_live_cannot_be_saved():
    db = Db()
    for kind, target in (("product", 999), ("product", 12), ("product", 13), ("shop", 999), ("shop", 5)):
        with pytest.raises(NotFoundError):
            await favorites.add(db, 1, kind, target)
    assert not db.rows()


@arun
async def test_product_and_shop_with_the_same_number_are_different_things():
    db = Db()
    await favorites.add(db, 1, "product", 3 + 7)       # product 10
    await favorites.add(db, 1, "shop", 3)
    await favorites.remove(db, 1, "shop", 10)           # no shop 10 saved: must not touch product 10
    assert len(db.rows(kind="product")) == 1
    await favorites.remove(db, 1, "product", 3)         # no product 3 saved: must not touch shop 3
    assert len(db.rows(kind="shop")) == 1


@arun
async def test_there_is_a_limit_per_kind(monkeypatch):
    monkeypatch.setattr(favorites, "MAX_PER_KIND", 1)
    db = Db()
    await favorites.add(db, 1, "product", 10)
    with pytest.raises(BadRequestError, match="up to 1 products"):
        await favorites.add(db, 1, "product", 11)
    assert await favorites.add(db, 1, "shop", 3) is True          # shops have their own allowance
    assert await favorites.add(db, 1, "product", 10) is False     # already saved: never blocked by the limit
    assert await favorites.add(db, 2, "product", 11) is True      # and it is per customer


# ── removing and isolation ─────────────────────────────────────────

@arun
async def test_removing_works_and_removing_something_not_saved_is_fine():
    db = Db()
    await favorites.add(db, 1, "product", 10)
    await favorites.remove(db, 1, "product", 10)
    await favorites.remove(db, 1, "product", 10)
    assert not db.rows()


@arun
async def test_one_customer_cannot_see_or_remove_anothers_favorites():
    db = Db()
    await favorites.add(db, 1, "product", 10)
    await favorites.add(db, 2, "shop", 3)
    await favorites.remove(db, 2, "product", 10)
    assert await favorites.ids_for(db, 1) == {"products": [10], "shops": []}
    assert await favorites.ids_for(db, 2) == {"products": [], "shops": [3]}


@arun
async def test_ids_are_newest_first():
    db = Db()
    for pid in (10, 11):
        await favorites.add(db, 1, "product", pid)
    assert (await favorites.ids_for(db, 1))["products"] == [11, 10]


# ── the lists ──────────────────────────────────────────────────────

@arun
async def test_saved_products_come_back_shaped_for_the_product_card():
    db = Db()
    await favorites.add(db, 1, "product", 10); await favorites.add(db, 1, "product", 11)
    out = await favorites.products_for(db, 1)
    assert [p["id"] for p in out] == [11, 10]                        # newest first
    rose = out[1]
    assert (rose["name"], rose["merchant_name"], rose["has_variants"], rose["available"]) == ("Rose", "Bloom", True, True)
    assert out[0]["has_variants"] is False and out[0]["stock"] == 0   # out of stock is still shown, the card says so


@arun
async def test_a_saved_product_that_went_inactive_stays_listed_as_unavailable():
    db = Db()
    await favorites.add(db, 1, "product", 10)
    db.tables["products"][0]["is_active"] = False
    db.tables["merchants"][0]["status"] = "active"
    out = await favorites.products_for(db, 1)
    assert [(p["id"], p["available"]) for p in out] == [(10, False)]
    db.tables["products"][0]["is_active"] = True
    db.tables["merchants"][0]["status"] = "suspended"                # the shop closing makes it unavailable too
    assert (await favorites.products_for(db, 1))[0]["available"] is False


@arun
async def test_a_product_deleted_since_is_skipped_not_an_error():
    db = Db()
    await favorites.add(db, 1, "product", 10)
    db.tables["products"] = [p for p in db.tables["products"] if p["id"] != 10]
    assert await favorites.products_for(db, 1) == []


@arun
async def test_saved_shops_come_back_with_public_fields_only():
    db = Db()
    await favorites.add(db, 1, "shop", 3); await favorites.add(db, 1, "shop", 4)
    out = await favorites.shops_for(db, 1, public_view, shop_category_names)
    assert [s["id"] for s in out] == [4, 3]
    bloom = out[1]
    assert (bloom["name"], bloom["shop_category"], bloom["available"], bloom["rating"]) == ("Bloom", "Flowers", True, 4.5)
    assert "commission_rate" not in bloom and "bank_account" not in bloom        # private fields never leave
    assert out[0]["shop_category"] is None


@arun
async def test_a_saved_shop_that_closed_stays_listed_as_unavailable():
    db = Db()
    await favorites.add(db, 1, "shop", 3)
    db.tables["merchants"][0]["status"] = "suspended"
    assert (await favorites.shops_for(db, 1, public_view, shop_category_names))[0]["available"] is False


# ── hearts from this device ────────────────────────────────────────

@arun
async def test_device_hearts_are_added_skipping_unknown_inactive_and_repeats():
    db = Db()
    await favorites.add(db, 1, "product", 10)
    r = await favorites.merge(db, 1, [10, 11, 11, 12, 999, 13])
    assert r == {"added": 1, "skipped": 4}                              # 11 is new and live; 10 repeats, 12 inactive, 999 unknown, 13 shop closed
    assert sorted((await favorites.ids_for(db, 1))["products"]) == [10, 11]


@arun
async def test_device_hearts_past_the_limit_are_skipped_not_fatal(monkeypatch):
    monkeypatch.setattr(favorites, "MAX_PER_KIND", 1)
    db = Db()
    r = await favorites.merge(db, 1, [10, 11])
    assert r == {"added": 1, "skipped": 1}


# ── before the migration ───────────────────────────────────────────

@arun
async def test_before_the_migration_lists_are_empty_and_saving_says_what_is_wrong():
    db = Db(migrated=False)
    assert await favorites.ids_for(db, 1) == {"products": [], "shops": []}
    assert await favorites.products_for(db, 1) == [] and await favorites.shops_for(db, 1, public_view, shop_category_names) == []
    await favorites.remove(db, 1, "product", 10)                        # no error
    with pytest.raises(BadRequestError, match="not set up"):
        await favorites.add(db, 1, "product", 10)


# ── HTTP ───────────────────────────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    db = Db()
    @asynccontextmanager
    async def fake():
        yield db
    monkeypatch.setattr(SupabaseClient, "service_role", staticmethod(fake))
    return TestClient(app), db


def hdr(role=Role.USER, tg=111, **kw):
    return {"Authorization": "Bearer " + mint_jwt(sub="1", role=role, telegram_id=tg, expires_in=600, **kw)}


def test_only_signed_in_customers_can_use_favorites(client):
    c, _ = client
    for method, path in (("get", "/api/favorites/ids"), ("get", "/api/favorites/products"), ("get", "/api/favorites/shops"),
                         ("put", "/api/favorites/products/10"), ("delete", "/api/favorites/shops/3"), ("post", "/api/favorites/sync")):
        assert getattr(c, method)(path).status_code == 401, path
    shop = hdr(Role.MERCHANT_ADMIN, merchant_id=3)
    assert c.get("/api/favorites/ids", headers=shop).status_code == 403
    assert c.put("/api/favorites/products/10", headers=shop).status_code == 403


def test_save_list_and_unsave_over_http(client):
    c, db = client
    h = hdr()
    assert c.put("/api/favorites/products/10", headers=h).json() == {"success": True, "added": True}
    assert c.put("/api/favorites/products/10", headers=h).json() == {"success": True, "added": False}
    assert c.put("/api/favorites/shops/3", headers=h).status_code == 200
    assert c.get("/api/favorites/ids", headers=h).json() == {"products": [10], "shops": [3]}
    assert [p["name"] for p in c.get("/api/favorites/products", headers=h).json()["data"]] == ["Rose"]
    assert [s["name"] for s in c.get("/api/favorites/shops", headers=h).json()["data"]] == ["Bloom"]
    assert c.delete("/api/favorites/products/10", headers=h).status_code == 200
    assert c.get("/api/favorites/ids", headers=h).json() == {"products": [], "shops": [3]}
    # another customer sees none of it
    assert c.get("/api/favorites/ids", headers=hdr(tg=222)).json() == {"products": [], "shops": []}


def test_saving_something_missing_is_a_404_and_junk_ids_are_rejected(client):
    c, _ = client
    assert c.put("/api/favorites/products/999", headers=hdr()).status_code == 404
    assert c.put("/api/favorites/shops/5", headers=hdr()).status_code == 404
    assert c.put("/api/favorites/products/abc", headers=hdr()).status_code == 422


def test_sync_adds_device_hearts_and_returns_the_account_list(client):
    c, _ = client
    r = c.post("/api/favorites/sync", headers=hdr(), json={"product_ids": [10, 11, 999]})
    assert r.status_code == 200 and r.json()["added"] == 2 and sorted(r.json()["products"]) == [10, 11]
    assert c.post("/api/favorites/sync", headers=hdr(), json={"product_ids": list(range(501))}).status_code == 422   # not a way to flood


def test_the_endpoints_tell_the_customer_when_favorites_are_not_set_up_yet(client):
    c, db = client
    db.migrated = False
    h = hdr()
    assert c.get("/api/favorites/ids", headers=h).json() == {"products": [], "shops": []}
    assert c.get("/api/favorites/products", headers=h).json() == {"data": []}
    r = c.put("/api/favorites/products/10", headers=h)
    assert r.status_code == 400 and "not set up" in r.text
