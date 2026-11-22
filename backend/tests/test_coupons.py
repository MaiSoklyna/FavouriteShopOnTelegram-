"""Promotion Center: public and private coupons, the wallet, per-customer limits, and coupon use that cannot
be over-spent (database faked).

The fake database keeps what matters: claim_promo_use() runs as one locked transaction and applies the same
rules as the SQL (active, expiry, max uses, private-needs-wallet, per-customer limit); the wallet is unique per
(coupon, customer); and with `migrated=False` the wallet table, the new columns and the functions are missing,
exactly as before migration 030.
"""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.constants import Role
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims, mint_jwt
from app.db.client import SupabaseClient
from app.main import app
from app.models.coupon import GrantRequest
from app.routes import coupons as route
from app.routes import orders as orders_route
from app.routes import promotions as promotions_route
from app.services import coupons, inventory, notify, order_status

NEW_COLUMNS = {"audience", "per_user_limit"}
PAST = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
FUTURE = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()


def pg_error(code, message="error", status=400):
    req = httpx.Request("POST", "http://db/x")
    return httpx.HTTPStatusError("e", request=req, response=httpx.Response(status, json={"code": code, "message": message}, request=req))


class Q:
    def __init__(self, db, table):
        self.db, self.table, self.f, self.order_by, self.max = db, table, [], None, None

    def _check(self, data=None):
        if self.db.migrated:
            return
        if self.table == "coupon_wallet":
            raise pg_error("PGRST205", "Could not find the table 'public.coupon_wallet'", 404)
        cols = {c for _, c, _ in self.f} | set(data or {})
        if self.table == "promo_codes" and cols & NEW_COLUMNS:
            raise pg_error("PGRST204", f"Could not find the '{sorted(cols & NEW_COLUMNS)[0]}' column of 'promo_codes' in the schema cache")

    def _add(self, *c): self.f.append(c); return self
    def eq(self, col, val): return self._add("eq", col, val)
    def in_(self, col, vals): return self._add("in", col, list(vals))
    def not_(self, col, op, val): assert (op, val) == ("is", "null"); return self._add("notnull", col, None)

    def or_(self, *conds):
        parsed = []
        for c in conds:
            col, op, *val = c.split(".")
            parsed.append((col, op, ".".join(val)))
        return self._add("or", parsed, None)

    def order(self, col, *, desc=False, nulls_last=False): self.order_by = (col, desc); return self
    def limit(self, n): self.max = n; return self

    def _rows(self):
        out = []
        for r in self.db.tables.setdefault(self.table, []):
            ok = True
            for op, col, val in self.f:
                if op == "eq": ok &= r.get(col) == val
                elif op == "notnull": ok &= r.get(col) is not None
                elif op == "in": ok &= r.get(col) in val
                elif op == "or":
                    ok &= any((o == "is" and v == "null" and r.get(c) is None) or (o == "eq" and str(r.get(c)) == v) for c, o, v in col)
            if ok:
                out.append(r)
        if self.order_by:
            col, desc = self.order_by
            out = sorted(out, key=lambda r: str(r.get(col) or ""), reverse=desc)
        return out[: self.max] if self.max else out

    async def select(self, cols="*"):
        self._check(); await asyncio.sleep(0)
        if not self.db.migrated and self.table == "promo_codes" and any(c in str(cols) for c in NEW_COLUMNS):
            raise pg_error("PGRST204", "Could not find the 'audience' column of 'promo_codes' in the schema cache")
        return [dict(r) for r in self._rows()]

    async def select_one(self, cols="*"):
        rows = await self.select(cols)
        return rows[0] if rows else None

    async def insert(self, data):
        batch = data if isinstance(data, list) else [data]
        for row in batch: self._check(row)
        await asyncio.sleep(0)
        rows = self.db.tables.setdefault(self.table, [])
        if self.table == "coupon_wallet":
            for row in batch:
                if any(r["promo_code_id"] == row["promo_code_id"] and r["user_id"] == row["user_id"] for r in rows):
                    raise pg_error("23505", "duplicate key", 409)
        if self.table == "orders" and self.db.fail_order_insert:
            raise RuntimeError("database down")
        out = []
        for row in batch:
            self.db.next_id += 1
            new = {"id": self.db.next_id, **row}
            rows.append(new); out.append(dict(new))
        return out

    async def update(self, data):
        self._check(data); await asyncio.sleep(0)
        rows = self._rows()
        for r in rows: r.update(data)
        return [dict(r) for r in rows]

    async def delete(self):
        await asyncio.sleep(0)
        gone = self._rows()
        self.db.tables[self.table] = [r for r in self.db.tables[self.table] if r not in gone]


def code(id, name, merchant=3, **kw):
    return {"id": id, "code": name, "merchant_id": merchant, "type": "percent", "value": 10, "min_order": 0, "max_uses": None,
            "used_count": 0, "expires_at": None, "is_active": True, "audience": "public", "per_user_limit": None, **kw}


class Db:
    def __init__(self, migrated=True):
        self.migrated, self.next_id, self.fail_order_insert = migrated, 1000, False
        self._lock = asyncio.Lock()
        self.tables = {
            "users": [{"id": 1, "telegram_id": 111}, {"id": 2, "telegram_id": 222}, {"id": 3, "telegram_id": 333}],
            "merchants": [{"id": 3, "name": "Bloom"}, {"id": 4, "name": "Cakes"}],
            "promo_codes": [
                code(10, "SAVE10", per_user_limit=1),
                code(11, "BIG20", value=20, min_order=20),
                code(12, "WELCOME", merchant=None, type="fixed", value=2),
                code(13, "VIP30", value=30, audience="private", per_user_limit=1),
                code(14, "CAKES5", merchant=4, type="fixed", value=5),
                code(15, "OLD", expires_at=PAST),
                code(16, "LASTONE", max_uses=1),
                code(17, "FULL", max_uses=2, used_count=2),
                code(18, "OFF", is_active=False),
            ],
            "promotions": [
                {"id": 1, "title": "Big Spender", "subtitle": "20% off $20+", "scope": "shop", "merchant_id": 3, "promo_code_id": 11, "is_active": True, "auto_apply": False, "schedule_type": "once"},
                {"id": 2, "title": "Welcome Offer", "scope": "platform", "merchant_id": None, "promo_code_id": 12, "is_active": True, "auto_apply": True, "schedule_type": "once"},
                {"id": 3, "title": "Paused", "scope": "shop", "merchant_id": 4, "promo_code_id": 14, "is_active": False, "auto_apply": False, "schedule_type": "once"},
            ],
            "promo_usages": [], "coupon_wallet": [], "notifications": [],
            "cart": [{"id": 7, "user_id": 1, "merchant_id": 3}],
            "cart_items": [{"id": 1, "cart_id": 7, "product_id": 1, "quantity": 2, "unit_price": 12.0}],
            "orders": [], "order_items": [], "products": [{"id": 1, "name": "Mug", "sku": None, "base_price": 12.0, "stock": 50}],
        }

    def from_(self, table): return Q(self, table)
    def code(self, id): return next(c for c in self.tables["promo_codes"] if c["id"] == id)
    def uses(self, code_id, user_id=None): return [u for u in self.tables["promo_usages"] if u["promo_code_id"] == code_id and (user_id is None or u["user_id"] == user_id)]
    def wallet(self, user_id): return [w["promo_code_id"] for w in self.tables["coupon_wallet"] if w["user_id"] == user_id]
    def notes(self, **m): return [n for n in self.tables["notifications"] if all(n.get(k) == v for k, v in m.items())]

    async def rpc(self, name, params):
        if not self.migrated:
            raise pg_error("PGRST202", "Could not find the function", 404)
        await asyncio.sleep(0)
        async with self._lock:                     # one transaction at a time, like FOR UPDATE on the code row
            await asyncio.sleep(0)
            if name == "claim_promo_use":
                c = self.code(params["p_code_id"]); uid = params["p_user_id"]
                if not c["is_active"]: raise pg_error("P0001", "This code is no longer valid")
                if c["expires_at"] and c["expires_at"] < datetime.now(timezone.utc).isoformat(): raise pg_error("P0001", "This code has expired")
                if c["max_uses"] is not None and c["used_count"] >= c["max_uses"]: raise pg_error("P0001", "This code has been fully used")
                if c["audience"] == "private" and params["p_code_id"] not in self.wallet(uid): raise pg_error("P0001", "This code is not valid for you")
                if c["per_user_limit"] is not None and len(self.uses(c["id"], uid)) >= c["per_user_limit"]: raise pg_error("P0001", "You have already used this code")
                c["used_count"] += 1
                self.next_id += 1
                self.tables["promo_usages"].append({"id": self.next_id, "promo_code_id": c["id"], "user_id": uid, "order_id": None, "discount_applied": params["p_discount"]})
                return self.next_id
            if name == "release_promo_use":
                u = next((u for u in self.tables["promo_usages"] if u["id"] == params["p_usage_id"]), None)
                if u:
                    self.tables["promo_usages"].remove(u); c = self.code(u["promo_code_id"]); c["used_count"] = max(c["used_count"] - 1, 0)
                return None
            if name == "release_promo_use_for_order":
                for u in [u for u in self.tables["promo_usages"] if u["order_id"] == params["p_order_id"]]:
                    self.tables["promo_usages"].remove(u); c = self.code(u["promo_code_id"]); c["used_count"] = max(c["used_count"] - 1, 0)
                return None
        raise AssertionError(name)


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
D = Decimal


# ── the rules ──────────────────────────────────────────────────────

def ok(promo, **kw):
    return coupons.check(promo, subtotal=kw.pop("subtotal", D("30")), uses_by_user=kw.pop("uses", 0), in_wallet=kw.pop("wallet", False))


def test_a_public_coupon_is_usable():
    assert ok(code(1, "A")) == (True, None)


def test_a_private_coupon_needs_the_wallet():
    private = code(1, "A", audience="private")
    assert ok(private) == (False, "This coupon is not valid for you")
    assert ok(private, wallet=True) == (True, None)


def test_expired_fully_used_and_inactive():
    assert ok(code(1, "A", expires_at=PAST))[1] == "Expired"
    assert ok(code(1, "A", max_uses=3, used_count=3))[1] == "Fully used"
    assert ok(code(1, "A", is_active=False))[1] == "This coupon is no longer available"


def test_per_customer_limit():
    once = code(1, "A", per_user_limit=1)
    assert ok(once, uses=0)[0] is True and ok(once, uses=1) == (False, "You've already used this coupon")
    assert ok(code(1, "A", per_user_limit=3), uses=3) == (False, "You've used this coupon 3 times")
    assert ok(code(1, "A", per_user_limit=None), uses=99)[0] is True   # unlimited, like a weekend sale


def test_minimum_order_says_how_much_more_to_spend():
    big = code(1, "A", min_order=20)
    assert ok(big, subtotal=D("15.80")) == (False, "Spend $4.20 more (minimum $20.00)")
    assert ok(big, subtotal=D("20")) == (True, None)
    assert ok(big, subtotal=None)[0] is True               # a list (no cart) does not check the minimum


def test_status_for_the_wallet():
    s = lambda promo, uses=0: coupons.status_of(promo, uses_by_user=uses)
    assert s(code(1, "A")) == "available"
    assert s(code(1, "A", per_user_limit=1), 1) == "used"
    assert s(code(1, "A", expires_at=PAST)) == "expired"
    assert s(code(1, "A", max_uses=1, used_count=1)) == "used_up"
    assert s(code(1, "A", is_active=False)) == "inactive"


def test_discount_wording():
    assert coupons.discount_text(code(1, "A", value=10)) == "10% off"
    assert coupons.discount_text(code(1, "A", type="fixed", value=2.5)) == "$2.5 off"


# ── using a coupon exactly as often as allowed ─────────────────────

def test_a_use_is_claimed_and_tied_to_the_order(db):
    claim = run(coupons.claim_use(db, db.code(10), 1, 2.4))
    assert db.code(10)["used_count"] == 1 and db.uses(10)[0]["order_id"] is None
    run(coupons.finish_use(db, claim, db.code(10), 1, 77, 2.4))
    assert db.uses(10)[0]["order_id"] == 77


def test_a_customer_cannot_use_a_once_only_coupon_twice(db):
    run(coupons.claim_use(db, db.code(10), 1, 1))
    with pytest.raises(BadRequestError) as err:
        run(coupons.claim_use(db, db.code(10), 1, 1))
    assert "already used" in str(getattr(err.value, "detail", err.value))
    run(coupons.claim_use(db, db.code(10), 2, 1))         # another customer still can
    assert db.code(10)["used_count"] == 2


def test_the_last_use_goes_to_exactly_one_customer(db):
    async def go():
        return await asyncio.gather(*(coupons.claim_use(db, db.code(16), uid, 1) for uid in (1, 2, 3)), return_exceptions=True)

    results = run(go())
    assert sum(isinstance(r, dict) for r in results) == 1 and sum(isinstance(r, BadRequestError) for r in results) == 2
    assert db.code(16)["used_count"] == 1                 # never over the limit


def test_one_customer_double_tapping_uses_it_once(db):
    async def go():
        return await asyncio.gather(*(coupons.claim_use(db, db.code(10), 1, 1) for _ in range(5)), return_exceptions=True)

    results = run(go())
    assert sum(isinstance(r, dict) for r in results) == 1
    assert len(db.uses(10, 1)) == 1 and db.code(10)["used_count"] == 1


def test_expired_fully_used_and_foreign_private_coupons_are_refused(db):
    for cid, msg in ((15, "expired"), (17, "fully used"), (13, "not valid for you"), (18, "no longer valid")):
        with pytest.raises(BadRequestError) as err:
            run(coupons.claim_use(db, db.code(cid), 1, 1))
        assert msg in str(getattr(err.value, "detail", err.value))


def test_a_private_coupon_works_for_whoever_holds_it(db):
    db.tables["coupon_wallet"].append({"promo_code_id": 13, "user_id": 1, "source": "granted"})
    assert "usage_id" in run(coupons.claim_use(db, db.code(13), 1, 5))
    with pytest.raises(BadRequestError):
        run(coupons.claim_use(db, db.code(13), 2, 5))      # not in Sok's wallet


def test_releasing_gives_the_use_back(db):
    claim = run(coupons.claim_use(db, db.code(10), 1, 1))
    run(coupons.release_use(db, claim))
    assert db.code(10)["used_count"] == 0 and db.uses(10) == []
    run(coupons.claim_use(db, db.code(10), 1, 1))          # the customer may use it again
    run(coupons.release_use(db, None)); run(coupons.release_use(db, {"legacy": True}))   # nothing to give back


def test_a_cancelled_orders_use_returns(db):
    claim = run(coupons.claim_use(db, db.code(10), 1, 1))
    run(coupons.finish_use(db, claim, db.code(10), 1, 77, 1))
    run(coupons.release_for_order(db, 77))
    assert db.code(10)["used_count"] == 0 and db.uses(10) == []
    run(coupons.release_for_order(db, 12345))              # an order without a coupon: nothing happens


def test_before_migration_030_use_is_recorded_the_old_way(db, caplog):
    db.migrated = False
    import logging
    with caplog.at_level(logging.ERROR):
        claim = run(coupons.claim_use(db, db.code(16), 1, 2.0))
    assert claim == {"legacy": True} and "Migration 030" in caplog.text and db.uses(16) == []
    run(coupons.finish_use(db, claim, db.code(16), 1, 77, 2.0))
    assert db.code(16)["used_count"] == 1 and db.uses(16)[0]["order_id"] == 77
    run(coupons.release_for_order(db, 77))                 # the long way round, still works
    assert db.code(16)["used_count"] == 0 and db.uses(16) == []


# ── pricing: who the quote talks to ────────────────────────────────

def validate(db, name, user_id, subtotal="24.00"):
    return run(orders_route._validate_promo(db, name, 3, D(subtotal), user_id))


def test_a_private_code_is_invisible_to_everyone_else(db):
    assert validate(db, "VIP30", 1) == (None, None, False)          # not theirs: no hint it exists
    db.tables["coupon_wallet"].append({"promo_code_id": 13, "user_id": 1, "source": "granted"})
    assert validate(db, "VIP30", 1)[0]["id"] == 13
    assert validate(db, "VIP30", 2) == (None, None, False)


def test_the_quote_says_when_a_customer_has_used_up_their_share(db):
    assert validate(db, "SAVE10", 1)[0]["id"] == 10
    db.tables["promo_usages"].append({"id": 1, "promo_code_id": 10, "user_id": 1, "order_id": 5})
    assert validate(db, "SAVE10", 1) == (None, "You've already used this promo code", True)
    assert validate(db, "SAVE10", 2)[0]["id"] == 10                 # someone else is unaffected


def test_existing_checks_keep_their_wording(db):
    assert validate(db, "OLD", 1)[1] == "Promo code has expired"
    assert validate(db, "FULL", 1)[1] == "Promo code usage limit reached"
    assert validate(db, "BIG20", 1, subtotal="10.00")[1] == "Minimum order $20.00 required for this code"


def test_an_auto_promotion_respects_the_per_customer_limit(db):
    db.tables["promotions"] = [{"id": 5, "title": "Auto", "scope": "shop", "merchant_id": 3, "promo_code_id": 10, "is_active": True, "auto_apply": True, "schedule_type": "once"}]
    items = db.tables["cart_items"]
    first = run(orders_route._best_auto_promotion(db, 3, items, D("24.00"), 1))
    assert first[0]["id"] == 10 and first[2] == D("2.40")
    db.tables["promo_usages"].append({"id": 1, "promo_code_id": 10, "user_id": 1, "order_id": 5})
    assert run(orders_route._best_auto_promotion(db, 3, items, D("24.00"), 1))[0] is None
    assert run(orders_route._best_auto_promotion(db, 3, items, D("24.00"), 2))[0]["id"] == 10


# ── placing an order with a coupon ─────────────────────────────────

@pytest.fixture
def shop(monkeypatch, db):
    import bot.notifications as bot_notifications
    import app.services.loyalty as loyalty

    state = {"promo": None, "stock_fails": False, "released": 0}

    async def noop(*a, **k): return None

    async def priced(db_, user_id, merchant_id, promo_code, delivery_type="delivery", dest=None):
        promo = state["promo"]
        total = D("24.00") - (D("2.40") if promo else 0)
        return {"cart": {"id": 7}, "items": [{"product_id": 1, "quantity": 2, "unit_price": 12.0, "selected_variants": []}],
                "promo": promo, "promo_error": None, "promo_auto": False, "subtotal": D("24.00"),
                "discount": D("2.40") if promo else D("0"), "delivery_fee": D("0"), "total": total, "distance_km": None,
                "discount_funded_by": "shop" if promo else None, "shop_open": True, "min_order": None}

    async def reserve(db_, items):
        if state["stock_fails"]:
            raise BadRequestError("Mug just sold out")

    async def release(db_, items): state["released"] += 1

    async def db_user(db_, user): return {"id": 1, "telegram_id": 111, "first_name": "Mai"}

    monkeypatch.setattr(orders_route, "_get_db_user", db_user)
    monkeypatch.setattr(orders_route, "_price_cart", priced)
    monkeypatch.setattr(orders_route.settlement, "on_order_status_changed", noop)
    monkeypatch.setattr(orders_route.settlement, "record_order_earning", noop)
    monkeypatch.setattr(inventory, "reserve_stock", reserve)
    monkeypatch.setattr(inventory, "release_stock", release)
    monkeypatch.setattr(bot_notifications, "send_order_placed_to_customer", noop)
    monkeypatch.setattr(bot_notifications, "send_order_placed_to_merchant_group", noop)
    return state


BODY = {"merchant_id": 3, "delivery_address": "Pickup at shop", "delivery_type": "pickup", "payment_method": "cod"}


def place(user=MAI):
    return run(orders_route.place_order(dict(BODY), user=user))


def test_an_order_with_a_coupon_counts_the_use_and_ties_it_to_the_order(db, shop):
    shop["promo"] = db.code(10)
    order_id = place()["data"]["order_id"]
    assert db.code(10)["used_count"] == 1
    assert [(u["user_id"], u["order_id"], u["discount_applied"]) for u in db.uses(10)] == [(1, order_id, 2.4)]


def test_a_once_only_coupon_stops_a_second_order(db, shop):
    shop["promo"] = db.code(10)
    place()
    shop["released"] = 0
    with pytest.raises(BadRequestError) as err:
        place()
    assert "already used" in str(getattr(err.value, "detail", err.value))
    assert len(db.tables["orders"]) == 1 and db.code(10)["used_count"] == 1
    assert shop["released"] == 0                          # refused before stock was touched


def test_two_customers_racing_for_the_last_use(db, shop, monkeypatch):
    shop["promo"] = db.code(16)

    async def person(db_, user): return {"id": user.telegram_id // 111, "telegram_id": user.telegram_id}
    monkeypatch.setattr(orders_route, "_get_db_user", person)

    async def go():
        return await asyncio.gather(*(orders_route.place_order(dict(BODY), user=u) for u in (MAI, SOK, DARA)), return_exceptions=True)

    results = run(go())
    assert sum(isinstance(r, dict) for r in results) == 1 and sum(isinstance(r, BadRequestError) for r in results) == 2
    assert len(db.tables["orders"]) == 1 and db.code(16)["used_count"] == 1


def test_stock_failure_gives_the_coupon_use_back(db, shop):
    shop["promo"] = db.code(10)
    shop["stock_fails"] = True
    with pytest.raises(BadRequestError):
        place()
    assert db.code(10)["used_count"] == 0 and db.uses(10) == [] and db.tables["orders"] == []


def test_order_failure_gives_back_the_coupon_and_the_stock(db, shop):
    shop["promo"] = db.code(10)
    db.fail_order_insert = True
    with pytest.raises(RuntimeError):
        place()
    assert db.code(10)["used_count"] == 0 and db.uses(10) == [] and shop["released"] == 1


def test_an_order_without_a_coupon_is_unaffected(db, shop):
    assert place()["success"] and db.tables["promo_usages"] == []


def test_the_customer_cancelling_gets_the_coupon_back(db, shop):
    shop["promo"] = db.code(10)
    order_id = place()["data"]["order_id"]
    run(orders_route.cancel_order(order_id, user=MAI))
    assert db.code(10)["used_count"] == 0 and db.uses(10) == []
    shop["promo"] = db.code(10)
    assert place()["success"]                              # and may use it again


def test_the_shop_cancelling_gets_the_coupon_back_but_delivering_does_not(db, shop):
    shop["promo"] = db.code(10)
    order_id = place()["data"]["order_id"]
    order = {"id": order_id, "status": "pending"}
    run(order_status.change_status(db, order, "confirmed", actor_type="super_admin", actor_id="1"))
    run(order_status.change_status(db, order, "processing", actor_type="super_admin", actor_id="1"))
    run(order_status.change_status(db, order, "shipped", actor_type="super_admin", actor_id="1"))
    run(order_status.change_status(db, order, "delivered", actor_type="super_admin", actor_id="1"))
    assert db.code(10)["used_count"] == 1                  # a delivered order keeps its coupon use
    shop["promo"] = db.code(11)
    other = place()["data"]["order_id"]
    run(order_status.change_status(db, {"id": other, "status": "pending"}, "cancelled", actor_type="super_admin", actor_id="1"))
    assert db.code(11)["used_count"] == 0


# ── browsing and claiming ──────────────────────────────────────────

def names(out): return [c["code"] for c in out["data"]]


def test_public_coupons_leave_out_what_cannot_be_used(db):
    out = run(route.public_coupons(user=None))
    assert set(names(out)) == {"SAVE10", "BIG20", "WELCOME", "LASTONE"}     # not private, expired, fully used, off, or paused


def test_public_coupons_carry_titles_and_shops(db):
    by = {c["code"]: c for c in run(route.public_coupons(user=None))["data"]}
    assert by["BIG20"]["title"] == "Big Spender" and by["BIG20"]["shop_name"] == "Bloom" and by["BIG20"]["min_order"] == 20.0
    assert by["WELCOME"]["shop_name"] is None and by["WELCOME"]["auto_apply"] is True      # a platform-wide one, applied by itself
    assert by["SAVE10"]["title"] == "10% off" and by["SAVE10"]["per_user_limit"] == 1
    assert by["LASTONE"]["remaining"] == 1


def test_public_coupons_can_be_narrowed_to_a_shop(db):
    assert "CAKES5" not in names(run(route.public_coupons(merchant_id=3, user=None)))
    assert set(names(run(route.public_coupons(merchant_id=3, user=None)))) == {"SAVE10", "BIG20", "WELCOME", "LASTONE"}


def test_the_list_shows_what_the_caller_has_claimed_or_used(db):
    db.tables["coupon_wallet"].append({"promo_code_id": 11, "user_id": 1, "source": "claimed"})
    db.tables["promo_usages"].append({"id": 1, "promo_code_id": 10, "user_id": 1, "order_id": 5})
    by = {c["code"]: c for c in run(route.public_coupons(user=MAI))["data"]}
    assert by["BIG20"]["claimed"] is True and by["SAVE10"]["claimed"] is False
    assert (by["SAVE10"]["used_by_me"], by["SAVE10"]["usable"], by["SAVE10"]["reason"]) == (1, False, "You've already used this coupon")
    assert by["BIG20"]["usable"] is True


def test_a_paused_promotion_hides_its_coupon(db):
    db.tables["promotions"][2]["is_active"] = True       # un-pause CAKES5's promotion
    assert "CAKES5" in names(run(route.public_coupons(user=None)))
    db.tables["promotions"][2]["is_active"] = False
    assert "CAKES5" not in names(run(route.public_coupons(user=None)))


def test_claiming_saves_the_coupon_and_is_idempotent(db):
    out = run(route.claim_coupon(11, user=MAI))
    assert out["data"]["claimed"] is True and out["data"]["code"] == "BIG20"
    run(route.claim_coupon(11, user=MAI))
    assert db.wallet(1) == [11]                            # not twice


def test_a_private_expired_or_unknown_coupon_cannot_be_claimed(db):
    for cid in (13, 15, 17, 18, 999):
        with pytest.raises(NotFoundError):
            run(route.claim_coupon(cid, user=MAI))
    assert db.wallet(1) == []
    db.tables["promotions"][0]["is_active"] = False       # BIG20's promotion is switched off
    with pytest.raises(BadRequestError):
        run(route.claim_coupon(11, user=MAI))


# ── My Coupons ─────────────────────────────────────────────────────

def test_my_coupons_lists_available_first_soonest_expiry_first(db):
    db.code(10)["expires_at"] = FUTURE
    db.code(11)["expires_at"] = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    for cid in (10, 11, 15, 12):
        db.tables["coupon_wallet"].append({"promo_code_id": cid, "user_id": 1, "source": "claimed"})
    db.tables["promo_usages"].append({"id": 1, "promo_code_id": 10, "user_id": 1, "order_id": 5})
    rows = run(route.my_coupons(user=MAI))["data"]
    # available first (soonest expiry first); the rest follow, also by expiry
    assert [(r["code"], r["status"]) for r in rows] == [("BIG20", "available"), ("WELCOME", "available"), ("OLD", "expired"), ("SAVE10", "used")]


def test_a_granted_private_coupon_shows_up_and_belongs_to_one_wallet(db):
    db.tables["coupon_wallet"].append({"promo_code_id": 13, "user_id": 1, "source": "granted"})
    mine = run(route.my_coupons(user=MAI))["data"]
    assert [(r["code"], r["source"], r["audience"]) for r in mine] == [("VIP30", "granted", "private")]
    assert run(route.my_coupons(user=SOK)) == {"data": []}


def test_my_coupons_are_only_mine(db):
    db.tables["coupon_wallet"].append({"promo_code_id": 11, "user_id": 2, "source": "claimed"})
    assert run(route.my_coupons(user=MAI)) == {"data": []}


# ── choosing a coupon at checkout ──────────────────────────────────

def eligible(user=MAI, merchant_id=3):
    return run(route.eligible_coupons(merchant_id, user=user))


def test_checkout_lists_usable_coupons_best_first_with_reasons(db):
    out = eligible()
    by = {c["code"]: c for c in out["data"]}
    assert out["subtotal"] == 24.0
    assert (by["SAVE10"]["eligible"], by["SAVE10"]["discount"]) == (True, 2.4)
    assert (by["BIG20"]["eligible"], by["BIG20"]["discount"]) == (True, 4.8)          # 20% of $24
    assert out["best_id"] == 11 and out["data"][0]["code"] == "BIG20"
    assert "WELCOME" not in by                              # applies by itself, nothing to pick
    assert "VIP30" not in by and "OLD" not in by and "FULL" not in by and "OFF" not in by


def test_coupons_you_cannot_use_yet_say_why(db):
    db.tables["cart_items"][0]["unit_price"] = 7.5          # a $15 cart
    by = {c["code"]: c for c in eligible()["data"]}
    assert (by["BIG20"]["eligible"], by["BIG20"]["reason"], by["BIG20"]["discount"]) == (False, "Spend $5.00 more (minimum $20.00)", 0.0)
    assert by["SAVE10"]["eligible"] is True


def test_used_coupons_are_shown_as_used(db):
    db.tables["promo_usages"].append({"id": 1, "promo_code_id": 10, "user_id": 1, "order_id": 5})
    by = {c["code"]: c for c in eligible()["data"]}
    assert (by["SAVE10"]["eligible"], by["SAVE10"]["reason"]) == (False, "You've already used this coupon")


def test_a_private_coupon_appears_only_for_the_customer_who_holds_it(db):
    db.tables["coupon_wallet"].append({"promo_code_id": 13, "user_id": 1, "source": "granted"})
    by = {c["code"]: c for c in eligible()["data"]}
    assert (by["VIP30"]["eligible"], by["VIP30"]["discount"], by["VIP30"]["in_wallet"]) == (True, 7.2, True)
    assert out_best(eligible()) == 13                       # 30% is the best deal
    db.tables["cart"].append({"id": 8, "user_id": 2, "merchant_id": 3})
    assert "VIP30" not in {c["code"] for c in eligible(user=SOK)["data"]}


def out_best(out): return out["best_id"]


def test_checkout_only_offers_this_shops_and_platform_coupons(db):
    assert "CAKES5" not in {c["code"] for c in eligible()["data"]}
    db.tables["promotions"][2]["is_active"] = True
    assert {c["code"] for c in eligible(merchant_id=4)["data"]} == {"CAKES5"}   # an empty cart at another shop: only its own


def test_an_empty_cart_shows_what_would_apply(db):
    db.tables["cart"].clear(); db.tables["cart_items"].clear()
    out = eligible()
    assert out["subtotal"] == 0.0 and out["best_id"] is None
    assert next(c for c in out["data"] if c["code"] == "BIG20")["reason"].startswith("Spend $20.00 more")


# ── giving coupons to customers ────────────────────────────────────

def grant(user, code_id=13, **body): return run(route.grant_coupon(code_id, GrantRequest(**body), user=user))


def test_a_shop_gives_its_private_coupon_to_customers_and_they_are_told(db):
    out = grant(BLOOM, user_ids=[1], telegram_ids=[222])
    assert (out["granted"], out["already_had"], out["not_found"]) == (2, 0, [])
    assert sorted(db.wallet(1) + db.wallet(2)) == [13, 13] and db.tables["coupon_wallet"][0]["source"] == "granted"
    note = db.notes(user_id=1)[0]
    assert (note["title"], note["link"], note["kind"]) == ("You got a coupon", "/shop/coupons", "promo") and "30% off" in note["body"]


def test_granting_twice_does_not_duplicate_or_renotify(db):
    grant(BLOOM, user_ids=[1])
    out = grant(BLOOM, user_ids=[1, 3])
    assert (out["granted"], out["already_had"]) == (1, 1)
    assert len(db.notes(user_id=1)) == 1 and len(db.tables["coupon_wallet"]) == 2


def test_unknown_customers_are_reported(db):
    out = grant(BLOOM, user_ids=[1, 999], telegram_ids=[424242])
    assert out["granted"] == 1 and sorted(out["not_found"]) == [999, 424242]


def test_a_shop_cannot_give_another_shops_coupon(db):
    with pytest.raises(ForbiddenError):
        grant(CAKES, code_id=13, user_ids=[1])
    assert db.tables["coupon_wallet"] == []
    assert grant(SUPER, code_id=13, user_ids=[1])["granted"] == 1       # the platform may give any
    assert grant(SUPER, code_id=12, user_ids=[1])["granted"] == 1       # including a platform-wide one


def test_granting_needs_a_customer_and_a_real_coupon(db):
    with pytest.raises(ValidationError):
        GrantRequest()
    with pytest.raises(NotFoundError):
        grant(SUPER, code_id=999, user_ids=[1])


# ── setting coupons up (the promotion form) ────────────────────────

def promo_in(**kw):
    base = {"title": "Sale", "scope": "shop", "code": "SALE", "discount_type": "percent", "discount_value": 10, "auto_apply": False}
    return promotions_route.PromotionIn(**{**base, **kw})


def test_the_promotion_form_defaults_to_a_public_unlimited_coupon():
    p = promo_in()
    assert (p.audience, p.per_user_limit) == ("public", None)


def test_a_private_coupon_needs_a_code_and_cannot_apply_by_itself():
    assert promo_in(audience="private", per_user_limit=1).audience == "private"
    with pytest.raises(ValidationError):
        promo_in(audience="private", auto_apply=True)
    with pytest.raises(ValidationError):
        promo_without_code()
    with pytest.raises(ValidationError):
        promo_in(audience="secret")
    with pytest.raises(ValidationError):
        promo_in(per_user_limit=0)


def promo_without_code():
    return promotions_route.PromotionIn(title="x", scope="shop", audience="private", auto_apply=False)


def test_saving_a_coupon_keeps_working_before_migration_030(db):
    db.migrated = False
    row = {"merchant_id": 3, "code": "SALE", "type": "percent", "value": 10, "min_order": 0, "max_uses": None,
           "expires_at": None, "is_active": True, "audience": "public", "per_user_limit": None}
    new_id = run(promotions_route._write_code(db, None, dict(row), promo_in()))           # a plain coupon still saves
    assert db.code(new_id)["code"] == "SALE"
    run(promotions_route._write_code(db, new_id, {**row, "value": 15}, promo_in()))       # and edits
    assert db.code(new_id)["value"] == 15
    with pytest.raises(BadRequestError) as err:                                           # but a private one says what to run
        run(promotions_route._write_code(db, None, dict(row, audience="private"), promo_in(audience="private")))
    assert "030_coupons.sql" in str(getattr(err.value, "detail", err.value))
    with pytest.raises(BadRequestError):
        run(promotions_route._write_code(db, None, dict(row, per_user_limit=1), promo_in(per_user_limit=1)))


def test_with_the_migration_the_new_settings_are_saved(db):
    row = {"merchant_id": 3, "code": "VIP", "type": "percent", "value": 10, "min_order": 0, "max_uses": None,
           "expires_at": None, "is_active": True, "audience": "private", "per_user_limit": 2}
    new_id = run(promotions_route._write_code(db, None, row, promo_in(audience="private", per_user_limit=2)))
    assert (db.code(new_id)["audience"], db.code(new_id)["per_user_limit"]) == ("private", 2)


# ── before migration 030 ───────────────────────────────────────────

def test_browsing_works_before_migration_030(db):
    db.migrated = False
    for c in db.tables["promo_codes"]:
        c.pop("audience"); c.pop("per_user_limit")
    out = run(route.public_coupons(user=MAI))
    assert {c["code"] for c in out["data"]} == {"SAVE10", "BIG20", "WELCOME", "LASTONE", "VIP30"}   # no audience yet: all public
    assert run(route.my_coupons(user=MAI)) == {"data": []}
    assert run(coupons.wallet_code_ids(db, 1)) == set()
    with pytest.raises(BadRequestError) as err:
        run(route.claim_coupon(11, user=MAI))
    assert "not set up" in str(getattr(err.value, "detail", err.value))
    with pytest.raises(BadRequestError):
        grant(SUPER, user_ids=[1])


# ── the HTTP layer ─────────────────────────────────────────────────

def bearer(role, **kw): return {"Authorization": "Bearer " + mint_jwt(sub="1", role=role, **kw)}


def test_who_may_call_what(db):
    c = TestClient(app)
    cust, shop_admin = bearer(Role.USER, telegram_id=111), bearer(Role.MERCHANT_ADMIN, merchant_id=3)
    assert c.get("/api/coupons/public").status_code == 200                                 # browsing is open
    assert c.get("/api/coupons/mine").status_code == 401
    assert c.post("/api/coupons/11/claim").status_code == 401
    assert c.get("/api/coupons/eligible?merchant_id=3").status_code == 401
    assert c.get("/api/coupons/mine", headers=shop_admin).status_code == 403              # a shop login has no wallet
    assert c.post("/api/coupons/13/grant", headers=cust, json={"user_ids": [1]}).status_code == 403
    assert c.post("/api/coupons/13/grant", headers=shop_admin, json={"user_ids": [1]}).status_code == 200
    assert c.post("/api/coupons/13/grant", headers=shop_admin, json={}).status_code == 422
    assert c.post("/api/coupons/11/claim", headers=cust).status_code == 200
    assert c.get("/api/coupons/mine", headers=cust).json()["data"][0]["code"] in {"BIG20", "VIP30"}
    assert c.get("/api/coupons/eligible?merchant_id=3", headers=cust).status_code == 200


# ── a private coupon never leaks through the older public endpoints ─

from app.routes import promos as promos_route  # noqa: E402


def private_promotion(db):
    db.tables["promotions"].append({"id": 4, "title": "Secret VIP", "scope": "shop", "merchant_id": 3, "promo_code_id": 13, "is_active": True,
                                    "auto_apply": False, "schedule_type": "once", "display_locations": ["home_promotions"], "sort_order": 0})


def test_the_home_carousel_never_shows_a_private_coupons_promotion(db):
    private_promotion(db)
    titles = [p["title"] for p in run(promotions_route.list_promotions())]
    assert "Secret VIP" not in titles and "Big Spender" in titles
    assert all("VIP30" not in str(p) for p in run(promotions_route.list_promotions()))


def test_a_private_coupons_promotion_page_does_not_exist_publicly(db):
    private_promotion(db)
    with pytest.raises(NotFoundError):
        run(promotions_route.get_promotion(4))
    assert run(promotions_route.get_promotion(1))["title"] == "Big Spender"


def test_the_admin_sees_a_promotions_audience_and_limit(db):
    private_promotion(db)
    rows = run(promotions_route._enrich(db, [dict(db.tables["promotions"][3], is_live=True)]))
    assert (rows[0]["offer"]["audience"], rows[0]["offer"]["per_user_limit"], rows[0]["offer"]["id"]) == ("private", 1, 13)


def test_promotions_still_load_before_migration_030(db):
    db.migrated = False
    for c in db.tables["promo_codes"]:
        c.pop("audience"); c.pop("per_user_limit")
    rows = run(promotions_route.list_promotions())
    assert "Big Spender" in [p["title"] for p in rows]
    assert "audience" not in next(p for p in rows if p["title"] == "Big Spender")["offer"]


def test_the_older_public_code_list_hides_private_codes(db):
    db.tables["promotions"] = []                     # plain codes, no promotion behind them
    shown = [p["code"] for p in run(promos_route.list_active_promos())]
    assert "SAVE10" in shown and "VIP30" not in shown


def test_the_older_validate_endpoint_does_not_know_a_private_code(db):
    from app.models.order import PromoValidateRequest
    body = PromoValidateRequest(code="VIP30", merchant_id=3, cart_total=24.0)
    with pytest.raises(NotFoundError):
        run(promos_route.validate_promo(body, user=MAI))
    db.tables["coupon_wallet"].append({"promo_code_id": 13, "user_id": 1, "source": "granted"})
    assert run(promos_route.validate_promo(body, user=MAI))["data"]["discount_amount"] == 7.2
    with pytest.raises(NotFoundError):
        run(promos_route.validate_promo(body, user=SOK))
