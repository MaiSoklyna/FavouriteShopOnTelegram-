"""A small in-memory database for the shop-category tests.

It speaks just enough of the query builder (eq / neq / gte / lte / ilike / order /
select / select_one / insert / update) for the merchant and shop-category routes,
so the tests exercise the real route code, not a mock of it.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from app.db.client import SupabaseClient

CATEGORIES = [
    {"id": 1, "name": "Food & Beverage", "sort_order": 1},
    {"id": 2, "name": "Fashion", "sort_order": 2},
    {"id": 3, "name": "Electronics", "sort_order": 3},  # nobody sells here yet
]
SUBCATEGORIES = [
    {"id": 1, "category_id": 1, "name": "Cake Shop", "sort_order": 1},
    {"id": 2, "category_id": 1, "name": "Coffee Shop", "sort_order": 2},
    {"id": 3, "category_id": 2, "name": "Clothing", "sort_order": 1},
    {"id": 4, "category_id": 3, "name": "Accessories", "sort_order": 1},  # empty
]


def shop(id, name, category=None, sub=None, status="active", **extra):
    return {
        "id": id, "name": name, "slug": name.lower().replace(" ", "-"), "status": status,
        "email": f"{id}@private.example", "owner_name": "Private Owner",
        "shop_category_id": category, "shop_subcategory_id": sub,
        "latitude": 11.5704 + id * 0.001, "longitude": 104.8996, "delivery_radius_km": 5,
        "created_at": f"2026-11-0{id}T00:00:00+00:00", **extra,
    }


def default_merchants():
    return [
        shop(1, "Cake Corner", 1, 1),
        shop(2, "Coffee Spot", 1, 2),
        shop(3, "Boutique", 2, 3),
        shop(4, "Plain Shop"),                    # not categorised yet
        shop(5, "Closed Cakes", 1, 1, status="suspended"),
    ]


class FakeQuery:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.order_by = db, table, [], None

    def _add(self, col, op, val):
        self.filters.append((col, op, val))
        return self

    def eq(self, col, val): return self._add(col, "eq", val)
    def neq(self, col, val): return self._add(col, "neq", val)
    def gte(self, col, val): return self._add(col, "gte", val)
    def lte(self, col, val): return self._add(col, "lte", val)
    def ilike(self, col, pattern): return self._add(col, "ilike", pattern.strip("*").lower())

    def order(self, col, *, desc=False, nulls_last=False):
        self.order_by = (col, desc)
        return self

    def _match(self, row):
        for col, op, val in self.filters:
            have = row.get(col)
            if op == "eq" and have != val: return False
            if op == "neq" and have == val: return False
            if op == "gte" and (have is None or have < val): return False
            if op == "lte" and (have is None or have > val): return False
            if op == "ilike" and val not in str(have or "").lower(): return False
        return True

    def _rows(self):
        rows = [r for r in self.db.tables.get(self.table, []) if self._match(r)]
        if self.order_by:
            col, desc = self.order_by
            rows = sorted(rows, key=lambda r: (r.get(col) is None, r.get(col)), reverse=desc)
        return rows

    async def select(self, *_):
        return [dict(r) for r in self._rows()]

    async def select_one(self, *_):
        rows = self._rows()
        return dict(rows[0]) if rows else None

    async def update(self, data):
        rows = self._rows()
        for r in rows:
            r.update(data)
        return [dict(r) for r in rows]

    async def insert(self, data):
        rows = self.db.tables.setdefault(self.table, [])
        row = {"id": max((r["id"] for r in rows), default=0) + 1, **data}
        rows.append(row)
        return [dict(row)]


class FakeDb:
    def __init__(self, merchants=None):
        self.tables = {
            "shop_categories": [dict(c) for c in CATEGORIES],
            "shop_subcategories": [dict(s) for s in SUBCATEGORIES],
            "merchants": merchants if merchants is not None else default_merchants(),
            "products": [],
            "orders": [],
        }

    def from_(self, table):
        return FakeQuery(self, table)

    def merchant(self, merchant_id):
        return next(m for m in self.tables["merchants"] if m["id"] == merchant_id)


def install(monkeypatch, db: FakeDb) -> FakeDb:
    """Route every `SupabaseClient.service_role()` in the app to `db`."""
    @asynccontextmanager
    async def service_role():
        yield db

    monkeypatch.setattr(SupabaseClient, "service_role", staticmethod(service_role))
    return db
