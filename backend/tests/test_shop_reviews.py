"""Shop ratings & reviews: who may review, the average, what the public sees, and moderation (database faked).

The fake keeps the properties that matter: shop_reviews.order_id is unique (a second insert fails with 23505),
recalc_shop_rating() recomputes the cached average over visible reviews only, and with `migrated=False` the
table and the function do not exist, as before migration 029.
"""

import asyncio
from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.constants import Role
from app.core.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims, mint_jwt
from app.db.client import SupabaseClient
from app.main import app
from app.models.shop_review import ShopReviewCreate, VisibilityUpdate
from app.routes import merchants as merchants_route
from app.routes import orders as orders_route
from app.routes import shop_reviews as route
from app.services import notify, shop_reviews


def pg_error(code, message="error", status=400):
    req = httpx.Request("POST", "http://db/x")
    return httpx.HTTPStatusError("e", request=req, response=httpx.Response(status, json={"code": code, "message": message}, request=req))


class Q:
    def __init__(self, db, table):
        self.db, self.table, self.f, self.order_by, self.max = db, table, [], None, None

    def _check(self):
        if not self.db.migrated and self.table == "shop_reviews":
            raise pg_error("PGRST205", "Could not find the table 'public.shop_reviews'", 404)

    def _add(self, *c): self.f.append(c); return self
    def eq(self, col, val): return self._add("eq", col, val)
    def lt(self, col, val): return self._add("lt", col, val)
    def in_(self, col, vals): return self._add("in", col, list(vals))
    def order(self, col, *, desc=False, nulls_last=False): self.order_by = (col, desc); return self
    def limit(self, n): self.max = n; return self

    def _rows(self):
        rows = []
        for r in self.db.tables.setdefault(self.table, []):
            ok = True
            for op, col, val in self.f:
                v = r.get(col)
                ok &= (v == val) if op == "eq" else (v is not None and v < val) if op == "lt" else (v in val)
            if ok:
                rows.append(r)
        if self.order_by:
            col, desc = self.order_by
            rows = sorted(rows, key=lambda r: r.get(col) or 0, reverse=desc)
        return rows[: self.max] if self.max else rows

    async def select(self, *_):
        self._check(); await asyncio.sleep(0)
        return [dict(r) for r in self._rows()]

    async def select_one(self, *_):
        rows = await self.select()
        return rows[0] if rows else None

    async def insert(self, data):
        self._check(); await asyncio.sleep(0)
        rows = self.db.tables.setdefault(self.table, [])
        if self.table == "shop_reviews" and any(r["order_id"] == data["order_id"] for r in rows):
            raise pg_error("23505", "duplicate key value violates unique constraint", 409)
        self.db.next_id += 1
        row = {"id": self.db.next_id, "is_visible": True, "created_at": f"2026-11-22T10:{self.db.next_id % 60:02d}:00Z", **data}
        rows.append(row)
        return [dict(row)]

    async def update(self, data):
        self._check(); await asyncio.sleep(0)
        rows = self._rows()
        for r in rows: r.update(data)
        return [dict(r) for r in rows]


class Db:
    def __init__(self, migrated=True):
        self.migrated, self.next_id = migrated, 100
        self.tables = {
            "users": [
                {"id": 1, "telegram_id": 111, "first_name": "Mai", "last_name": "Soklyna", "username": "mai_secret", "phone": "012999"},
                {"id": 2, "telegram_id": 222, "first_name": "Sok", "last_name": None},
                {"id": 3, "telegram_id": 333, "first_name": "Dara", "last_name": "Chan"},
            ],
            "merchants": [{"id": 3, "name": "Bloom", "status": "active", "rating": None, "rating_count": 0},
                          {"id": 4, "name": "Cakes", "status": "active", "rating": None, "rating_count": 0},
                          {"id": 5, "name": "Closed", "status": "suspended"}],
            "orders": [], "shop_reviews": [], "notifications": [],
        }
        for oid, uid, status in ((50, 1, "delivered"), (51, 2, "delivered"), (52, 3, "delivered"), (53, 1, "shipped"),
                                 (54, 1, "pending"), (55, 1, "cancelled"), (56, 1, "confirmed"), (57, 1, "delivered")):
            self.tables["orders"].append({"id": oid, "order_code": f"FS-{oid}", "user_id": uid, "merchant_id": 3, "status": status})
        self.tables["orders"].append({"id": 60, "order_code": "FS-60", "user_id": 1, "merchant_id": 4, "status": "delivered"})

    def from_(self, table): return Q(self, table)

    async def rpc(self, name, params):
        assert name == "recalc_shop_rating"
        if not self.migrated:
            raise pg_error("PGRST202", "Could not find the function", 404)
        mid = params["p_merchant_id"]
        vis = [r["rating"] for r in self.tables["shop_reviews"] if r["merchant_id"] == mid and r["is_visible"]]
        shop = next(m for m in self.tables["merchants"] if m["id"] == mid)
        shop["rating"], shop["rating_count"] = (round(sum(vis) / len(vis), 2) if vis else None), len(vis)

    def shop(self, mid): return next(m for m in self.tables["merchants"] if m["id"] == mid)
    def reviews(self, **m): return [r for r in self.tables["shop_reviews"] if all(r.get(k) == v for k, v in m.items())]
    def notes(self, **m): return [n for n in self.tables["notifications"] if all(n.get(k) == v for k, v in m.items())]


@pytest.fixture
def db(monkeypatch):
    database = Db()

    @asynccontextmanager
    async def service_role():
        yield database

    monkeypatch.setattr(SupabaseClient, "service_role", staticmethod(service_role))
    return database


def run(coro): return asyncio.run(coro)


MAI = TokenClaims(sub="1", role=Role.USER, telegram_id=111)
SOK = TokenClaims(sub="2", role=Role.USER, telegram_id=222)
DARA = TokenClaims(sub="3", role=Role.USER, telegram_id=333)
BLOOM = TokenClaims(sub="9", role=Role.MERCHANT_ADMIN, merchant_id=3)
CAKES = TokenClaims(sub="8", role=Role.MERCHANT_ADMIN, merchant_id=4)
SUPER = TokenClaims(sub="1", role=Role.SUPER_ADMIN)


def review(user, order_id, rating=5, comment=None):
    return run(route.create_shop_review(ShopReviewCreate(order_id=order_id, rating=rating, comment=comment), user=user))


# ── submitting ─────────────────────────────────────────────────────

def test_a_customer_reviews_a_delivered_order(db):
    out = review(MAI, 50, 5, "  Lovely cakes  ")
    assert out["success"] and out["data"]["rating"] == 5
    row = db.reviews(order_id=50)[0]
    assert (row["user_id"], row["merchant_id"], row["comment"]) == (1, 3, "Lovely cakes")
    assert (db.shop(3)["rating"], db.shop(3)["rating_count"]) == (5.0, 1)


def test_only_a_delivered_order_can_be_reviewed(db):
    for order_id in (53, 54, 55, 56):  # shipped, pending, cancelled, confirmed
        with pytest.raises(BadRequestError):
            review(MAI, order_id)
    assert db.tables["shop_reviews"] == []


def test_only_the_customer_who_ordered_can_review(db):
    with pytest.raises(ForbiddenError):
        review(SOK, 50)
    assert db.tables["shop_reviews"] == []


def test_unknown_order_and_unknown_user(db):
    with pytest.raises(NotFoundError):
        review(MAI, 999)
    with pytest.raises(NotFoundError):
        review(TokenClaims(sub="9", role=Role.USER, telegram_id=999999), 50)


def test_one_review_per_order(db):
    review(MAI, 50, 5)
    with pytest.raises(ConflictError):
        review(MAI, 50, 1)
    assert [r["rating"] for r in db.reviews(order_id=50)] == [5]
    assert db.shop(3)["rating"] == 5.0


def test_double_tap_creates_one_review_and_one_notification(db):
    async def go():
        call = lambda: route.create_shop_review(ShopReviewCreate(order_id=50, rating=4), user=MAI)
        return await asyncio.gather(call(), call(), return_exceptions=True)

    results = run(go())
    assert sum(isinstance(r, dict) for r in results) == 1 and sum(isinstance(r, ConflictError) for r in results) == 1
    assert len(db.reviews(order_id=50)) == 1 and db.shop(3)["rating_count"] == 1
    assert len(db.notes(merchant_id=3)) == 1


def test_the_review_model_checks_the_stars_and_text():
    for bad in (0, 6, -1):
        with pytest.raises(ValidationError):
            ShopReviewCreate(order_id=1, rating=bad)
    assert ShopReviewCreate(order_id=1, rating=1).rating == 1 and ShopReviewCreate(order_id=1, rating=5).rating == 5
    assert ShopReviewCreate(order_id=1, rating=5, comment="   ").comment is None
    assert ShopReviewCreate(order_id=1, rating=5, comment=" ok ").comment == "ok"
    with pytest.raises(ValidationError):
        ShopReviewCreate(order_id=1, rating=5, comment="x" * 1001)


def test_the_shop_is_told_about_a_review(db):
    review(MAI, 50, 4, "Nice")
    note = db.notes(merchant_id=3)[0]
    assert (note["title"], note["kind"], note["link"]) == ("New 4★ review", "review", "/reviews")
    assert note["body"] == "Mai S.: Nice"
    review(SOK, 51, 2)
    assert db.notes(merchant_id=3)[1]["body"] == "Sok: No comment"


# ── the average ────────────────────────────────────────────────────

def test_average_and_count_follow_the_reviews(db):
    review(MAI, 50, 5); review(SOK, 51, 4); review(DARA, 52, 4)
    assert (db.shop(3)["rating"], db.shop(3)["rating_count"]) == (4.33, 3)
    assert db.shop(4)["rating_count"] == 0                      # another shop is untouched


def test_summary_counts_each_star(db):
    review(MAI, 50, 5); review(SOK, 51, 4); review(DARA, 52, 4)
    s = run(shop_reviews.summary(db, 3))
    assert (s["rating"], s["count"]) == (4.33, 3)
    assert s["distribution"] == {"5": 1, "4": 2, "3": 0, "2": 0, "1": 0}
    assert run(shop_reviews.summary(db, 4)) == {"rating": None, "count": 0, "distribution": {"5": 0, "4": 0, "3": 0, "2": 0, "1": 0}}


def test_a_hidden_review_leaves_the_average_and_comes_back(db):
    review(MAI, 50, 5); review(SOK, 51, 1)
    assert db.shop(3)["rating"] == 3.0
    bad = db.reviews(order_id=51)[0]["id"]
    run(route.set_visibility(bad, VisibilityUpdate(is_visible=False), user=SUPER))
    assert (db.shop(3)["rating"], db.shop(3)["rating_count"]) == (5.0, 1)
    assert run(shop_reviews.summary(db, 3))["count"] == 1
    run(route.set_visibility(bad, VisibilityUpdate(is_visible=True), user=SUPER))
    assert (db.shop(3)["rating"], db.shop(3)["rating_count"]) == (3.0, 2)


def test_hiding_the_only_review_clears_the_rating(db):
    review(MAI, 50, 5)
    run(route.set_visibility(db.reviews()[0]["id"], VisibilityUpdate(is_visible=False), user=SUPER))
    assert (db.shop(3)["rating"], db.shop(3)["rating_count"]) == (None, 0)


def test_hiding_an_unknown_review_is_not_found(db):
    with pytest.raises(NotFoundError):
        run(route.set_visibility(999, VisibilityUpdate(is_visible=False), user=SUPER))


# ── what the public sees ───────────────────────────────────────────

def test_public_list_is_newest_first_and_hides_who_exactly_wrote_it(db):
    review(MAI, 50, 5, "First"); review(SOK, 51, 4, "Second"); review(DARA, 52, 3, "Third")
    out = run(route.shop_reviews_public(3))
    assert [r["comment"] for r in out["reviews"]] == ["Third", "Second", "First"]
    assert [r["reviewer"] for r in out["reviews"]] == ["Dara C.", "Sok", "Mai S."]
    text = str(out)
    assert "mai_secret" not in text and "012999" not in text and "Soklyna" not in text   # no username, phone, surname
    assert all("user_id" not in r and "order_id" not in r and "is_visible" not in r for r in out["reviews"])
    assert out["summary"]["count"] == 3


def test_public_list_pages_with_a_cursor_and_skips_hidden(db):
    for user, oid in ((MAI, 50), (SOK, 51), (DARA, 52), (MAI, 57)):
        review(user, oid, 5, f"r{oid}")
    run(route.set_visibility(db.reviews(order_id=51)[0]["id"], VisibilityUpdate(is_visible=False), user=SUPER))
    first = run(route.shop_reviews_public(3, limit=2))["reviews"]
    second = run(route.shop_reviews_public(3, limit=2, before=first[-1]["id"]))["reviews"]
    assert [r["comment"] for r in first] == ["r57", "r52"] and [r["comment"] for r in second] == ["r50"]


def test_public_list_is_only_for_active_shops(db):
    with pytest.raises(NotFoundError):
        run(route.shop_reviews_public(5))
    with pytest.raises(NotFoundError):
        run(route.shop_reviews_public(999))


def test_a_shop_with_no_reviews_says_so(db):
    out = run(route.shop_reviews_public(4))
    assert out["reviews"] == [] and out["summary"]["rating"] is None and out["summary"]["count"] == 0


def test_the_order_shows_its_review(db):
    assert run(shop_reviews.for_order(db, 50)) is None
    review(MAI, 50, 5, "Great")
    mine = run(shop_reviews.for_order(db, 50))
    assert (mine["rating"], mine["comment"]) == (5, "Great")


def test_shop_ratings_are_public_fields():
    assert "rating" in merchants_route.PUBLIC_FIELDS and "rating_count" in merchants_route.PUBLIC_FIELDS
    assert "rating_count" in merchants_route.NEARBY_PUBLIC_FIELDS


# ── a shop's dashboard ─────────────────────────────────────────────

def test_a_shop_sees_only_its_own_reviews(db):
    review(MAI, 50, 5, "Bloom review"); review(MAI, 60, 2, "Cakes review")
    mine = run(route.my_shop_summary(user=BLOOM))
    assert [r["comment"] for r in mine["latest"]] == ["Bloom review"] and mine["summary"]["rating"] == 5.0
    assert [r["comment"] for r in run(route.my_shop_reviews(user=CAKES))["data"]] == ["Cakes review"]
    with pytest.raises(ForbiddenError):
        run(route.my_shop_summary(user=TokenClaims(sub="1", role=Role.MERCHANT_ADMIN)))


def test_the_dashboard_shows_the_latest_five(db):
    for i, (user, oid) in enumerate(((MAI, 50), (SOK, 51), (DARA, 52), (MAI, 57))):
        review(user, oid, 5, f"c{i}")
    assert len(run(route.my_shop_summary(user=BLOOM))["latest"]) == 4


# ── moderation ─────────────────────────────────────────────────────

def test_admin_list_includes_hidden_reviews_and_shop_names(db):
    review(MAI, 50, 5, "ok"); review(SOK, 51, 1, "rude")
    run(route.set_visibility(db.reviews(order_id=51)[0]["id"], VisibilityUpdate(is_visible=False), user=SUPER))
    rows = run(route.admin_list(user=SUPER))["data"]
    assert [(r["comment"], r["is_visible"], r["shop_name"], r["reviewer"]) for r in rows] == [("rude", False, "Bloom", "Sok"), ("ok", True, "Bloom", "Mai S.")]
    assert [r["comment"] for r in run(route.admin_list(merchant_id=4, user=SUPER))["data"]] == []


# ── before migration 029 ───────────────────────────────────────────

def test_everything_degrades_quietly_before_migration_029(db):
    db.migrated = False
    out = run(route.shop_reviews_public(3))
    assert out["reviews"] == [] and out["summary"]["count"] == 0 and out["summary"]["rating"] is None
    assert run(route.my_shop_summary(user=BLOOM))["summary"]["count"] == 0
    assert run(route.my_shop_reviews(user=BLOOM)) == {"data": []}
    assert run(route.admin_list(user=SUPER)) == {"data": []}
    assert run(shop_reviews.for_order(db, 50)) is None
    with pytest.raises(BadRequestError) as err:
        review(MAI, 50)
    assert "not set up" in str(getattr(err.value, "detail", err.value))
    with pytest.raises(BadRequestError):
        run(route.set_visibility(1, VisibilityUpdate(is_visible=False), user=SUPER))


def test_a_review_survives_a_failing_rating_refresh(db, monkeypatch):
    """The review is saved first; if refreshing the cached average fails, the customer still succeeds."""
    async def broken(name, params): raise pg_error("XX000", "boom", 500)
    monkeypatch.setattr(db, "rpc", broken)
    assert review(MAI, 50, 4)["success"] and len(db.reviews(order_id=50)) == 1


# ── the HTTP layer ─────────────────────────────────────────────────

def bearer(role, **kw): return {"Authorization": "Bearer " + mint_jwt(sub="1", role=role, **kw)}


def test_who_may_call_what(db):
    c = TestClient(app)
    cust, shop, boss = bearer(Role.USER, telegram_id=111), bearer(Role.MERCHANT_ADMIN, merchant_id=3), bearer(Role.SUPER_ADMIN)
    payload = {"order_id": 50, "rating": 5}
    assert c.get("/api/shop-reviews/shops/3").status_code == 200                         # public
    assert c.post("/api/shop-reviews", json=payload).status_code == 401                  # anonymous cannot review
    assert c.post("/api/shop-reviews", json=payload, headers=shop).status_code == 403    # a shop cannot review itself
    assert c.get("/api/shop-reviews/merchant/summary", headers=cust).status_code == 403
    assert c.get("/api/shop-reviews/admin/list", headers=shop).status_code == 403
    assert c.patch("/api/shop-reviews/admin/1/visibility", json={"is_visible": False}, headers=shop).status_code == 403
    assert c.get("/api/shop-reviews/merchant/summary", headers=shop).status_code == 200
    assert c.get("/api/shop-reviews/admin/list", headers=boss).status_code == 200
    assert c.post("/api/shop-reviews", json={"order_id": 50, "rating": 9}, headers=cust).status_code == 422
    assert c.post("/api/shop-reviews", json=payload, headers=cust).status_code == 200
    assert c.post("/api/shop-reviews", json=payload, headers=cust).status_code == 409


def test_order_details_include_the_customers_review(db, monkeypatch):
    async def db_user(db_, user): return {"id": 1, "telegram_id": 111}
    async def customer_view(db_, order_id, **kw): return None
    monkeypatch.setattr(orders_route, "_get_db_user", db_user)
    monkeypatch.setattr(orders_route.deliveries, "customer_view", customer_view)
    db.tables["order_items"] = []
    c = TestClient(app)
    mine = bearer(Role.USER, telegram_id=111)
    assert c.get("/api/orders/50", headers=mine).json()["shop_review"] is None
    review(MAI, 50, 4, "Good")
    body = c.get("/api/orders/50", headers=mine).json()
    assert (body["shop_review"]["rating"], body["shop_review"]["comment"]) == (4, "Good")
