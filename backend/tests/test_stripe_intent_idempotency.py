"""One PaymentIntent per order, however the intent endpoint gets called.

The bug: check-then-create with no idempotency. Two overlapping requests (React
Strict Mode double mount, double tap, two tabs, two serverless instances) both
saw no stored intent, both created one at Stripe, and the last write to the
order won. The customer could pay the intent that was NOT stored, and the order
then never became paid.

Stripe and the database are faked, but the fakes keep the properties that matter:
the same Idempotency-Key returns the same PaymentIntent, and every call yields to
the event loop so concurrent requests really interleave.
"""

import asyncio

import httpx
import pytest

from app.config import settings
from app.core.constants import Role
from app.core.exceptions import BadRequestError
from app.core.security import TokenClaims
from app.routes import payments_stripe as route
from app.services import stripe_pay


@pytest.fixture(autouse=True)
def card_released(monkeypatch):
    """These tests are about the intent itself: card is released to everyone here."""
    monkeypatch.setattr(settings, "CARD_PAYMENTS", "on")

USER = TokenClaims(sub="1", role=Role.USER, telegram_id=111)
TOTAL = 21.60


# ── fakes ──────────────────────────────────────────────────────────

class FakeStripe:
    """Just enough of Stripe's PaymentIntent API."""

    def __init__(self, *, honor_idempotency=True):
        self.honor_idempotency = honor_idempotency
        self.intents: dict[str, dict] = {}
        self.by_key: dict[str, str] = {}
        self.create_calls = 0
        self.keys_sent: list[str | None] = []
        self.fail_retrieve = False

    async def create(self, *, amount, currency, order_id, order_code, idempotency_key=None):
        self.create_calls += 1
        self.keys_sent.append(idempotency_key)
        await asyncio.sleep(0)  # network latency: let other requests run
        if self.honor_idempotency and idempotency_key and idempotency_key in self.by_key:
            return dict(self.intents[self.by_key[idempotency_key]])
        intent = {
            "id": f"pi_{len(self.intents) + 1}", "status": "requires_payment_method",
            "client_secret": f"pi_{len(self.intents) + 1}_secret", "amount": stripe_pay.to_minor_units(amount),
            "amount_received": 0,
        }
        self.intents[intent["id"]] = intent
        if idempotency_key:
            self.by_key[idempotency_key] = intent["id"]
        return dict(intent)

    async def retrieve(self, intent_id):
        await asyncio.sleep(0)
        if self.fail_retrieve:
            raise stripe_pay.StripeError("network down")
        return dict(self.intents[intent_id])

    # what the customer's browser does at Stripe
    def decline(self, intent_id):
        self.intents[intent_id]["last_payment_error"] = {"code": "card_declined"}

    def pay(self, intent_id):
        i = self.intents[intent_id]
        i["status"], i["amount_received"] = "succeeded", i["amount"]

    def cancel(self, intent_id):
        self.intents[intent_id]["status"] = "canceled"


class FakeQuery:
    def __init__(self, db, table):
        self.db, self.table, self.filters = db, table, []

    def eq(self, col, val):
        self.filters.append((col, "eq", val)); return self

    def neq(self, col, val):
        self.filters.append((col, "neq", val)); return self

    def is_(self, col, val):
        assert val == "null"
        self.filters.append((col, "is_null", None)); return self

    def _match(self, row):
        for col, op, val in self.filters:
            if op == "eq" and row.get(col) != val: return False
            if op == "neq" and row.get(col) == val: return False
            if op == "is_null" and row.get(col) is not None: return False
        return True

    async def select_one(self, *_):
        await asyncio.sleep(0)
        rows = [r for r in self.db.orders.values() if self._match(r)]
        return dict(rows[0]) if rows else None

    async def update(self, data):
        await asyncio.sleep(0)
        # match + write in one step, like a single SQL UPDATE ... WHERE
        rows = [r for r in self.db.orders.values() if self._match(r)]
        for r in rows:
            r.update(data)
        return [dict(r) for r in rows]


class FakeDb:
    def __init__(self, **order):
        base = {"id": 35, "user_id": 1, "order_code": "FS-1", "total": TOTAL, "status": "pending",
                "payment_method": "stripe", "payment_status": "pending", "stripe_payment_intent_id": None}
        base.update(order)
        self.orders = {base["id"]: base}

    @property
    def order(self):
        return self.orders[35]

    def from_(self, table):
        assert table == "orders"
        return FakeQuery(self, table)


@pytest.fixture
def env(monkeypatch):
    """A faked Stripe + DB wired into the route."""
    stripe, db = FakeStripe(), FakeDb()
    monkeypatch.setattr(stripe_pay, "create_payment_intent", stripe.create)
    monkeypatch.setattr(stripe_pay, "retrieve_payment_intent", stripe.retrieve)

    async def own_order(db_, order_id, user):
        await asyncio.sleep(0)
        return dict(db_.orders[order_id])

    async def mark_paid(db_, order, *, fields, actor_type, actor_id):
        db_.orders[order["id"]].update({"payment_status": "paid", **fields})
        return "paid"

    monkeypatch.setattr(route, "_get_own_order", own_order)
    monkeypatch.setattr(route, "mark_order_paid", mark_paid)
    monkeypatch.setattr(settings, "CURRENCY", "usd")
    return stripe, db


def call(db, n=1):
    """n overlapping calls to the intent endpoint's logic."""
    async def run():
        return await asyncio.gather(*(route.ensure_payment_intent(db, 35, USER) for _ in range(n)))
    return asyncio.run(run())


# ── the Idempotency-Key itself ─────────────────────────────────────

def test_key_is_stable_per_order_and_amount():
    k = stripe_pay.intent_idempotency_key(35, 21.60)
    assert k == stripe_pay.intent_idempotency_key(35, "21.60")
    assert k == stripe_pay.intent_idempotency_key(35, 21.6)
    assert k != stripe_pay.intent_idempotency_key(36, 21.60)          # another order
    assert k != stripe_pay.intent_idempotency_key(35, 21.61)          # Stripe rejects a reused key with new params
    assert k != stripe_pay.intent_idempotency_key(35, 21.60, "pi_1")  # replacing a cancelled intent


def _mock_stripe_http(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(stripe_pay.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_x")

    async def no_wait(_):
        return None
    monkeypatch.setattr(stripe_pay.asyncio, "sleep", no_wait)


def test_idempotency_key_header_is_sent_to_stripe(monkeypatch):
    seen = []

    def handler(request):
        seen.append(request.headers.get("idempotency-key"))
        return httpx.Response(200, json={"id": "pi_1", "status": "requires_payment_method"})

    _mock_stripe_http(monkeypatch, handler)
    asyncio.run(stripe_pay.create_payment_intent(
        amount=TOTAL, currency="usd", order_id=35, order_code="FS-1", idempotency_key="fos-pi-order-35-2160-first"))
    assert seen == ["fos-pi-order-35-2160-first"]


def test_in_flight_key_409_is_retried_then_replayed(monkeypatch):
    """Stripe answers 409 while another request holds the key; once it finishes the key replays."""
    replies = [httpx.Response(409, json={"error": {"message": "in use"}}),
               httpx.Response(409, json={"error": {"message": "in use"}}),
               httpx.Response(200, json={"id": "pi_1", "status": "requires_payment_method"})]
    _mock_stripe_http(monkeypatch, lambda request: replies.pop(0))
    intent = asyncio.run(stripe_pay.create_payment_intent(
        amount=TOTAL, currency="usd", order_id=35, order_code="FS-1", idempotency_key="k"))
    assert intent["id"] == "pi_1" and not replies


def test_409_that_never_clears_fails_cleanly(monkeypatch):
    _mock_stripe_http(monkeypatch, lambda request: httpx.Response(409, json={"error": {"message": "in use"}}))
    with pytest.raises(stripe_pay.StripeError):
        asyncio.run(stripe_pay.create_payment_intent(
            amount=TOTAL, currency="usd", order_id=35, order_code="FS-1", idempotency_key="k"))


# ── duplicate and concurrent requests ──────────────────────────────

def test_repeated_calls_return_the_same_intent(env):
    stripe, db = env
    first, second, third = (call(db)[0] for _ in range(3))
    assert first["client_secret"] == second["client_secret"] == third["client_secret"]
    assert stripe.create_calls == 1
    assert db.order["stripe_payment_intent_id"] == "pi_1"


def test_strict_mode_double_mount(env):
    """Two requests ~70 ms apart, as React Strict Mode sent them."""
    stripe, db = env
    a, b = call(db, 2)
    assert a["client_secret"] == b["client_secret"] == "pi_1_secret"
    assert len(stripe.intents) == 1
    assert db.order["stripe_payment_intent_id"] == "pi_1"


def test_many_concurrent_requests_create_one_intent(env):
    stripe, db = env
    results = call(db, 12)
    assert {r["client_secret"] for r in results} == {"pi_1_secret"}
    assert len(stripe.intents) == 1 and stripe.create_calls == 1
    assert db.order["stripe_payment_intent_id"] == "pi_1"


def test_idempotency_key_alone_holds_across_instances(env, monkeypatch):
    """No shared lock (separate serverless instances): Stripe's key still yields one intent."""
    stripe, db = env
    monkeypatch.setattr(route, "_lock_for", lambda order_id: asyncio.Lock())
    results = call(db, 12)
    assert stripe.create_calls > 1                      # they really did race to Stripe
    assert len(stripe.intents) == 1                     # and Stripe handed them all the same intent
    assert {r["client_secret"] for r in results} == {"pi_1_secret"}
    assert db.order["stripe_payment_intent_id"] == "pi_1"
    assert set(stripe.keys_sent) == {"fos-pi-order-35-2160-first"}


def test_stored_intent_always_matches_the_one_handed_out(env, monkeypatch):
    """Defence in depth: even if Stripe ignored the key AND there were no lock, the order's
    stored intent is the one every customer-facing response carries (first writer wins)."""
    stripe, db = env
    stripe.honor_idempotency = False
    monkeypatch.setattr(route, "_lock_for", lambda order_id: asyncio.Lock())
    results = call(db, 8)
    stored = db.order["stripe_payment_intent_id"]
    assert len(stripe.intents) > 1                      # duplicates were created at Stripe ...
    assert {r["client_secret"] for r in results} == {f"{stored}_secret"}  # ... but nobody was handed a stray one


def test_two_tabs_share_one_intent(env):
    stripe, db = env
    tab_a = call(db)[0]
    tab_b = call(db)[0]
    assert tab_a["client_secret"] == tab_b["client_secret"]
    assert stripe.create_calls == 1


# ── retry after a declined payment ─────────────────────────────────

def test_retry_after_decline_reuses_the_same_intent(env):
    stripe, db = env
    first = call(db)[0]
    stripe.decline("pi_1")                              # card declined: intent stays open
    retry = call(db)[0]
    assert retry["client_secret"] == first["client_secret"]
    assert stripe.create_calls == 1
    assert db.order["payment_status"] == "pending"      # a decline never marks the order paid


def test_repeated_declines_then_success(env):
    stripe, db = env
    for _ in range(3):
        assert call(db)[0]["client_secret"] == "pi_1_secret"
        stripe.decline("pi_1")
    stripe.pay("pi_1")
    assert call(db)[0] == {"payment_status": "paid"}
    assert len(stripe.intents) == 1


# ── successful payment ─────────────────────────────────────────────

def test_successful_payment_marks_order_paid_with_the_stored_intent(env):
    stripe, db = env
    call(db)
    stripe.pay("pi_1")
    assert call(db)[0] == {"payment_status": "paid"}
    assert db.order["payment_status"] == "paid"
    assert db.order["payment_ref"] == db.order["stripe_payment_intent_id"] == "pi_1"


def test_paid_order_never_gets_a_new_intent(env):
    stripe, db = env
    db.order.update(payment_status="paid", stripe_payment_intent_id="pi_old")
    assert call(db, 5) == [{"payment_status": "paid"}] * 5
    assert stripe.create_calls == 0


def test_wrong_amount_is_not_treated_as_paid(env):
    stripe, db = env
    call(db)
    stripe.pay("pi_1")
    stripe.intents["pi_1"]["amount_received"] = 100     # Stripe says it took $1.00, order is $21.60
    with pytest.raises(BadRequestError):                # never reported as paid ...
        call(db)
    assert db.order["payment_status"] == "pending"      # ... and the order is not marked paid
    assert stripe.create_calls == 1                     # ... and no second intent is started


# ── safety around existing intents ─────────────────────────────────

def test_stripe_error_checking_existing_intent_never_replaces_it(env):
    """A network blip must not make us abandon an intent the customer may already have paid."""
    stripe, db = env
    call(db)
    stripe.fail_retrieve = True
    with pytest.raises(BadRequestError):
        call(db)
    assert stripe.create_calls == 1
    assert db.order["stripe_payment_intent_id"] == "pi_1"


def test_processing_intent_is_not_duplicated(env):
    stripe, db = env
    call(db)
    stripe.intents["pi_1"]["status"] = "processing"
    with pytest.raises(BadRequestError):
        call(db)
    assert stripe.create_calls == 1


def test_cancelled_intent_is_replaced_exactly_once(env):
    stripe, db = env
    call(db)
    stripe.cancel("pi_1")
    results = call(db, 6)
    assert {r["client_secret"] for r in results} == {"pi_2_secret"}
    assert len(stripe.intents) == 2
    assert db.order["stripe_payment_intent_id"] == "pi_2"
    assert stripe.keys_sent[-1] == "fos-pi-order-35-2160-pi_1"


@pytest.mark.parametrize("change", [{"payment_method": "cod"}, {"status": "cancelled"}, {"status": "confirmed"}])
def test_orders_that_cannot_be_paid_by_card_are_refused(env, change):
    stripe, db = env
    db.order.update(change)
    with pytest.raises(BadRequestError):
        call(db)
    assert stripe.create_calls == 0


def test_existing_orders_with_a_stored_intent_keep_working(env):
    """Orders created before this fix already carry a stored intent (some with an orphan twin at Stripe)."""
    stripe, db = env
    stripe.intents["pi_7"] = {"id": "pi_7", "status": "requires_payment_method", "client_secret": "pi_7_secret",
                              "amount": 2160, "amount_received": 0}
    db.order["stripe_payment_intent_id"] = "pi_7"
    assert call(db)[0]["client_secret"] == "pi_7_secret"
    assert stripe.create_calls == 0
    stripe.pay("pi_7")
    assert call(db)[0] == {"payment_status": "paid"}
