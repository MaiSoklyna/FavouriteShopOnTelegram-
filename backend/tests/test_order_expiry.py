"""Unpaid online orders expire after their payment deadline and give their stock back.

Covers: deadlines per payment method (COD never expires), the last check with PayWay/Stripe before
giving up, cancelling an open card payment, claiming the expiry exactly once, the activity-log
entry and customer notice, late payments on an expired order, and the scheduler endpoint.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.core.constants import PAYMENT_EXPIRY_MINUTES
from app.core.exceptions import BadRequestError, ForbiddenError
from app.routes import orders as orders_route
from app.routes import payments, payments_stripe
from app.services import audit, coupons, inventory, notify, order_expiry, settlement, stripe_pay

NOW = datetime(2026, 11, 25, 10, 0, tzinfo=timezone.utc)
PAST = (NOW - timedelta(minutes=1)).isoformat()
FUTURE = (NOW + timedelta(minutes=10)).isoformat()


# ── A small fake of the PostgREST query builder ─────────────────

class Query:
    def __init__(self, db, table):
        self.db, self.table, self.tests = db, table, []

    def eq(self, col, val):
        self.tests.append(lambda r: r.get(col) == val)
        return self

    def neq(self, col, val):
        self.tests.append(lambda r: r.get(col) != val)
        return self

    def lte(self, col, val):
        self.tests.append(lambda r: r.get(col) is not None and r[col] <= val)
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, _n):
        return self

    def _rows(self):
        return [r for r in self.db.tables.setdefault(self.table, []) if all(t(r) for t in self.tests)]

    async def select(self, *_):
        await asyncio.sleep(0)
        return [dict(r) for r in self._rows()]

    async def select_one(self, *_):
        rows = await self.select()
        return rows[0] if rows else None

    async def update(self, data):
        await asyncio.sleep(0)
        rows = self._rows()  # match and write in one step, like UPDATE ... WHERE
        for r in rows:
            r.update(data)
        return [dict(r) for r in rows]

    async def insert(self, data):
        rows = self.db.tables.setdefault(self.table, [])
        row = {"id": len(rows) + 1, **data}
        rows.append(row)
        return [dict(row)]


class FakeDB:
    def __init__(self, orders=(), items=()):
        self.tables = {"orders": [dict(o) for o in orders], "order_items": [dict(i) for i in items]}

    def from_(self, table):
        return Query(self, table)

    def order(self, order_id):
        return next(o for o in self.tables["orders"] if o["id"] == order_id)


def order(**kw):
    base = {"id": 1, "user_id": 7, "merchant_id": 3, "order_code": "FS-1", "total": "10.00",
            "status": "pending", "payment_status": "pending", "payment_method": "khqr",
            "payway_tran_id": None, "stripe_payment_intent_id": None, "payment_expires_at": PAST}
    return {**base, **kw}


ITEM = {"order_id": 1, "product_id": 11, "quantity": 2, "selected_variants": None}


@pytest.fixture
def spy(monkeypatch):
    """Record the side effects of expiring an order instead of performing them."""
    calls = {"released": [], "coupons": [], "audit": [], "notify": []}

    async def release_stock(db, items):
        calls["released"].append([dict(i) for i in items])

    async def release_for_order(db, order_id):
        calls["coupons"].append(order_id)

    async def record(db, user, **kw):
        calls["audit"].append({"user": user, **kw})

    async def order_status_changed(db, order_id, status, **kw):
        calls["notify"].append((order_id, status))

    monkeypatch.setattr(inventory, "release_stock", release_stock)
    monkeypatch.setattr(coupons, "release_for_order", release_for_order)
    monkeypatch.setattr(audit, "record", record)
    monkeypatch.setattr(notify, "order_status_changed", order_status_changed)
    return calls


# ── Deadlines ───────────────────────────────────────────────────

def test_khqr_and_card_get_30_minutes():
    assert order_expiry.payment_deadline("khqr", NOW) == NOW + timedelta(minutes=30)
    assert order_expiry.payment_deadline("stripe", NOW) == NOW + timedelta(minutes=30)


def test_cash_on_delivery_and_unknown_methods_never_expire():
    assert order_expiry.payment_deadline("cod", NOW) is None
    assert order_expiry.payment_deadline("wing", NOW) is None
    assert order_expiry.payment_deadline(None, NOW) is None


def test_minutes_are_configurable_per_method(monkeypatch):
    monkeypatch.setitem(PAYMENT_EXPIRY_MINUTES, "khqr", 10)
    assert order_expiry.payment_deadline("khqr", NOW) == NOW + timedelta(minutes=10)
    assert order_expiry.payment_deadline("stripe", NOW) == NOW + timedelta(minutes=30)


@pytest.mark.parametrize("changes, overdue", [
    ({}, True),
    ({"payment_expires_at": FUTURE}, False),
    ({"payment_expires_at": None}, False),            # COD: no deadline
    ({"payment_status": "paid"}, False),
    ({"status": "confirmed"}, False),
    ({"status": "expired"}, False),
])
def test_is_overdue(changes, overdue):
    assert order_expiry.is_overdue(order(**changes), NOW) is overdue


def test_seconds_left():
    assert order_expiry.seconds_left(order(payment_expires_at=FUTURE), NOW) == 600
    assert order_expiry.seconds_left(order(), NOW) == 0
    assert order_expiry.seconds_left(order(payment_expires_at=None), NOW) is None


# ── Expiring ────────────────────────────────────────────────────

def test_unpaid_qr_order_expires_and_gives_everything_back(spy):
    db = FakeDB([order()], [ITEM])
    expired = asyncio.run(order_expiry.expire_overdue(db, now=NOW))

    assert expired == [1]
    assert db.order(1)["status"] == "expired"
    assert [[(i["product_id"], i["quantity"]) for i in batch] for batch in spy["released"]] == [[(11, 2)]]
    assert spy["coupons"] == [1]
    assert spy["notify"] == [(1, "expired")]
    (entry,) = spy["audit"]
    assert entry["user"] is None  # written as "System"
    assert entry["action"] == "order.expired" and entry["merchant_id"] == 3 and entry["target_id"] == 1
    assert entry["old"]["status"] == "pending" and entry["new"]["status"] == "expired"
    assert "order.expired" in audit.ACTIONS


def test_orders_before_their_deadline_cod_and_paid_orders_are_left_alone(spy):
    db = FakeDB([
        order(id=1, payment_expires_at=FUTURE),
        order(id=2, payment_method="cod", payment_expires_at=None),
        order(id=3, payment_status="paid"),
        order(id=4, status="confirmed"),
    ])
    assert asyncio.run(order_expiry.expire_overdue(db, now=NOW)) == []
    assert [o["status"] for o in db.tables["orders"]] == ["pending", "pending", "pending", "confirmed"]
    assert spy["released"] == [] and spy["audit"] == []


def test_filters_limit_the_sweep(spy):
    db = FakeDB([order(id=1, user_id=7, merchant_id=3), order(id=2, user_id=8, merchant_id=4)])
    assert asyncio.run(order_expiry.expire_overdue(db, user_id=8, now=NOW)) == [2]
    assert asyncio.run(order_expiry.expire_overdue(db, merchant_id=3, now=NOW)) == [1]


def test_two_requests_expire_an_order_only_once(spy):
    db = FakeDB([order()], [ITEM])

    async def both():
        a, b = dict(db.order(1)), dict(db.order(1))
        return await asyncio.gather(order_expiry.expire_order(db, a, now=NOW),
                                    order_expiry.expire_order(db, b, now=NOW))

    assert sorted(asyncio.run(both())) == [False, True]
    assert len(spy["released"]) == 1 and len(spy["coupons"]) == 1 and len(spy["audit"]) == 1


def test_qr_paid_at_the_last_minute_is_recorded_as_paid_not_expired(spy, monkeypatch):
    db = FakeDB([order(payway_tran_id="1123")], [ITEM])

    async def settle(db_, o, tran_id, raise_errors=False):
        db_.order(o["id"]).update({"payment_status": "paid", "status": "confirmed"})
        return "paid"

    monkeypatch.setattr(payments, "_settle", settle)
    assert asyncio.run(order_expiry.expire_overdue(db, now=NOW)) == []
    assert db.order(1)["status"] == "confirmed"
    assert spy["released"] == []


def test_qr_not_paid_expires(spy, monkeypatch):
    db = FakeDB([order(payway_tran_id="1123")], [ITEM])

    async def settle(db_, o, tran_id, raise_errors=False):
        return "pending"

    monkeypatch.setattr(payments, "_settle", settle)
    assert asyncio.run(order_expiry.expire_overdue(db, now=NOW)) == [1]


def test_payway_unreachable_means_try_again_later(spy, monkeypatch):
    db = FakeDB([order(payway_tran_id="1123")], [ITEM])

    async def settle(db_, o, tran_id, raise_errors=False):
        raise RuntimeError("PayWay down")

    monkeypatch.setattr(payments, "_settle", settle)
    assert asyncio.run(order_expiry.expire_overdue(db, now=NOW)) == []
    assert db.order(1)["status"] == "pending"


def _stripe(monkeypatch, *statuses, cancel_fails=False):
    """Stripe returns `statuses` on successive retrieves; records cancels."""
    seen = {"cancelled": [], "settled": []}
    queue = list(statuses)

    async def retrieve(intent_id):
        return {"id": intent_id, "status": queue.pop(0) if len(queue) > 1 else queue[0]}

    async def cancel(intent_id):
        if cancel_fails:
            raise stripe_pay.StripeError("cannot cancel")
        seen["cancelled"].append(intent_id)
        return {"id": intent_id, "status": "canceled"}

    async def settle(db_, o, intent):
        seen["settled"].append(intent["id"])
        db_.order(o["id"]).update({"payment_status": "paid", "status": "confirmed"})
        return "paid"

    monkeypatch.setattr(stripe_pay, "retrieve_payment_intent", retrieve)
    monkeypatch.setattr(stripe_pay, "cancel_payment_intent", cancel)
    monkeypatch.setattr(payments_stripe, "_settle", settle)
    return seen


def test_open_card_payment_is_cancelled_before_the_order_expires(spy, monkeypatch):
    seen = _stripe(monkeypatch, "requires_payment_method")
    db = FakeDB([order(payment_method="stripe", stripe_payment_intent_id="pi_1")], [ITEM])
    assert asyncio.run(order_expiry.expire_overdue(db, now=NOW)) == [1]
    assert seen["cancelled"] == ["pi_1"]


def test_card_that_succeeded_is_settled_not_expired(spy, monkeypatch):
    seen = _stripe(monkeypatch, "succeeded")
    db = FakeDB([order(payment_method="stripe", stripe_payment_intent_id="pi_1")], [ITEM])
    assert asyncio.run(order_expiry.expire_overdue(db, now=NOW)) == []
    assert seen["settled"] == ["pi_1"] and seen["cancelled"] == []
    assert db.order(1)["status"] == "confirmed"


def test_card_that_succeeds_while_cancelling_is_settled(spy, monkeypatch):
    seen = _stripe(monkeypatch, "requires_action", "succeeded", cancel_fails=True)
    db = FakeDB([order(payment_method="stripe", stripe_payment_intent_id="pi_1")], [ITEM])
    assert asyncio.run(order_expiry.expire_overdue(db, now=NOW)) == []
    assert seen["settled"] == ["pi_1"]


def test_card_still_processing_waits(spy, monkeypatch):
    _stripe(monkeypatch, "processing")
    db = FakeDB([order(payment_method="stripe", stripe_payment_intent_id="pi_1")], [ITEM])
    assert asyncio.run(order_expiry.expire_overdue(db, now=NOW)) == []
    assert db.order(1)["status"] == "pending"


def test_missing_migration_turns_expiry_off_quietly(spy):
    class NoColumnDB(FakeDB):
        def from_(self, table):
            q = Query(self, table)

            async def fail(*_):
                req = httpx.Request("GET", "http://db/orders")
                raise httpx.HTTPStatusError("x", request=req, response=httpx.Response(
                    400, json={"code": "42703", "message": "column orders.payment_expires_at does not exist"}, request=req))
            q.select = fail
            return q

    assert asyncio.run(order_expiry.expire_overdue(NoColumnDB([order()]), now=NOW)) == []


def test_sweep_runs_at_most_once_a_minute(spy, monkeypatch):
    monkeypatch.setattr(order_expiry, "_last_sweep", 0.0)
    db = FakeDB([order(payment_expires_at=(datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat())], [ITEM])
    assert asyncio.run(order_expiry.sweep_if_due(db)) == [1]
    db.tables["orders"].append(order(id=2, payment_expires_at=PAST))
    assert asyncio.run(order_expiry.sweep_if_due(db)) == []  # too soon


# ── A payment that arrives after expiry ─────────────────────────

def test_payment_after_expiry_keeps_the_order_expired_and_earns_nothing(monkeypatch):
    db = FakeDB([order(status="expired")])
    paid_notices, earnings = [], []

    async def notify_paid(db_, o):
        paid_notices.append(o["id"])

    async def record_earning(db_, o, **kw):
        earnings.append(await settlement_record(db_, o, **kw))

    settlement_record = settlement.record_order_earning
    monkeypatch.setattr(payments, "_notify_paid", notify_paid)
    monkeypatch.setattr(settlement, "record_order_earning", record_earning)

    result = asyncio.run(payments.mark_order_paid(db, dict(db.order(1)), fields={"payment_ref": "x"},
                                                  actor_type="payway", actor_id="t"))
    assert result == "paid"
    assert db.order(1)["status"] == "expired" and db.order(1)["payment_status"] == "paid"
    assert paid_notices == []        # the shop is not told to prepare it
    assert earnings == [None]        # no earning: the customer is owed a refund


def test_payment_racing_the_expiry_is_flagged_not_advanced(monkeypatch):
    """The order was pending when read, but expired before the paid update could advance it."""
    db = FakeDB([order(status="expired")])
    notices = []

    async def notify_paid(db_, o):
        notices.append(o["id"])

    async def record_earning(db_, o, **kw):
        assert o["status"] == "expired"

    monkeypatch.setattr(payments, "_notify_paid", notify_paid)
    monkeypatch.setattr(settlement, "record_order_earning", record_earning)
    stale = dict(db.order(1), status="pending")
    asyncio.run(payments.mark_order_paid(db, stale, fields={}, actor_type="payway", actor_id="t"))
    assert db.order(1)["status"] == "expired" and notices == []


# ── Scheduler endpoint ──────────────────────────────────────────

def test_expire_due_endpoint_needs_the_configured_secret(monkeypatch):
    monkeypatch.setattr(orders_route.settings, "CRON_SECRET", "")
    with pytest.raises(ForbiddenError):
        asyncio.run(orders_route.expire_due_orders(x_cron_secret="anything"))
    monkeypatch.setattr(orders_route.settings, "CRON_SECRET", "s3cret")
    with pytest.raises(ForbiddenError):
        asyncio.run(orders_route.expire_due_orders(x_cron_secret="wrong"))
    with pytest.raises(ForbiddenError):
        asyncio.run(orders_route.expire_due_orders(x_cron_secret=None))


def test_expire_due_endpoint_sweeps_every_shop(monkeypatch):
    from contextlib import asynccontextmanager

    db = FakeDB()
    swept = []

    @asynccontextmanager
    async def service_role():
        yield db

    async def expire_overdue(db_, **kw):
        swept.append(kw)
        return [5]

    monkeypatch.setattr(orders_route.settings, "CRON_SECRET", "s3cret")
    monkeypatch.setattr(orders_route.SupabaseClient, "service_role", service_role)
    monkeypatch.setattr(order_expiry, "expire_overdue", expire_overdue)
    assert asyncio.run(orders_route.expire_due_orders(x_cron_secret="s3cret")) == {"success": True, "expired": [5]}
    assert swept == [{}]


# ── Paying an expired order ─────────────────────────────────────

def test_no_new_qr_for_an_expired_order(monkeypatch):
    from contextlib import asynccontextmanager

    db = FakeDB([order(status="expired")])

    @asynccontextmanager
    async def service_role():
        yield db

    async def own(db_, order_id, user):
        return dict(db_.order(order_id))

    monkeypatch.setattr(payments.payway, "is_configured", lambda: True)
    monkeypatch.setattr(payments.SupabaseClient, "service_role", service_role)
    monkeypatch.setattr(payments, "_get_own_order", own)
    req = __import__("starlette.requests", fromlist=["Request"]).Request({"type": "http", "headers": [], "client": ("1.2.3.4", 1)})
    with pytest.raises(BadRequestError, match="expired"):
        asyncio.run(payments.create_qr.__wrapped__(req, 1, user=None))


# ── Inserting the deadline before migration 038 ─────────────────

def test_order_is_placed_without_a_deadline_before_the_migration():
    class OldDB(FakeDB):
        def from_(self, table):
            q = Query(self, table)
            real_insert = q.insert

            async def insert(data):
                if "payment_expires_at" in data:
                    req = httpx.Request("POST", "http://db/orders")
                    raise httpx.HTTPStatusError("x", request=req, response=httpx.Response(
                        400, json={"code": "PGRST204", "message": "Could not find the 'payment_expires_at' column"},
                        request=req))
                return await real_insert(data)
            q.insert = insert
            return q

    db = OldDB()
    rows = asyncio.run(orders_route._insert_order(db, {"total": 1, "payment_expires_at": FUTURE}))
    assert rows[0]["total"] == 1 and "payment_expires_at" not in rows[0]
