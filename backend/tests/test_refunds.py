"""Refunds are recorded when the platform holds money for an order that did not go ahead.

Covers: which orders are owed a refund (paid, KHQR/card only), one refund per order, the three
reasons, never breaking the cancellation or payment that triggers it, marking a refund sent exactly
once, and the admin list.
"""

import asyncio
from contextlib import asynccontextmanager

import httpx
import pytest

from app.core.constants import Role
from app.core.exceptions import BadRequestError, ConflictError, NotFoundError
from app.core.security import TokenClaims
from app.routes import payments
from app.routes import refunds as refunds_route
from app.services import audit, notify, order_status, refunds, settlement

ADMIN = TokenClaims(sub="1", role=Role.SUPER_ADMIN, name="Nadra")


def pg_error(code, status=409):
    req = httpx.Request("POST", "http://db/refunds")
    return httpx.HTTPStatusError("x", request=req, response=httpx.Response(status, json={"code": code}, request=req))


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.tests, self._desc = db, table, [], False

    def eq(self, col, val):
        self.tests.append(lambda r: r.get(col) == val)
        return self

    def neq(self, col, val):
        self.tests.append(lambda r: r.get(col) != val)
        return self

    def in_(self, col, vals):
        self.tests.append(lambda r: r.get(col) in vals)
        return self

    def order(self, col, desc=False, **_):
        self._order, self._desc = col, desc
        return self

    def offset(self, _n):
        return self

    def limit(self, _n):
        return self

    def _rows(self):
        if self.table in self.db.missing:
            raise pg_error("PGRST205", 404)
        return [r for r in self.db.tables.setdefault(self.table, []) if all(t(r) for t in self.tests)]

    async def select(self, *_):
        await asyncio.sleep(0)
        rows = [dict(r) for r in self._rows()]
        return sorted(rows, key=lambda r: r.get("created_at") or "", reverse=self._desc)

    async def select_one(self, *_):
        rows = await self.select()
        return rows[0] if rows else None

    async def update(self, data):
        await asyncio.sleep(0)
        rows = self._rows()
        for r in rows:
            r.update(data)
        return [dict(r) for r in rows]

    async def insert(self, data):
        await asyncio.sleep(0)
        if self.table in self.db.missing:
            raise pg_error("PGRST205", 404)
        rows = self.db.tables.setdefault(self.table, [])
        if self.table == "refunds" and any(r["order_id"] == data["order_id"] for r in rows):
            raise pg_error("23505")
        row = {"id": len(rows) + 1, "status": "pending", "created_at": f"2026-11-25T10:0{len(rows)}:00Z", **data}
        rows.append(row)
        return [dict(row)]


class FakeDB:
    def __init__(self, orders=(), missing=()):
        self.tables = {"orders": [dict(o) for o in orders], "refunds": [], "merchants": [{"id": 3, "name": "Bloom & Co."}]}
        self.missing = set(missing)

    def from_(self, table):
        return Query(self, table)


def paid_order(**kw):
    base = {"id": 9, "merchant_id": 3, "user_id": 7, "order_code": "FS-9", "total": "25.5",
            "status": "cancelled", "payment_method": "khqr", "payment_status": "paid",
            "payment_ref": "apv-1", "payway_tran_id": "91", "stripe_payment_intent_id": None}
    return {**base, **kw}


@pytest.fixture
def spy(monkeypatch):
    calls = {"audit": [], "notify": [], "ledger": []}

    async def record(db, user, **kw):
        calls["audit"].append({"user": user, **kw})

    async def notify_user(db, user_id, kind, title, body, **kw):
        calls["notify"].append((user_id, kind, title))
        return True

    async def ledger(db, **kw):
        calls["ledger"].append(kw)

    monkeypatch.setattr(audit, "record", record)
    monkeypatch.setattr(notify, "notify_user", notify_user)
    monkeypatch.setattr(settlement, "audit", ledger)
    return calls


# ── Requesting ──────────────────────────────────────────────────

def test_paid_qr_order_gets_a_refund_for_the_full_amount(spy):
    db = FakeDB([paid_order()])
    refund = asyncio.run(refunds.request(db, {"id": 9}, "order_cancelled"))

    assert refund["amount"] == "25.50" and refund["status"] == "pending"
    assert refund["reason"] == "order_cancelled" and refund["payment_ref"] == "apv-1"
    assert refund["user_id"] == 7 and refund["merchant_id"] == 3 and refund["order_code"] == "FS-9"
    assert [a["action"] for a in spy["audit"]] == ["refund.requested"]
    assert spy["audit"][0]["user"] is None  # System
    assert spy["notify"] == [(7, "refund", "Refund on its way")]
    assert spy["ledger"][0]["action"] == "refund.requested" and spy["ledger"][0]["entity_type"] == "refund"
    assert "refund.requested" in audit.ACTIONS and "refund.completed" in audit.ACTIONS


def test_card_refund_points_at_the_payment_intent(spy):
    db = FakeDB([paid_order(payment_method="stripe", payment_ref=None, stripe_payment_intent_id="pi_9")])
    assert asyncio.run(refunds.request(db, {"id": 9}, "order_cancelled"))["payment_ref"] == "pi_9"


@pytest.mark.parametrize("changes", [
    {"payment_status": "pending"},     # never paid
    {"payment_status": "refunded"},    # already given back
    {"payment_method": "cod"},         # the shop holds cash, not the platform
])
def test_nothing_is_owed(spy, changes):
    db = FakeDB([paid_order(**changes)])
    assert asyncio.run(refunds.request(db, {"id": 9}, "order_cancelled")) is None
    assert db.tables["refunds"] == [] and spy["notify"] == []


def test_requesting_twice_returns_the_first_refund(spy):
    db = FakeDB([paid_order()])
    first = asyncio.run(refunds.request(db, {"id": 9}, "order_cancelled"))
    again = asyncio.run(refunds.request(db, {"id": 9}, "paid_after_cancellation"))
    assert again["id"] == first["id"] and len(db.tables["refunds"]) == 1
    assert len(spy["notify"]) == 1


def test_before_the_migration_the_refund_is_only_logged(spy, caplog):
    db = FakeDB([paid_order()], missing={"refunds"})
    assert asyncio.run(refunds.request(db, {"id": 9}, "order_cancelled")) is None
    assert "needs a refund" in caplog.text


def test_a_failure_never_raises(spy, caplog):
    class Broken(FakeDB):
        def from_(self, table):
            raise RuntimeError("database down")

    assert asyncio.run(refunds.request(Broken(), {"id": 9}, "order_cancelled")) is None
    assert "refund it by hand" in caplog.text


def test_reason_for_a_late_payment():
    assert refunds.reason_for_payment_on("expired") == "paid_after_expiry"
    assert refunds.reason_for_payment_on("cancelled") == "paid_after_cancellation"


# ── Where refunds come from ─────────────────────────────────────

def test_cancelling_a_paid_order_requests_a_refund(monkeypatch):
    asked = []

    async def noop(*a, **k):
        return None

    async def request(db, order, reason, **kw):
        asked.append((order["id"], reason, kw["actor_type"]))

    for mod, name in [(settlement, "on_order_status_changed"), (order_status.inventory, "release_stock"),
                      (order_status.coupons, "release_for_order"), (order_status.loyalty, "on_order_cancelled"),
                      (notify, "order_status_changed")]:
        monkeypatch.setattr(mod, name, noop)
    monkeypatch.setattr(refunds, "request", request)
    from app.services import deliveries
    monkeypatch.setattr(deliveries, "order_cancelled", noop)

    db = FakeDB([paid_order(status="confirmed")])
    asyncio.run(order_status.change_status(db, {"id": 9, "status": "confirmed"}, "cancelled",
                                           actor_type="owner", actor_id="4"))
    assert asked == [(9, "order_cancelled", "owner")]


def test_payment_on_an_expired_order_requests_a_refund(monkeypatch):
    asked = []

    async def request(db, order, reason, **kw):
        asked.append((order["id"], reason))

    async def record_earning(*a, **k):
        return None

    monkeypatch.setattr(refunds, "request", request)
    monkeypatch.setattr(settlement, "record_order_earning", record_earning)
    db = FakeDB([paid_order(status="expired", payment_status="pending")])
    asyncio.run(payments.mark_order_paid(db, dict(db.tables["orders"][0]), fields={}, actor_type="payway", actor_id="t"))
    assert asked == [(9, "paid_after_expiry")]


# ── Completing ──────────────────────────────────────────────────

def _requested(spy):
    db = FakeDB([paid_order()])
    refund = asyncio.run(refunds.request(db, {"id": 9}, "order_cancelled"))
    spy["audit"].clear(); spy["notify"].clear(); spy["ledger"].clear()
    return db, refund


def test_marking_a_refund_sent(spy):
    db, refund = _requested(spy)
    done = asyncio.run(refunds.complete(db, refund["id"], ADMIN, reference=" ABA-TX-778 ", note="sent to 012 345"))

    assert done["status"] == "refunded" and done["refund_reference"] == "ABA-TX-778"
    assert done["completed_by_name"] == "Nadra" and done["completed_at"]
    assert db.tables["orders"][0]["payment_status"] == "refunded"
    assert [a["action"] for a in spy["audit"]] == ["refund.completed"] and spy["audit"][0]["user"] is ADMIN
    assert spy["notify"] == [(7, "refund", "Refund sent")]
    assert spy["ledger"][0]["action"] == "refund.completed"


def test_a_reference_is_required(spy):
    db, refund = _requested(spy)
    with pytest.raises(BadRequestError):
        asyncio.run(refunds.complete(db, refund["id"], ADMIN, reference="  "))


def test_a_refund_is_marked_sent_only_once(spy):
    db, refund = _requested(spy)

    async def both():
        return await asyncio.gather(
            refunds.complete(db, refund["id"], ADMIN, reference="A"),
            refunds.complete(db, refund["id"], ADMIN, reference="B"),
            return_exceptions=True,
        )

    results = asyncio.run(both())
    assert sum(isinstance(r, ConflictError) for r in results) == 1
    assert len(spy["notify"]) == 1


def test_unknown_refund(spy):
    with pytest.raises(NotFoundError):
        asyncio.run(refunds.complete(FakeDB(), 404, ADMIN, reference="x"))


def test_for_order_before_the_migration_is_none():
    assert asyncio.run(refunds.for_order(FakeDB(missing={"refunds"}), 9)) is None


# ── Admin list ──────────────────────────────────────────────────

def test_admin_list_shows_pending_with_shop_names_and_the_total_owed(spy, monkeypatch):
    db = FakeDB([paid_order(id=9), paid_order(id=10, order_code="FS-10", total="4.5")])
    asyncio.run(refunds.request(db, {"id": 9}, "order_cancelled"))
    asyncio.run(refunds.request(db, {"id": 10}, "order_cancelled"))
    asyncio.run(refunds.complete(db, 2, ADMIN, reference="R2"))

    @asynccontextmanager
    async def service_role():
        yield db

    monkeypatch.setattr(refunds_route.SupabaseClient, "service_role", service_role)
    out = asyncio.run(refunds_route.list_refunds(status="pending", page=1, page_size=25, user=ADMIN))
    assert [r["order_id"] for r in out["data"]] == [9]
    assert out["data"][0]["merchant_name"] == "Bloom & Co."
    assert out["data"][0]["reason_text"].startswith("The order was cancelled")
    assert out["summary"] == {"pending_count": 1, "pending_amount": "25.50"}

    done = asyncio.run(refunds_route.list_refunds(status="refunded", page=1, page_size=25, user=ADMIN))
    assert [r["order_id"] for r in done["data"]] == [10]
