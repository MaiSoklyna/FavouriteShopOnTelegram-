"""Stock is taken and returned atomically, and an order can never keep stock it does not own.

The bug: place_order never checked stock, created the order first, then read each stock figure,
subtracted in Python and wrote it back. Two buyers of the last unit both succeeded, concurrent
updates overwrote each other, a cancelled order's stock came back by the same racy
read-modify-write (and not at all when an admin cancelled it).

The database (migration 026) now does reserve/release in one transaction. These tests fake that
database faithfully: `rpc` calls are serialised and roll back as a whole on failure, exactly what a
Postgres function call guarantees, and every call yields to the event loop so requests interleave.
The SQL itself is checked by supabase/tests/026_atomic_stock_test.sql and the live concurrency run.
"""

import asyncio
import copy
import logging
from contextlib import asynccontextmanager
from decimal import Decimal

import httpx
import pytest

from app.core.constants import Role
from app.core.exceptions import BadRequestError, ConflictError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.routes import orders as route
from app.services import inventory

USER = TokenClaims(sub="1", role=Role.USER, telegram_id=111)
ADMIN = TokenClaims(sub="1", role=Role.SUPER_ADMIN)
DB_USER = {"id": 1, "telegram_id": 111, "first_name": "Mai"}


def pg_error(message, code="P0001", status=400):
    req = httpx.Request("POST", "http://db/rpc/x")
    return httpx.HTTPStatusError("error", request=req, response=httpx.Response(status, json={"code": code, "message": message}, request=req))


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters = db, table, []

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def _rows(self):
        return [r for r in self.db.tables.setdefault(self.table, []) if all(r.get(c) == v for c, v in self.filters)]

    async def select(self, *_):
        await asyncio.sleep(0)
        return [dict(r) for r in self._rows()]

    async def select_one(self, *_):
        rows = await self.select()
        return rows[0] if rows else None

    async def insert(self, data):
        await asyncio.sleep(0)
        if self.table == "orders" and self.db.fail_order_insert:
            raise RuntimeError("database down")
        if self.table == "order_items" and self.db.fail_order_items:
            raise RuntimeError("database down")
        rows = self.db.tables.setdefault(self.table, [])
        row = {"id": len(rows) + 1, **data}
        rows.append(row)
        self.db.events.append(f"insert:{self.table}")
        return [dict(row)]

    async def update(self, data):
        await asyncio.sleep(0)
        rows = self._rows()  # match and write in one step, like a single UPDATE ... WHERE
        for r in rows:
            r.update(data)
        return [dict(r) for r in rows]

    async def delete(self):
        await asyncio.sleep(0)
        doomed = self._rows()
        self.db.tables[self.table] = [r for r in self.db.tables[self.table] if r not in doomed]


class StockDb:
    def __init__(self, products, options=(), *, function_exists=True):
        self.tables = {
            "products": [dict(p) for p in products],
            "product_variant_options": [dict(o) for o in options],
            "orders": [], "order_items": [],
            "cart": [{"id": 7}], "cart_items": [{"id": 1, "cart_id": 7}],
            "merchants": [{"id": 3, "name": "Shop", "telegram_group_id": None}],
        }
        self.events: list[str] = []
        self.function_exists = function_exists
        self.fail_order_insert = False
        self.fail_order_items = False
        self._lock = asyncio.Lock()

    def from_(self, table):
        return Query(self, table)

    def row(self, table, row_id):
        return next((r for r in self.tables[table] if r["id"] == row_id), None)

    def stock(self, product_id):
        return self.row("products", product_id)["stock"]

    def option_stock(self, option_id):
        return self.row("product_variant_options", option_id)["stock_adjust"]

    async def rpc(self, name, params):
        self.events.append(f"rpc:{name}")
        if not self.function_exists:
            raise pg_error("Could not find the function public.%s" % name, "PGRST202", 404)
        await asyncio.sleep(0)
        async with self._lock:           # a function call is one transaction
            await asyncio.sleep(0)
            snapshot = copy.deepcopy((self.tables["products"], self.tables["product_variant_options"]))
            try:
                self._apply(name, params["p_items"])
            except httpx.HTTPStatusError:  # rolled back as a whole
                self.tables["products"], self.tables["product_variant_options"] = snapshot
                raise

    def _apply(self, name, lines):
        for line in sorted(lines, key=lambda l: l["product_id"]):
            qty, product = line["quantity"], self.row("products", line["product_id"])
            if qty < 1:
                raise pg_error("Invalid stock request")
            if name == "release_stock":
                product["stock"] += qty
                for oid in line["option_ids"]:
                    self.row("product_variant_options", oid)["stock_adjust"] += qty
            elif not line["option_ids"]:
                if product is None or product["stock"] < qty:
                    raise pg_error(f'"{product["name"] if product else "An item"}" just sold out or has fewer left than you asked for')
                product["stock"] -= qty
            else:
                product["stock"] = max(product["stock"] - qty, 0)
                for oid in sorted(line["option_ids"]):
                    opt = self.row("product_variant_options", oid)
                    if (opt["stock_adjust"] or 0) < qty:
                        raise pg_error(f'"{product["name"]}" ({opt["label"]}) just sold out or has fewer left than you asked for')
                    opt["stock_adjust"] -= qty


def plain(stock, pid=1, name="Mug"):
    return {"id": pid, "name": name, "stock": stock, "sku": None, "base_price": 5.0}


def item(pid=1, qty=1, options=()):
    return {"product_id": pid, "quantity": qty, "unit_price": 5.0,
            "selected_variants": [{"option_id": o, "label": f"opt{o}", "group_name": "Color", "variant_id": 1} for o in options]}


def run(coro):
    return asyncio.run(coro)


# ── the stock service ──────────────────────────────────────────────

def test_stock_lines_pick_up_option_ids():
    lines = inventory.stock_lines([
        item(1, 2, options=(10, 11)),
        {"product_id": 2, "quantity": 1, "selected_variants": None},
        {"product_id": 3, "quantity": 1, "selected_variants": ["junk", {"label": "no id"}]},
    ])
    assert lines == [{"product_id": 1, "quantity": 2, "option_ids": [10, 11]},
                     {"product_id": 2, "quantity": 1, "option_ids": []},
                     {"product_id": 3, "quantity": 1, "option_ids": []}]


def test_reserve_takes_stock_and_release_returns_it():
    db = StockDb([plain(5)])
    run(inventory.reserve_stock(db, [item(1, 2)]))
    assert db.stock(1) == 3
    run(inventory.release_stock(db, [item(1, 2)]))
    assert db.stock(1) == 5


def test_sold_out_item_is_refused_by_name_and_takes_nothing():
    db = StockDb([plain(1, name="Mug")])
    with pytest.raises(BadRequestError) as err:
        run(inventory.reserve_stock(db, [item(1, 2)]))
    assert "Mug" in str(err.value.detail if hasattr(err.value, "detail") else err.value)
    assert db.stock(1) == 1


def test_a_basket_is_all_or_nothing():
    db = StockDb([plain(5, 1, "Mug"), plain(0, 2, "Cup")])
    with pytest.raises(BadRequestError):
        run(inventory.reserve_stock(db, [item(1, 2), item(2, 1)]))
    assert db.stock(1) == 5  # the line that would have fit was rolled back too


def test_concurrent_buyers_of_the_last_units():
    db = StockDb([plain(3)])

    async def go():
        return await asyncio.gather(*(inventory.reserve_stock(db, [item(1, 1)]) for _ in range(10)), return_exceptions=True)

    results = run(go())
    assert sum(r is None for r in results) == 3
    assert sum(isinstance(r, BadRequestError) for r in results) == 7
    assert db.stock(1) == 0  # never negative, never lost


def test_variant_stock_is_limited_by_the_option_not_product_stock():
    db = StockDb([{**plain(0), "id": 1}], options=[{"id": 10, "label": "Red", "stock_adjust": 2}])

    async def go():
        return await asyncio.gather(*(inventory.reserve_stock(db, [item(1, 1, options=(10,))]) for _ in range(6)), return_exceptions=True)

    results = run(go())
    assert sum(r is None for r in results) == 2  # product stock 0 is not a limit, option stock 2 is
    assert db.option_stock(10) == 0
    assert db.stock(1) == 0  # clamped, never negative


def test_concurrent_releases_add_up_exactly():
    db = StockDb([plain(0)], options=[{"id": 10, "label": "Red", "stock_adjust": 0}])

    async def go():
        await asyncio.gather(*(inventory.release_stock(db, [item(1, 1, options=(10,))]) for _ in range(8)))

    run(go())
    assert db.stock(1) == 8 and db.option_stock(10) == 8  # read-modify-write would have lost some


def test_before_migration_026_orders_still_work_with_a_loud_warning(caplog):
    db = StockDb([plain(5)], function_exists=False)
    with caplog.at_level(logging.ERROR):
        run(inventory.reserve_stock(db, [item(1, 2)]))
        run(inventory.release_stock(db, [item(1, 1)]))
    assert db.stock(1) == 4  # 5 - 2 + 1, the old behaviour
    assert "Migration 026" in caplog.text


def test_unexpected_database_error_is_not_swallowed_when_reserving():
    class Broken(StockDb):
        async def rpc(self, name, params):
            raise pg_error("boom", "XX000", 500)

    with pytest.raises(httpx.HTTPStatusError):
        run(inventory.reserve_stock(Broken([plain(5)]), [item(1, 1)]))


def test_release_never_raises():
    class Broken(StockDb):
        async def rpc(self, name, params):
            raise pg_error("boom", "XX000", 500)

    run(inventory.release_stock(Broken([plain(5)]), [item(1, 1)]))  # a cancel must not fail on this


# ── the order routes ───────────────────────────────────────────────

@pytest.fixture
def shop(monkeypatch):
    """place_order / cancel / admin status wired to a StockDb, with every outside effect stubbed."""
    import bot.notifications as notifications
    import app.services.loyalty as loyalty

    state = {"db": None, "items": [item(1, 1)]}

    @asynccontextmanager
    async def service_role():
        yield state["db"]

    async def noop(*a, **k):
        return None

    async def priced(db, user_id, merchant_id, promo_code, delivery_type="delivery", dest=None):
        total = Decimal("10.00")
        return {"cart": {"id": 7}, "items": state["items"], "promo": None, "promo_error": None, "promo_auto": False,
                "subtotal": total, "discount": Decimal("0"), "delivery_fee": Decimal("0"), "total": total,
                "distance_km": None, "discount_funded_by": None, "shop_open": True, "min_order": None}

    async def db_user(db, user):
        return dict(DB_USER)

    monkeypatch.setattr(SupabaseClient, "service_role", staticmethod(service_role))
    monkeypatch.setattr(route, "_get_db_user", db_user)
    monkeypatch.setattr(route, "_price_cart", priced)
    monkeypatch.setattr(route.settlement, "on_order_status_changed", noop)
    monkeypatch.setattr(route.settlement, "record_order_earning", noop)
    # Never message anyone for real from a test
    monkeypatch.setattr(notifications, "send_order_placed_to_customer", noop)
    monkeypatch.setattr(notifications, "send_order_placed_to_merchant_group", noop)
    monkeypatch.setattr(loyalty, "earn_points", noop)
    return state


BODY = {"merchant_id": 3, "delivery_address": "Pickup at shop", "delivery_type": "pickup", "payment_method": "cod"}


def place(shop_state):
    return route.place_order(dict(BODY), user=USER)


def test_order_takes_stock_before_the_order_exists(shop):
    shop["db"] = db = StockDb([plain(5)])
    shop["items"] = [item(1, 2)]
    assert run(place(shop))["success"]
    assert db.stock(1) == 3
    assert db.events.index("rpc:reserve_stock") < db.events.index("insert:orders") < db.events.index("insert:order_items")
    assert len(db.tables["orders"]) == 1 and db.tables["cart_items"] == []


def test_sold_out_order_is_refused_and_nothing_is_created(shop):
    shop["db"] = db = StockDb([plain(1)])
    shop["items"] = [item(1, 2)]
    with pytest.raises(BadRequestError):
        run(place(shop))
    assert db.tables["orders"] == [] and db.tables["order_items"] == []
    assert db.tables["cart_items"] != []  # the customer keeps their cart
    assert db.stock(1) == 1


def test_two_customers_race_for_the_last_unit(shop):
    shop["db"] = db = StockDb([plain(1)])
    shop["items"] = [item(1, 1)]

    async def go():
        return await asyncio.gather(place(shop), place(shop), return_exceptions=True)

    results = run(go())
    assert sum(isinstance(r, dict) for r in results) == 1
    assert sum(isinstance(r, BadRequestError) for r in results) == 1
    assert len(db.tables["orders"]) == 1
    assert db.stock(1) == 0  # sold once, not twice, not negative


def test_failure_creating_the_order_gives_the_stock_back(shop):
    shop["db"] = db = StockDb([plain(5)])
    shop["items"] = [item(1, 2)]
    db.fail_order_insert = True
    with pytest.raises(RuntimeError):
        run(place(shop))
    assert db.stock(1) == 5 and db.tables["orders"] == []


def test_failure_after_the_order_row_cancels_it_and_gives_the_stock_back(shop):
    shop["db"] = db = StockDb([plain(5)])
    shop["items"] = [item(1, 2)]
    db.fail_order_items = True
    with pytest.raises(RuntimeError):
        run(place(shop))
    assert db.stock(1) == 5
    assert [o["status"] for o in db.tables["orders"]] == ["cancelled"]  # no live order without items


def test_order_still_works_before_migration_026(shop, caplog):
    shop["db"] = db = StockDb([plain(5)], function_exists=False)
    shop["items"] = [item(1, 2)]
    with caplog.at_level(logging.ERROR):
        assert run(place(shop))["success"]
    assert db.stock(1) == 3 and "Migration 026" in caplog.text


def pending_order(db, status="pending", qty=2, options=()):
    db.tables["orders"].append({"id": 5, "user_id": 1, "status": status, "merchant_id": 3})
    db.tables["order_items"].append({"id": 1, "order_id": 5, "product_id": 1, "quantity": qty,
                                     "selected_variants": item(1, qty, options)["selected_variants"]})


def test_customer_cancel_gives_stock_back_once(shop):
    shop["db"] = db = StockDb([plain(3)], options=[{"id": 10, "label": "Red", "stock_adjust": 1}])
    pending_order(db, qty=2, options=(10,))
    assert run(route.cancel_order(5, user=USER))["success"]
    assert db.stock(1) == 5 and db.option_stock(10) == 3
    assert db.row("orders", 5)["status"] == "cancelled"


def test_double_tap_cancel_does_not_double_the_stock(shop):
    shop["db"] = db = StockDb([plain(3)])
    pending_order(db, qty=2)

    async def go():
        return await asyncio.gather(route.cancel_order(5, user=USER), route.cancel_order(5, user=USER), return_exceptions=True)

    results = run(go())
    assert sum(isinstance(r, dict) for r in results) == 1
    assert sum(isinstance(r, BadRequestError) for r in results) == 1
    assert db.stock(1) == 5  # +2 once, not +4


def test_admin_cancel_returns_stock(shop):
    """This used to leak: only the customer's cancel button restored stock."""
    shop["db"] = db = StockDb([plain(3)])
    pending_order(db, status="confirmed", qty=2)
    run(route.update_order_status(5, {"status": "cancelled"}, user=ADMIN))
    assert db.stock(1) == 5 and db.row("orders", 5)["status"] == "cancelled"


def test_other_status_changes_leave_stock_alone(shop):
    shop["db"] = db = StockDb([plain(3)])
    pending_order(db, status="confirmed", qty=2)
    run(route.update_order_status(5, {"status": "processing"}, user=ADMIN))
    assert db.stock(1) == 3 and "rpc:release_stock" not in db.events


def test_two_admins_cancelling_at_once_release_once(shop):
    shop["db"] = db = StockDb([plain(3)])
    pending_order(db, status="confirmed", qty=2)

    async def go():
        return await asyncio.gather(
            route.update_order_status(5, {"status": "cancelled"}, user=ADMIN),
            route.update_order_status(5, {"status": "cancelled"}, user=ADMIN),
            return_exceptions=True)

    results = run(go())
    assert sum(isinstance(r, ConflictError) for r in results) == 1
    assert db.stock(1) == 5  # +2 once


def test_placing_an_order_notifies_the_customer_and_the_shop(shop):
    """A cash order is a receipt for the customer and a new-order alert for the shop, in the app."""
    shop["db"] = db = StockDb([plain(5)])
    shop["items"] = [item(1, 1)]
    run(place(shop))
    sent = db.tables["notifications"]
    assert [(n.get("user_id"), n.get("merchant_id"), n["title"]) for n in sent] == [(1, None, "Order placed"), (None, 3, "New order")]
    assert sent[0]["link"].startswith("/shop/order/")
