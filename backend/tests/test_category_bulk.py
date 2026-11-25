"""Bulk category management: move all products, delete with move, set the category of many products.

Covers: a shop only ever touches its own products (also inside a platform category), products only
go to a category they may belong to, deleting a category never strands products, the activity log
gets one entry per shop, and the permission rule for deleting.
"""

import asyncio

import pytest

from app.core.constants import Role
from app.core.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from app.core.permissions import Perm, required_permission
from app.core.security import TokenClaims
from app.services import audit, category_bulk

SHOP_A = TokenClaims(sub="1", role=Role.MERCHANT_ADMIN, merchant_id=1, merchant_role="owner")
SHOP_B = TokenClaims(sub="2", role=Role.MERCHANT_ADMIN, merchant_id=2, merchant_role="owner")
ADMIN = TokenClaims(sub="1", role=Role.SUPER_ADMIN)


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.tests = db, table, []

    def eq(self, col, val):
        self.tests.append(lambda r: r.get(col) == val)
        return self

    def in_(self, col, vals):
        self.tests.append(lambda r: r.get(col) in vals)
        return self

    def _rows(self):
        return [r for r in self.db.tables[self.table] if all(t(r) for t in self.tests)]

    async def select(self, *_):
        await asyncio.sleep(0)
        return [dict(r) for r in self._rows()]

    async def select_one(self, *_):
        rows = await self.select()
        return rows[0] if rows else None

    async def update(self, data):
        await asyncio.sleep(0)
        rows = self._rows()
        for r in rows:
            r.update(data)
        return [dict(r) for r in rows]


class FakeDB:
    def __init__(self):
        self.tables = {
            "categories": [
                {"id": 10, "name": "Serums", "merchant_id": 1, "is_active": True},
                {"id": 11, "name": "Toners", "merchant_id": 1, "is_active": True},
                {"id": 12, "name": "Old", "merchant_id": 1, "is_active": False},
                {"id": 20, "name": "Shirts", "merchant_id": 2, "is_active": True},
                {"id": 90, "name": "Gifts", "merchant_id": None, "is_active": True},   # platform-wide
                {"id": 91, "name": "Sale", "merchant_id": None, "is_active": True},    # platform-wide
            ],
            "products": [
                {"id": 1, "name": "Ampoule", "merchant_id": 1, "category_id": 10},
                {"id": 2, "name": "Essence", "merchant_id": 1, "category_id": 10},
                {"id": 3, "name": "Toner", "merchant_id": 1, "category_id": 11},
                {"id": 4, "name": "Gift box A", "merchant_id": 1, "category_id": 90},
                {"id": 5, "name": "Gift box B", "merchant_id": 2, "category_id": 90},
                {"id": 6, "name": "Tee", "merchant_id": 2, "category_id": 20},
            ],
        }

    def from_(self, table):
        return Query(self, table)

    def cat_of(self, pid):
        return next(p for p in self.tables["products"] if p["id"] == pid)["category_id"]


@pytest.fixture
def log(monkeypatch):
    entries = []

    async def record(db, user, **kw):
        entries.append(kw)

    monkeypatch.setattr(audit, "record", record)
    return entries


def run(coro):
    return asyncio.run(coro)


# ── Move all products ───────────────────────────────────────────

def test_merge_two_categories(log):
    db = FakeDB()
    out = run(category_bulk.move_all(db, SHOP_A, 10, 11))
    assert out == {"moved": 2, "from": "Serums", "to": "Toners"}
    assert [db.cat_of(i) for i in (1, 2, 3)] == [11, 11, 11]
    (entry,) = log
    assert entry["action"] == "category.products_moved" and entry["merchant_id"] == 1
    assert entry["new"]["products"] == 2 and entry["new"]["category"] == "Toners"


def test_move_to_no_category(log):
    db = FakeDB()
    assert run(category_bulk.move_all(db, SHOP_A, 10, None))["moved"] == 2
    assert db.cat_of(1) is None


def test_a_shop_moves_only_its_own_products_out_of_a_platform_category(log):
    db = FakeDB()
    assert run(category_bulk.move_all(db, SHOP_A, 90, 11))["moved"] == 1
    assert db.cat_of(4) == 11 and db.cat_of(5) == 90   # shop B's gift box stays


def test_a_shop_cannot_use_another_shops_category(log):
    db = FakeDB()
    with pytest.raises(ForbiddenError):
        run(category_bulk.move_all(db, SHOP_A, 10, 20))
    with pytest.raises(ForbiddenError):
        run(category_bulk.move_all(db, SHOP_A, 20, 10))


def test_platform_admin_cannot_put_two_shops_products_into_one_shops_category(log):
    db = FakeDB()
    with pytest.raises(BadRequestError):
        run(category_bulk.move_all(db, ADMIN, 90, 11))
    assert db.cat_of(4) == 90 and db.cat_of(5) == 90   # nothing moved
    assert run(category_bulk.move_all(db, ADMIN, 90, 91))["moved"] == 2
    assert sorted(e["merchant_id"] for e in log) == [1, 2]   # one log entry per shop


def test_hidden_or_unknown_target_and_same_category(log):
    db = FakeDB()
    with pytest.raises(NotFoundError):
        run(category_bulk.move_all(db, SHOP_A, 10, 12))
    with pytest.raises(NotFoundError):
        run(category_bulk.move_all(db, SHOP_A, 10, 999))
    with pytest.raises(BadRequestError):
        run(category_bulk.move_all(db, SHOP_A, 10, 10))


# ── Delete with move ────────────────────────────────────────────

def test_deleting_a_category_with_products_asks_where_they_go(log):
    db = FakeDB()
    with pytest.raises(ConflictError, match="2 product"):
        run(category_bulk.delete_with_move(db, SHOP_A, 10, None))
    assert next(c for c in db.tables["categories"] if c["id"] == 10)["is_active"] is True


def test_delete_and_move(log):
    db = FakeDB()
    out = run(category_bulk.delete_with_move(db, SHOP_A, 10, "11"))
    assert out == {"deleted": 10, "moved": 2}
    assert next(c for c in db.tables["categories"] if c["id"] == 10)["is_active"] is False
    assert db.cat_of(1) == 11
    assert [e["action"] for e in log] == ["category.products_moved", "category.deleted"]


def test_delete_and_leave_products_without_category(log):
    db = FakeDB()
    run(category_bulk.delete_with_move(db, SHOP_A, 10, "none"))
    assert db.cat_of(1) is None and db.cat_of(2) is None


def test_empty_category_deletes_without_asking(log):
    db = FakeDB()
    db.tables["products"] = [p for p in db.tables["products"] if p["category_id"] != 11]
    assert run(category_bulk.delete_with_move(db, SHOP_A, 11, None)) == {"deleted": 11, "moved": 0}


def test_a_shop_cannot_delete_a_platform_category(log):
    with pytest.raises(ForbiddenError):
        run(category_bulk.delete_with_move(FakeDB(), SHOP_A, 90, "none"))


def test_bad_move_to_value(log):
    with pytest.raises(BadRequestError):
        run(category_bulk.delete_with_move(FakeDB(), SHOP_A, 10, "toners"))


# ── Set the category of selected products ───────────────────────

def test_set_category_for_selected_products(log):
    db = FakeDB()
    out = run(category_bulk.set_category(db, SHOP_A, [1, 3, 3], 11))
    assert out == {"changed": 1, "unchanged": 1, "to": "Toners"}   # 3 was already a toner
    assert db.cat_of(1) == 11
    assert log[0]["action"] == "product.category_changed" and log[0]["new"]["products"] == 1


def test_set_category_refuses_another_shops_products(log):
    db = FakeDB()
    with pytest.raises(NotFoundError):
        run(category_bulk.set_category(db, SHOP_A, [1, 6], 11))
    assert db.cat_of(1) == 10   # all or nothing


def test_set_category_into_a_platform_category_and_back_to_none(log):
    db = FakeDB()
    run(category_bulk.set_category(db, SHOP_B, [6], 91))
    assert db.cat_of(6) == 91
    run(category_bulk.set_category(db, SHOP_B, [6], None))
    assert db.cat_of(6) is None


def test_platform_admin_cannot_put_a_product_in_another_shops_category(log):
    with pytest.raises(BadRequestError):
        run(category_bulk.set_category(FakeDB(), ADMIN, [6], 10))


def test_limits(log):
    with pytest.raises(BadRequestError):
        run(category_bulk.set_category(FakeDB(), SHOP_A, [], 11))
    with pytest.raises(BadRequestError):
        run(category_bulk.set_category(FakeDB(), SHOP_A, list(range(category_bulk.MAX_BULK + 1)), 11))


# ── Permissions and log groups ──────────────────────────────────

def test_permissions():
    assert required_permission("DELETE", "/api/categories/{category_id}") == Perm.PRODUCTS_DELETE
    assert required_permission("POST", "/api/categories/{category_id}/move-products") is None   # editing products
    assert required_permission("POST", "/api/products/bulk/category") is None
    assert {"category.products_moved", "category.deleted", "product.category_changed"} <= audit.ACTIONS
