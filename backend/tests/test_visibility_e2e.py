"""End-to-end through the real API routes: a shop that is still setting up is invisible to customers
everywhere and cannot be ordered from, while a live shop stays visible and orderable.

The database is an in-memory fake that speaks the query builder's filters, so every route runs its
real code. Seeded with:  shop 1 "Live Cakes" (live)  ·  shop 2 "New Bakery" (active, setup not done)
· shop 3 "Suspended Tees" (set up once, then suspended).
"""

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.constants import Role
from app.core.security import mint_jwt
from app.db.client import SupabaseClient
from app.main import app
from app.services import favorites, order_expiry

LIVE, HIDDEN, SUSPENDED = 1, 2, 3
SOON = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()


class Q:
    def __init__(self, db, table):
        self.db, self.table, self.tests, self._limit, self._offset = db, table, [], None, 0

    def _t(self, f):
        self.tests.append(f); return self

    def eq(self, c, v): return self._t(lambda r: r.get(c) == v)
    def neq(self, c, v): return self._t(lambda r: r.get(c) != v)
    def gt(self, c, v): return self._t(lambda r: r.get(c) is not None and r[c] > v)
    def gte(self, c, v): return self._t(lambda r: r.get(c) is not None and r[c] >= v)
    def lt(self, c, v): return self._t(lambda r: r.get(c) is not None and r[c] < v)
    def lte(self, c, v): return self._t(lambda r: r.get(c) is not None and r[c] <= v)
    def in_(self, c, vs): return self._t(lambda r: r.get(c) in list(vs))
    def is_(self, c, v): return self._t(lambda r: r.get(c) is None)
    def ilike(self, c, p): return self._t(lambda r: p.strip("*%").lower() in str(r.get(c) or "").lower())

    def not_(self, c, op, v):
        if op == "is":
            return self._t(lambda r: r.get(c) is not None)
        if op == "in":
            vals = [x.strip() for x in str(v).strip("()").split(",")]
            return self._t(lambda r: str(r.get(c)) not in vals)
        return self

    def or_(self, *conds):
        def one(r, cond):
            col, op, val = cond.split(".", 2)
            return r.get(col) is None if (op, val) == ("is", "null") else str(r.get(col)) == val
        return self._t(lambda r: any(one(r, c) for c in conds))

    def order(self, *a, **k): return self
    def limit(self, n): self._limit = n; return self
    def offset(self, n): self._offset = n; return self

    def _rows(self):
        rows = [r for r in self.db.t.setdefault(self.table, []) if all(t(r) for t in self.tests)]
        rows = rows[self._offset:]
        return rows[: self._limit] if self._limit else rows

    async def select(self, columns: str = "*"):
        """Like PostgREST: only the columns asked for (so a missing column in a select shows up here)."""
        rows = [dict(r) for r in self._rows()]
        if not columns or columns.strip() == "*" or "(" in columns:
            return rows
        keep = [c.strip() for c in columns.split(",")]
        return [{k: r.get(k) for k in keep if k in r} for r in rows]

    async def select_one(self, columns: str = "*"):
        rows = await self.select(columns)
        return rows[0] if rows else None

    async def update(self, data):
        rows = self._rows()
        for r in rows:
            r.update(data)
        return [dict(r) for r in rows]

    async def insert(self, data):
        rows = self.db.t.setdefault(self.table, [])
        defaults = {"setup_completed_at": None} if self.table == "merchants" else {}   # the column's default
        row = {"id": max((r["id"] for r in rows), default=0) + 1, **defaults, **data}
        rows.append(row)
        return [dict(row)]

    async def delete(self):
        doomed = self._rows()
        self.db.t[self.table] = [r for r in self.db.t[self.table] if r not in doomed]
        return doomed


def shop(id, name, status="active", live=True, **kw):
    return {"id": id, "name": name, "slug": name.lower().replace(" ", "-"), "status": status,
            "setup_completed_at": "2026-11-01T00:00:00Z" if live else None,
            "shop_category_id": 1, "shop_subcategory_id": None, "latitude": 11.5564, "longitude": 104.9282,
            "delivery_radius_km": 5, "opening_hours": None, "address": "Phnom Penh", "email": "x@y", "owner_name": "O",
            "created_at": "2026-11-01T00:00:00Z", **kw}


def product(id, merchant_id, name):
    return {"id": id, "merchant_id": merchant_id, "name": name, "is_active": True, "base_price": 5, "stock": 10,
            "category_id": None, "created_at": "2026-11-02T00:00:00Z", "rating_avg": 0, "review_count": 0,
            "attributes": {}, "attribute_template_id": None, "primary_image": None}


class DB:
    def __init__(self):
        self.t = {
            "merchants": [shop(LIVE, "Live Cakes"), shop(HIDDEN, "New Bakery", live=False),
                          shop(SUSPENDED, "Suspended Tees", status="suspended")],
            "products": [product(10, LIVE, "Chocolate cake"), product(20, HIDDEN, "Cheesecake"), product(30, SUSPENDED, "Tee")],
            "shop_categories": [{"id": 1, "name": "Food & Beverage", "sort_order": 1}],
            "shop_subcategories": [],
            "promotions": [
                {"id": 1, "merchant_id": LIVE, "title": "Live sale", "is_active": True, "display_locations": ["home_promotions"], "sort_order": 1, "scope": "shop", "schedule_type": "once", "starts_at": None, "ends_at": None, "category_id": None, "promo_code_id": None},
                {"id": 2, "merchant_id": HIDDEN, "title": "Hidden sale", "is_active": True, "display_locations": ["home_promotions"], "sort_order": 2, "scope": "shop", "schedule_type": "once", "starts_at": None, "ends_at": None, "category_id": None, "promo_code_id": None},
                {"id": 3, "merchant_id": None, "title": "Platform sale", "is_active": True, "display_locations": ["home_promotions"], "sort_order": 3, "scope": "shop", "schedule_type": "once", "starts_at": None, "ends_at": None, "category_id": None, "promo_code_id": None},
            ],
            "promo_codes": [
                {"id": 1, "code": "LIVE10", "merchant_id": LIVE, "is_active": True, "expires_at": SOON, "audience": "public", "created_at": "2026-11-01"},
                {"id": 2, "code": "HIDDEN10", "merchant_id": HIDDEN, "is_active": True, "expires_at": SOON, "audience": "public", "created_at": "2026-11-01"},
            ],
            "merchant_collections": [], "collection_products": [], "product_images": [], "product_variants": [],
            "product_variant_options": [], "categories": [], "orders": [], "attribute_templates": [], "attribute_definitions": [],
            "users": [{"id": 7, "telegram_id": 777, "first_name": "Ana"}], "cart": [], "cart_items": [],
            "favorites": [], "shop_reviews": [], "reviews": [], "merchant_hero_images": [],
        }

    def from_(self, table):
        return Q(self, table)

    async def rpc(self, *a, **k):
        return None


@pytest.fixture
def client(monkeypatch):
    db = DB()

    @asynccontextmanager
    async def service_role():
        yield db

    monkeypatch.setattr(SupabaseClient, "service_role", staticmethod(service_role))

    async def no_sweep(db_):
        return []
    monkeypatch.setattr(order_expiry, "sweep_if_due", no_sweep)
    c = TestClient(app)
    c.db = db
    return c


CUSTOMER = {"Authorization": "Bearer " + mint_jwt(sub="u7", role=Role.USER, telegram_id=777, expires_in=600)}
OWNER_OF_HIDDEN = {"Authorization": "Bearer " + mint_jwt(sub="9", role=Role.MERCHANT_ADMIN, merchant_id=HIDDEN, merchant_role="owner", expires_in=600)}


def ids(rows, key="id"):
    return sorted({r[key] for r in rows})


def test_shop_list_and_shop_pages(client):
    assert ids(client.get("/api/merchants").json()) == [LIVE]
    assert client.get(f"/api/merchants/{LIVE}").status_code == 200
    assert client.get(f"/api/merchants/{HIDDEN}").status_code == 404
    assert client.get(f"/api/merchants/{SUSPENDED}").status_code == 404
    assert client.get(f"/api/merchants/{HIDDEN}", headers=OWNER_OF_HIDDEN).status_code == 200   # preview


def test_map(client):
    rows = client.get("/api/merchants/nearby", params={"lat": 11.5564, "lng": 104.9282}).json()
    assert ids(rows.get("data", rows) if isinstance(rows, dict) else rows) == [LIVE]


def test_products_and_product_pages(client):
    assert ids(client.get("/api/products").json(), "merchant_id") == [LIVE]
    assert client.get("/api/products/10").status_code == 200
    assert client.get("/api/products/20").status_code == 404
    assert client.get("/api/products/30").status_code == 404


def test_search(client):
    body = client.get("/api/search/products").json()
    assert ids(body["data"], "merchant_id") == [LIVE] and body["total"] == 1
    assert client.get("/api/search/products", params={"q": "cheese"}).json()["total"] == 0


def test_shop_type_counts(client):
    cats = client.get("/api/shop-categories", params={"with_shops": "true"}).json()["data"]
    assert cats[0]["shop_count"] == 1


def test_promotions_and_codes(client):
    titles = [p["title"] for p in client.get("/api/promotions").json()]
    assert "Hidden sale" not in titles and "Live sale" in titles and "Platform sale" in titles
    codes = [c["code"] for c in client.get("/api/promos/active").json()]
    assert codes == ["LIVE10"]


def test_collections(client):
    assert client.get(f"/api/merchants/{HIDDEN}/collections").json() == []   # nothing to show
    assert client.get(f"/api/merchants/{LIVE}/collections").status_code == 200


def test_favourites_mark_a_hidden_shop_unavailable(client):
    import asyncio
    db = client.db
    assert asyncio.run(favorites._target_is_live(db, "shop", HIDDEN)) is False
    assert asyncio.run(favorites._target_is_live(db, "shop", LIVE)) is True
    assert asyncio.run(favorites._target_is_live(db, "product", 20)) is False
    assert asyncio.run(favorites._target_is_live(db, "product", 10)) is True


def test_cart_and_checkout(client):
    assert client.post("/api/cart/add", headers=CUSTOMER, json={"product_id": 20, "quantity": 1}).status_code == 404
    assert client.post("/api/cart/add", headers=CUSTOMER, json={"product_id": 10, "quantity": 1}).status_code == 200
    # A cart that already holds a hidden shop's item (added before) cannot be checked out
    db = client.db
    db.t["cart"].append({"id": 99, "user_id": 7, "merchant_id": HIDDEN})
    db.t["cart_items"].append({"id": 99, "cart_id": 99, "product_id": 20, "quantity": 1, "unit_price": 5, "selected_variants": None})
    r = client.post("/api/orders/quote", headers=CUSTOMER, json={"merchant_id": HIDDEN, "delivery_type": "pickup"})
    assert r.status_code == 400 and "isn't taking orders" in r.text
    ok = client.post("/api/orders/quote", headers=CUSTOMER, json={"merchant_id": LIVE, "delivery_type": "pickup"})
    assert ok.status_code == 200, ok.text


SUPER = {"Authorization": "Bearer " + mint_jwt(sub="1", role=Role.SUPER_ADMIN, email="admin@x", expires_in=600)}


def test_a_newly_approved_shop_starts_hidden(client, monkeypatch):
    db = client.db
    db.t["seller_applications"] = [{
        "id": 1, "status": "pending", "email": "new@shop.test", "store_name": "Fresh Bakery", "full_name": "Owner",
        "phone": None, "store_description": None, "logo_url": None, "shop_category_id": 1, "shop_subcategory_id": None,
        "password_hash": "x", "telegram_id": None, "user_id": None,
    }]
    db.t["merchant_admins"] = []
    r = client.patch("/api/seller-applications/admin/1/approve", headers=SUPER, json={})
    assert r.status_code == 200, r.text
    new = next(m for m in db.t["merchants"] if m["name"] == "Fresh Bakery")
    assert new["status"] == "active" and new.get("setup_completed_at") is None   # active, but not live
    assert new["id"] not in ids(client.get("/api/merchants").json())
    assert client.get(f"/api/merchants/{new['id']}").status_code == 404


def test_24_7_opening_hours_save_and_count(client):
    from app.services import shop_setup
    from app.services.delivery import is_open
    db = client.db
    owner = {"Authorization": "Bearer " + mint_jwt(sub="9", role=Role.MERCHANT_ADMIN, merchant_id=LIVE, merchant_role="owner", expires_in=600)}
    r = client.patch(f"/api/merchants/{LIVE}", headers=owner, json={"opening_hours": shop_setup.ALWAYS_OPEN})
    assert r.status_code == 200, r.text
    saved = next(m for m in db.t["merchants"] if m["id"] == LIVE)["opening_hours"]
    assert saved == shop_setup.ALWAYS_OPEN and shop_setup.is_always_open(saved) and is_open(saved)
    import asyncio
    state = asyncio.run(shop_setup.checklist(db, LIVE))
    assert next(i for i in state["required"] if i["key"] == "hours")["done"] and state["always_open"]
    # and a normal weekly schedule
    week = {"mon": [["08:00", "20:00"]], "tue": [["08:00", "20:00"]]}
    assert client.patch(f"/api/merchants/{LIVE}", headers=owner, json={"opening_hours": week}).status_code == 200
    assert next(m for m in db.t["merchants"] if m["id"] == LIVE)["opening_hours"] == week
    assert client.patch(f"/api/merchants/{LIVE}", headers=owner, json={"opening_hours": {"mon": [["8am", "8pm"]]}}).status_code == 400
