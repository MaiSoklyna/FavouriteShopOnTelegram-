"""In-app notifications: who gets told what, exactly once, and who may read or send them (database faked).

The fake table keeps the two properties that matter: a (recipient, dedupe_key) pair is unique, and with
`migrated=False` it rejects the new columns the way the real table does before migration 027.
"""

import asyncio
from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.constants import Role
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims, mint_jwt
from app.db.client import SupabaseClient
from app.main import app
from app.routes import notifications as route
from app.services import notify

LEGACY_COLS = {"id", "user_id", "type", "title", "body", "ref_id", "is_read", "sent_at"}


def pg_error(code, message="error", status=400):
    req = httpx.Request("POST", "http://db/notifications")
    return httpx.HTTPStatusError("e", request=req, response=httpx.Response(status, json={"code": code, "message": message}, request=req))


class Q:
    def __init__(self, db, table):
        self.db, self.table, self.f, self.order_by, self.max = db, table, [], None, None

    def _add(self, op, col, val):
        self.f.append((op, col, val)); return self

    def eq(self, col, val):
        if not self.db.migrated and self.table == "notifications" and col in {"merchant_id", "kind", "link", "dedupe_key"}:
            raise pg_error("42703", f"column notifications.{col} does not exist")
        return self._add("eq", col, val)

    def lt(self, col, val): return self._add("lt", col, val)
    def in_(self, col, vals): return self._add("in", col, vals)
    def order(self, col, *, desc=False, nulls_last=False): self.order_by = (col, desc); return self
    def limit(self, n): self.max = n; return self

    def _ok(self, r):
        for op, col, val in self.f:
            v = r.get(col)
            if op == "eq" and v != val: return False
            if op == "lt" and not (v is not None and v < val): return False
            if op == "in" and v not in val: return False
        return True

    def _rows(self):
        rows = [r for r in self.db.tables.setdefault(self.table, []) if self._ok(r)]
        if self.order_by:
            col, desc = self.order_by
            rows = sorted(rows, key=lambda r: r.get(col) or 0, reverse=desc)
        return rows[: self.max] if self.max else rows

    async def select(self, *_): return [dict(r) for r in self._rows()]

    async def select_one(self, *_):
        rows = self._rows()
        return dict(rows[0]) if rows else None

    async def count(self): return len(self._rows())

    async def insert(self, data):
        if self.db.break_inserts:
            raise RuntimeError("database down")
        out = []
        for row in (data if isinstance(data, list) else [data]):
            if self.table == "notifications":
                if not self.db.migrated and set(row) - LEGACY_COLS:
                    raise pg_error("PGRST204", "Could not find a column in the schema cache")
                key = row.get("dedupe_key")
                if key and any(r.get("dedupe_key") == key and r.get("user_id") == row.get("user_id")
                               and r.get("merchant_id") == row.get("merchant_id") for r in self.db.tables["notifications"]):
                    raise pg_error("23505", "duplicate key value violates unique constraint", 409)
                row = {"is_read": False, "sent_at": f"2026-11-22T10:{len(self.db.tables['notifications']):02d}:00Z", **row}
            self.db.next_id += 1
            new = {"id": self.db.next_id, **row}
            self.db.tables.setdefault(self.table, []).append(new)
            out.append(dict(new))
        return out

    async def update(self, data):
        rows = self._rows()
        for r in rows: r.update(data)
        return [dict(r) for r in rows]

    async def delete(self):
        gone = self._rows()
        self.db.tables[self.table] = [r for r in self.db.tables[self.table] if r not in gone]


class Db:
    def __init__(self, migrated=True):
        self.migrated, self.break_inserts, self.next_id = migrated, False, 100
        self.tables = {
            "notifications": [],
            "users": [{"id": 1, "telegram_id": 111, "first_name": "Mai"}, {"id": 2, "telegram_id": 222, "first_name": "Sok"}],
            "merchants": [{"id": 3, "name": "Bloom"}, {"id": 4, "name": "Cakes"}],
            "orders": [
                {"id": 35, "user_id": 1, "merchant_id": 3, "order_code": "FS-35", "delivery_type": "delivery", "total": 21.6, "payment_method": "cod"},
                {"id": 36, "user_id": 1, "merchant_id": 3, "order_code": "FS-36", "delivery_type": "pickup", "total": 6.0, "payment_method": "stripe"},
            ],
        }

    def from_(self, table): return Q(self, table)

    def mine(self, **match):
        return [r for r in self.tables["notifications"] if all(r.get(k) == v for k, v in match.items())]


@pytest.fixture
def db(monkeypatch):
    database = Db()
    pushes = []

    @asynccontextmanager
    async def service_role():
        yield database

    async def push(db_, order, title, body):
        pushes.append((order["id"], title))

    monkeypatch.setattr(SupabaseClient, "service_role", staticmethod(service_role))
    monkeypatch.setattr(notify, "_push", push)  # never message anyone for real from a test
    database.pushes = pushes
    return database


def run(coro):
    return asyncio.run(coro)


# ── the service ────────────────────────────────────────────────────

def test_creates_a_notification_with_kind_link_and_dedupe(db):
    assert run(notify.notify_user(db, 1, "order_status", "Order confirmed", "ok", link="/shop/order/35", ref_id=35, dedupe_key="k1"))
    row = db.mine(user_id=1)[0]
    assert (row["kind"], row["type"], row["link"], row["ref_id"], row["is_read"]) == ("order_status", "order_update", "/shop/order/35", 35, False)


def test_same_event_is_announced_once(db):
    assert run(notify.notify_user(db, 1, "order_status", "t", "b", dedupe_key="order:35:status:confirmed")) is True
    assert run(notify.notify_user(db, 1, "order_status", "t", "b", dedupe_key="order:35:status:confirmed")) is False
    assert len(db.mine(user_id=1)) == 1
    assert run(notify.notify_user(db, 2, "order_status", "t", "b", dedupe_key="order:35:status:confirmed")) is True  # another recipient


def test_without_a_key_every_call_is_a_new_notification(db):
    run(notify.notify_user(db, 1, "promo", "Sale", "50%"))
    run(notify.notify_user(db, 1, "promo", "Sale", "50%"))
    assert len(db.mine(user_id=1)) == 2


def test_a_failing_database_never_raises(db):
    db.break_inserts = True
    assert run(notify.notify_user(db, 1, "system", "t", "b")) is False
    run(notify.order_status_changed(db, 35, "delivered"))  # must not blow up the status change
    run(notify.order_placed(db, 35))


def test_before_migration_customers_still_get_notifications(db):
    db.migrated = False
    assert run(notify.notify_user(db, 1, "order_status", "Order confirmed", "ok", link="/x", ref_id=35, dedupe_key="k"))
    row = db.mine(user_id=1)[0]
    assert (row["type"], row["ref_id"], "kind" not in row, "link" not in row) == ("order_update", 35, True, True)


def test_before_migration_the_shop_inbox_is_skipped_quietly(db):
    db.migrated = False
    assert run(notify.notify_merchant(db, 3, "new_order", "New order", "x")) is False
    assert db.tables["notifications"] == []


def test_status_wording_follows_delivery_or_pickup(db):
    assert notify.status_copy("shipped", pickup=False, shop="Bloom", code="FS-1")[0] == "Out for delivery"
    assert notify.status_copy("shipped", pickup=True, shop="Bloom", code="FS-1")[0] == "Ready for pickup"
    assert notify.status_copy("delivered", pickup=True, shop="Bloom", code="FS-1")[0] == "Order picked up"
    assert notify.status_copy("pending", pickup=False, shop="Bloom", code="FS-1") is None


def test_status_change_notifies_the_customer_with_a_link_to_the_order(db):
    run(notify.order_status_changed(db, 35, "confirmed"))
    row = db.mine(user_id=1)[0]
    assert (row["title"], row["link"], row["ref_id"]) == ("Order confirmed", "/shop/order/35", 35)
    assert "Bloom" in row["body"] and "FS-35" in row["body"]
    assert db.mine(merchant_id=3) == []          # a confirmation is not news for the shop


def test_repeating_a_status_change_does_not_repeat_the_notification_or_the_push(db):
    run(notify.order_status_changed(db, 35, "shipped"))
    run(notify.order_status_changed(db, 35, "shipped"))
    assert len(db.mine(user_id=1)) == 1
    assert db.pushes == [(35, "Out for delivery")]


def test_only_shipped_delivered_and_cancelled_go_to_telegram(db):
    for status in ("confirmed", "processing"):
        run(notify.order_status_changed(db, 35, status))
    assert db.pushes == []
    for status in ("shipped", "delivered", "cancelled"):
        run(notify.order_status_changed(db, 35, status))
    assert [t for _, t in db.pushes] == ["Out for delivery", "Order delivered", "Order cancelled"]


def test_delivery_asks_the_customer_how_it_went_once(db):
    run(notify.order_status_changed(db, 35, "delivered"))
    run(notify.order_status_changed(db, 35, "delivered"))
    kinds = sorted(r["kind"] for r in db.mine(user_id=1))
    assert kinds == ["order_status", "review_request"]
    review = db.mine(user_id=1, kind="review_request")[0]
    assert review["link"] == "/shop/order/35" and "Bloom" in review["body"]


def test_customer_cancelling_tells_the_shop_not_the_customer(db):
    run(notify.order_status_changed(db, 35, "cancelled", by_customer=True))
    assert db.mine(user_id=1) == []
    shop = db.mine(merchant_id=3)[0]
    assert (shop["kind"], shop["title"], shop["link"]) == ("order_cancelled", "Order cancelled", "/orders")
    assert "by the customer" in shop["body"]
    assert db.pushes == []


def test_shop_cancelling_tells_both(db):
    run(notify.order_status_changed(db, 35, "cancelled"))
    assert len(db.mine(user_id=1)) == 1 and len(db.mine(merchant_id=3)) == 1


def test_cash_order_placed_alerts_the_shop_immediately(db):
    run(notify.order_placed(db, 35))
    assert db.mine(user_id=1)[0]["title"] == "Order placed"
    assert db.mine(merchant_id=3)[0]["kind"] == "new_order"


def test_online_order_alerts_the_shop_only_when_paid(db):
    run(notify.order_placed(db, 36))
    assert db.mine(merchant_id=3) == []
    run(notify.order_paid(db, 36))
    run(notify.order_paid(db, 36))  # a second webhook
    assert [r["title"] for r in db.mine(user_id=1)] == ["Order placed", "Payment received"]
    assert len(db.mine(merchant_id=3)) == 1


def test_unknown_order_is_ignored(db):
    run(notify.order_status_changed(db, 999, "delivered"))
    assert db.tables["notifications"] == []


def test_payout_events_reach_the_shop_once(db):
    payout = {"id": 6, "merchant_id": 3, "amount": 34.2, "reference": "DEMO-1"}
    run(notify.payout_event(db, payout, "paid"))
    run(notify.payout_event(db, payout, "paid"))
    row = db.mine(merchant_id=3)[0]
    assert row["title"] == "Payout sent" and "$34.20" in row["body"] and "DEMO-1" in row["body"]
    assert len(db.mine(merchant_id=3)) == 1
    run(notify.payout_event(db, None, "paid"))  # nothing to announce


# ── the customer feed routes ───────────────────────────────────────

CUSTOMER = TokenClaims(sub="1", role=Role.USER, telegram_id=111)
OTHER = TokenClaims(sub="2", role=Role.USER, telegram_id=222)
SHOP3 = TokenClaims(sub="9", role=Role.MERCHANT_ADMIN, merchant_id=3)
SHOP4 = TokenClaims(sub="8", role=Role.MERCHANT_ADMIN, merchant_id=4)


def seed(db):
    for i in range(1, 8):
        run(notify.notify_user(db, 1, "order_status", f"n{i}", "b", dedupe_key=f"k{i}"))
    run(notify.notify_user(db, 1, "promo", "sale", "b"))
    run(notify.notify_user(db, 2, "order_status", "someone else", "b", dedupe_key="x"))


def test_feed_is_only_mine_newest_first(db):
    seed(db)
    rows = run(route.list_my_notifications(user=CUSTOMER))
    assert len(rows) == 8 and all(r["user_id"] == 1 for r in rows)
    assert [r["id"] for r in rows] == sorted((r["id"] for r in rows), reverse=True)


def test_feed_pages_with_a_cursor(db):
    seed(db)
    first = run(route.list_my_notifications(limit=3, user=CUSTOMER))
    second = run(route.list_my_notifications(limit=3, before=first[-1]["id"], user=CUSTOMER))
    assert len(first) == 3 and len(second) == 3 and not {r["id"] for r in first} & {r["id"] for r in second}
    assert max(r["id"] for r in second) < min(r["id"] for r in first)


def test_feed_filters_by_tab_and_unread(db):
    seed(db)
    assert {r["type"] for r in run(route.list_my_notifications(group="promos", user=CUSTOMER))} == {"promo"}
    assert len(run(route.list_my_notifications(group="orders", user=CUSTOMER))) == 7
    run(route.mark_as_read(run(route.list_my_notifications(user=CUSTOMER))[0]["id"], user=CUSTOMER))
    assert len(run(route.list_my_notifications(unread_only=True, user=CUSTOMER))) == 7
    with pytest.raises(BadRequestError):
        run(route.list_my_notifications(group="spam", user=CUSTOMER))


def test_page_size_is_capped(db):
    for i in range(60):
        run(notify.notify_user(db, 1, "promo", f"p{i}", "b"))
    assert len(run(route.list_my_notifications(limit=500, user=CUSTOMER))) == 50


def test_unread_count_is_mine_and_cheap(db):
    seed(db)
    assert run(route.my_unread_count(user=CUSTOMER)) == {"count": 8}
    assert run(route.my_unread_count(user=OTHER)) == {"count": 1}
    assert run(route.my_unread_count(user=TokenClaims(sub="9", role=Role.USER, telegram_id=999))) == {"count": 0}


def test_read_all_only_touches_my_notifications(db):
    seed(db)
    assert run(route.read_all_mine(user=CUSTOMER))["count"] == 8
    assert run(route.my_unread_count(user=CUSTOMER)) == {"count": 0}
    assert run(route.my_unread_count(user=OTHER)) == {"count": 1}


def test_cannot_mark_someone_elses_notification_read(db):
    seed(db)
    theirs = db.mine(user_id=2)[0]["id"]
    with pytest.raises(NotFoundError):
        run(route.mark_as_read(theirs, user=CUSTOMER))
    assert db.mine(user_id=2)[0]["is_read"] is False
    mine = db.mine(user_id=1)[0]["id"]
    run(route.mark_as_read(mine, user=CUSTOMER))
    assert db.mine(user_id=1)[0]["is_read"] is True


# ── the shop inbox ─────────────────────────────────────────────────

def test_shop_inbox_is_scoped_to_the_shop(db):
    run(notify.notify_merchant(db, 3, "new_order", "New order", "a", dedupe_key="a"))
    run(notify.notify_merchant(db, 4, "new_order", "New order", "b", dedupe_key="b"))
    assert [r["body"] for r in run(route.list_shop_notifications(user=SHOP3))] == ["a"]
    assert run(route.shop_unread_count(user=SHOP3)) == {"count": 1}
    theirs = db.mine(merchant_id=4)[0]["id"]
    with pytest.raises(NotFoundError):
        run(route.mark_shop_notification_read(theirs, user=SHOP3))
    assert run(route.read_all_shop(user=SHOP3))["count"] == 1
    assert run(route.shop_unread_count(user=SHOP4)) == {"count": 1}


def test_an_admin_without_a_shop_has_no_inbox(db):
    with pytest.raises(ForbiddenError):
        run(route.list_shop_notifications(user=TokenClaims(sub="1", role=Role.MERCHANT_ADMIN)))


# ── broadcast tool: super admin only ───────────────────────────────

def bearer(role, **kw):
    return {"Authorization": "Bearer " + mint_jwt(sub="1", role=role, **kw)}


def test_shops_cannot_use_the_broadcast_tool(db):
    client = TestClient(app)
    shop = bearer(Role.MERCHANT_ADMIN, merchant_id=3)
    assert client.get("/api/notifications/admin/list", headers=shop).status_code == 403
    assert client.post("/api/notifications/admin/send", headers=shop,
                       json={"user_ids": [1, 2], "title": "spam", "body": "x"}).status_code == 403
    assert client.delete("/api/notifications/admin/1", headers=shop).status_code == 403
    assert db.tables["notifications"] == []


def test_customers_cannot_use_the_broadcast_tool_or_the_shop_inbox(db):
    client = TestClient(app)
    cust = bearer(Role.USER, telegram_id=111)
    assert client.get("/api/notifications/admin/list", headers=cust).status_code == 403
    assert client.get("/api/notifications/merchant", headers=cust).status_code == 403


def test_super_admin_can_send_and_every_type_the_form_offers_works(db):
    client = TestClient(app)
    admin = bearer(Role.SUPER_ADMIN)
    for form_type, stored in (("promo", "promo"), ("order", "order_update"), ("system", "system"), ("loyalty", "system")):
        r = client.post("/api/notifications/admin/send", headers=admin,
                        json={"user_ids": [1, 2], "type": form_type, "title": "t", "body": "b"})
        assert r.status_code == 200 and r.json()["count"] == 2, form_type
        assert {n["type"] for n in db.tables["notifications"][-2:]} == {stored}  # the database enum has no 'order'/'loyalty'
    assert client.post("/api/notifications/admin/send", headers=admin, json={"title": "t", "body": "b"}).status_code == 400


def test_admin_list_shows_customer_mail_with_names_but_not_shop_inbox_rows(db):
    run(notify.notify_user(db, 1, "promo", "Sale", "b"))
    run(notify.notify_merchant(db, 3, "new_order", "New order", "x"))
    rows = TestClient(app).get("/api/notifications/admin/list", headers=bearer(Role.SUPER_ADMIN)).json()
    assert [(r["title"], r["user_name"]) for r in rows] == [("Sale", "Mai")]


def test_the_feed_requires_a_login(db):
    client = TestClient(app)
    assert client.get("/api/notifications").status_code == 401
    assert client.get("/api/notifications/unread-count").status_code == 401
    assert client.get("/api/notifications", headers=bearer(Role.USER, telegram_id=111)).status_code == 200


# ── the hooks: real routes announce what they do ───────────────────

ADMIN = TokenClaims(sub="1", role=Role.SUPER_ADMIN)


@pytest.fixture
def quiet(monkeypatch):
    """Routes with their other side effects (settlement ledger, Telegram, stock) stubbed out."""
    from app.routes import orders as orders_route, payments as payments_route, settlements as settlements_route
    import bot.notifications as bot_notifications

    async def noop(*a, **k):
        return None

    monkeypatch.setattr(orders_route.settlement, "on_order_status_changed", noop)
    monkeypatch.setattr(orders_route.inventory, "release_stock", noop)
    monkeypatch.setattr(bot_notifications, "send_payment_received_to_customer", noop)
    monkeypatch.setattr(bot_notifications, "send_order_placed_to_merchant_group", noop)

    async def db_user(db, user):
        return {"id": 1, "telegram_id": 111}

    monkeypatch.setattr(orders_route, "_get_db_user", db_user)
    return orders_route, payments_route, settlements_route


def test_shop_changing_an_order_status_notifies_the_customer(db, quiet):
    orders_route, *_ = quiet
    db.tables["orders"][0]["status"] = "pending"
    run(orders_route.update_order_status(35, {"status": "confirmed"}, user=ADMIN))
    assert [r["title"] for r in db.mine(user_id=1)] == ["Order confirmed"]


def test_shop_cancelling_notifies_customer_and_shop(db, quiet):
    orders_route, *_ = quiet
    db.tables["orders"][0]["status"] = "confirmed"
    run(orders_route.update_order_status(35, {"status": "cancelled"}, user=ADMIN))
    assert [r["title"] for r in db.mine(user_id=1)] == ["Order cancelled"]
    assert db.mine(merchant_id=3)[0]["kind"] == "order_cancelled"


def test_customer_cancelling_notifies_the_shop_only(db, quiet):
    orders_route, *_ = quiet
    db.tables["orders"][0]["status"] = "pending"
    run(orders_route.cancel_order(35, user=CUSTOMER))
    assert db.mine(user_id=1) == [] and len(db.mine(merchant_id=3)) == 1


def test_delivery_through_the_route_asks_for_a_review(db, quiet):
    orders_route, *_ = quiet
    db.tables["orders"][0]["status"] = "shipped"
    run(orders_route.update_order_status(35, {"status": "delivered"}, user=ADMIN))
    assert sorted(r["kind"] for r in db.mine(user_id=1)) == ["order_status", "review_request"]


def test_two_shops_delivering_at_once_do_not_double_notify(db, quiet):
    orders_route, *_ = quiet
    db.tables["orders"][0]["status"] = "shipped"

    async def go():
        return await asyncio.gather(
            orders_route.update_order_status(35, {"status": "delivered"}, user=ADMIN),
            orders_route.update_order_status(35, {"status": "delivered"}, user=ADMIN), return_exceptions=True)

    run(go())
    assert sorted(r["kind"] for r in db.mine(user_id=1)) == ["order_status", "review_request"]


def test_a_paid_online_order_announces_itself_once(db, quiet):
    _, payments_route, _ = quiet
    order = {"id": 36, "user_id": 1, "merchant_id": 3, "order_code": "FS-36", "total": 6.0, "payment_method": "stripe"}
    run(payments_route._notify_paid(db, order))
    run(payments_route._notify_paid(db, order))
    assert [r["title"] for r in db.mine(user_id=1)] == ["Payment received"]
    assert [r["title"] for r in db.mine(merchant_id=3)] == ["New order"]


def test_payout_actions_notify_the_shop(db, quiet, monkeypatch):
    *_, settlements_route = quiet
    from app.models.settlement import PayoutComplete, PayoutFail, PayoutReverse

    payout = {"id": 6, "merchant_id": 3, "amount": 34.2, "reference": "REF123"}

    async def rpc(db_, fn, params):
        return dict(payout)

    monkeypatch.setattr(settlements_route.settlement, "rpc", rpc)
    run(settlements_route.admin_complete_payout(6, PayoutComplete(reference="REF123"), user=ADMIN))
    run(settlements_route.admin_fail_payout(6, PayoutFail(reason="bank down"), user=ADMIN))
    run(settlements_route.admin_reverse_payout(6, PayoutReverse(reason="never arrived"), user=ADMIN))
    assert [r["title"] for r in db.mine(merchant_id=3)] == ["Payout sent", "Payout failed", "Payout reversed"]


def test_shop_inbox_is_empty_not_an_error_before_migration_027(db):
    db.migrated = False
    assert run(route.list_shop_notifications(user=SHOP3)) == []
    assert run(route.shop_unread_count(user=SHOP3)) == {"count": 0}
    assert run(route.read_all_shop(user=SHOP3)) == {"success": True, "count": 0}
    with pytest.raises(NotFoundError):
        run(route.mark_shop_notification_read(1, user=SHOP3))
    assert run(route.my_unread_count(user=CUSTOMER)) == {"count": 0}  # the customer feed is unaffected
