"""Loyalty Program: points are earned once, after delivery, on what the customer paid; they can be spent as a
coupon; shops can opt out; and the platform can see whether it can afford it (database faked).

The fake database keeps what matters: updates only apply when the filters still match (so a concurrent
change makes a write miss, like a conditional UPDATE), the two partial unique indexes of migration 031 exist,
every call yields to other tasks, and with `migrated=False` the new columns are missing as before migration 031.
"""

import asyncio
import functools
from decimal import Decimal

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.constants import Role
from app.core.exceptions import BadRequestError
from app.core.security import mint_jwt
from app.db.client import SupabaseClient
from app.main import app
from app.services import loyalty, notify, order_status

SETTINGS = {"id": 1, "is_enabled": True, "points_per_dollar": 10.0, "points_value_cents": 1, "min_redeem_points": 100,
            "bronze_threshold": 0, "silver_threshold": 300, "gold_threshold": 1500, "silver_multiplier": 1.5,
            "gold_multiplier": 2.0, "redeem_coupon_days": 30}


def arun(fn):
    """Run an async test to completion (this project's tests use asyncio.run, not a plugin)."""
    @functools.wraps(fn)
    def wrapper(*a, **k):
        return asyncio.run(fn(*a, **k))
    return wrapper


def pg_error(code, message="error", status=400):
    req = httpx.Request("POST", "http://db/x")
    return httpx.HTTPStatusError("e", request=req, response=httpx.Response(status, json={"code": code, "message": message}, request=req))


class Q:
    def __init__(self, db, table):
        self.db, self.table, self.f = db, table, []

    def eq(self, col, val): self.f.append(("eq", col, val)); return self
    def in_(self, col, vals): self.f.append(("in", col, list(vals))); return self
    def order(self, *a, **k): return self
    def limit(self, n): return self

    def _check(self, cols=(), data=None):
        if self.db.migrated:
            return
        touched = set(cols) | {c for _, c, _ in self.f} | set(data or {})
        if self.table == "merchants" and "loyalty_enabled" in touched:
            raise pg_error("42703", "column merchants.loyalty_enabled does not exist")
        if self.table == "points_transactions" and "promo_code_id" in touched:
            raise pg_error("PGRST204", "Could not find the 'promo_code_id' column of 'points_transactions' in the schema cache")
        if self.table == "loyalty_settings" and "redeem_coupon_days" in touched:
            raise pg_error("PGRST204", "Could not find the 'redeem_coupon_days' column")

    def _rows(self):
        out = []
        for r in self.db.tables.setdefault(self.table, []):
            ok = True
            for op, col, val in self.f:
                ok &= (r.get(col) == val) if op == "eq" else (r.get(col) in val)
            if ok:
                out.append(r)
        return out

    async def select(self, cols="*"):
        self._check(str(cols).split(",") if cols != "*" else ()); await asyncio.sleep(0)
        return [dict(r) for r in self._rows()]

    async def select_one(self, cols="*"):
        rows = await self.select(cols)
        return rows[0] if rows else None

    async def insert(self, data):
        self._check(data=data); await asyncio.sleep(0)
        rows = self.db.tables.setdefault(self.table, [])
        if self.db.fail_on_insert == self.table:
            raise RuntimeError("database down")
        if self.table == "points_transactions" and data.get("order_id") and data["type"] in ("earn", "reversal"):
            if any(r.get("order_id") == data["order_id"] and r["type"] == data["type"] for r in rows):
                raise pg_error("23505", "duplicate key value violates unique constraint", 409)
        if self.table == "promo_codes" and any(r["code"] == data["code"] for r in rows):
            raise pg_error("23505", "duplicate key", 409)
        if self.table == "loyalty_accounts" and any(r["user_id"] == data["user_id"] for r in rows):
            raise pg_error("23505", "duplicate key", 409)
        self.db.next_id += 1
        new = {"id": self.db.next_id, **data}
        rows.append(new)
        return [dict(new)]

    async def delete(self):
        await asyncio.sleep(0)
        gone = self._rows()
        self.db.tables[self.table] = [r for r in self.db.tables[self.table] if r not in gone]

    async def update(self, data):
        self._check(data=data); await asyncio.sleep(0)
        rows = self._rows()
        for r in rows: r.update(data)
        return [dict(r) for r in rows]


class Db:
    def __init__(self, migrated=True, **settings):
        self.migrated, self.next_id, self.fail_on_insert = migrated, 1000, None
        self.tables = {
            "loyalty_settings": [{**SETTINGS, **settings}],
            "loyalty_accounts": [{"id": 1, "user_id": 1, "balance": 0, "lifetime_points": 0, "tier": "bronze"}],
            "points_transactions": [],
            "merchants": [{"id": 3, "name": "Bloom", "loyalty_enabled": True}, {"id": 4, "name": "Cakes", "loyalty_enabled": True}],
            "orders": [
                {"id": 100, "user_id": 1, "merchant_id": 3, "total": 12.50, "status": "delivered"},
                {"id": 101, "user_id": 1, "merchant_id": 3, "total": 30.00, "status": "pending"},
                {"id": 102, "user_id": 1, "merchant_id": 4, "total": 20.00, "status": "delivered"},
            ],
            "promo_codes": [], "coupon_wallet": [], "notifications": [],
        }

    def from_(self, table):
        return Q(self, table)

    def acct(self, uid=1):
        return next(a for a in self.tables["loyalty_accounts"] if a["user_id"] == uid)

    def txns(self, kind=None):
        return [t for t in self.tables["points_transactions"] if kind is None or t["type"] == kind]

    def set_order(self, oid, **kw):
        next(o for o in self.tables["orders"] if o["id"] == oid).update(kw)

    def shop(self, mid, **kw):
        next(m for m in self.tables["merchants"] if m["id"] == mid).update(kw)


# ── the rules: what is earned and what a point is worth ────────────

def test_points_follow_the_amount_paid_and_the_tier():
    ls = SETTINGS
    assert loyalty.points_for(12.5, "bronze", ls) == 125
    assert loyalty.points_for(12.5, "silver", ls) == 187          # 125 x 1.5, whole points
    assert loyalty.points_for(12.5, "gold", ls) == 250
    assert loyalty.points_for(0, "gold", ls) == 0
    assert loyalty.points_for(Decimal("0.09"), "bronze", ls) == 0  # nothing for fractions of a point


def test_tier_follows_lifetime_points():
    assert [loyalty.tier_for(n, SETTINGS) for n in (0, 299, 300, 1499, 1500)] == ["bronze", "bronze", "silver", "silver", "gold"]


def test_a_point_is_worth_what_the_settings_say():
    assert loyalty.points_to_dollars(500, SETTINGS) == Decimal("5.00")
    assert loyalty.points_to_dollars(150, {**SETTINGS, "points_value_cents": 2}) == Decimal("3.00")


# ── earning: only after delivery, on the order total, once ─────────

@arun
async def test_a_delivered_order_earns_points_on_what_was_paid():
    db = Db()
    r = await loyalty.award_for_order(db, 100)
    assert r["points_earned"] == 125 and r["new_balance"] == 125
    assert db.acct()["balance"] == 125 and db.acct()["lifetime_points"] == 125
    t = db.txns("earn")[0]
    assert (t["order_id"], t["points"], t["balance_after"]) == (100, 125, 125)


@arun
async def test_an_order_that_is_not_delivered_earns_nothing():
    db = Db()
    for status in ("pending", "confirmed", "processing", "shipped", "cancelled"):
        db.set_order(101, status=status)
        assert await loyalty.award_for_order(db, 101) is None
    assert db.acct()["balance"] == 0 and not db.txns()


@arun
async def test_the_same_order_pays_only_once():
    db = Db()
    assert await loyalty.award_for_order(db, 100)
    assert await loyalty.award_for_order(db, 100) is None
    assert db.acct()["balance"] == 125 and len(db.txns("earn")) == 1


@arun
async def test_two_requests_paying_one_order_at_once_pay_it_once():
    db = Db()
    results = await asyncio.gather(*[loyalty.award_for_order(db, 100) for _ in range(6)])
    assert db.acct()["balance"] == 125 and db.acct()["lifetime_points"] == 125
    assert len(db.txns("earn")) == 1
    assert sum(1 for r in results if r) == 1


@arun
async def test_two_orders_delivered_at_the_same_time_both_count():
    db = Db()
    await asyncio.gather(loyalty.award_for_order(db, 100), loyalty.award_for_order(db, 102))
    assert db.acct()["balance"] == 125 + 200 and len(db.txns("earn")) == 2


@arun
async def test_a_higher_tier_earns_more_and_the_tier_rises_with_lifetime_points():
    db = Db()
    db.acct().update(balance=290, lifetime_points=290)
    r = await loyalty.award_for_order(db, 100)          # bronze at the time: 125 points, 415 lifetime
    assert r["points_earned"] == 125 and r["tier"] == "silver"
    r2 = await loyalty.award_for_order(db, 102)         # now silver: 200 x 1.5
    assert r2["points_earned"] == 300 and "1.5" in db.txns("earn")[1]["description"]


@arun
async def test_the_program_switched_off_earns_nothing():
    db = Db(is_enabled=False)
    assert await loyalty.award_for_order(db, 100) is None and not db.txns()


@arun
async def test_a_shop_that_opted_out_earns_nothing_but_other_shops_still_do():
    db = Db()
    db.shop(3, loyalty_enabled=False)
    assert await loyalty.award_for_order(db, 100) is None      # Bloom opted out
    assert (await loyalty.award_for_order(db, 102))["points_earned"] == 200   # Cakes did not


@arun
async def test_before_the_migration_every_shop_takes_part():
    db = Db(migrated=False)
    assert await loyalty.shop_takes_part(db, 3) is True
    assert (await loyalty.award_for_order(db, 100))["points_earned"] == 125


@arun
async def test_points_already_paid_at_placement_are_not_paid_again():
    db = Db()
    db.tables["points_transactions"].append({"id": 1, "loyalty_account_id": 1, "type": "earn", "points": 125, "order_id": 100, "balance_after": 125})
    assert await loyalty.award_for_order(db, 100) is None and db.acct()["balance"] == 0 + 0


@arun
async def test_a_lost_race_on_the_unique_index_takes_back_what_it_added():
    """Both passed the 'already paid?' check; the index lets only one row in, the other gives its points back."""
    db = Db()
    original = loyalty._txn
    async def blind(db_, oid, kind):          # make the early check miss
        return None
    loyalty._txn = blind
    try:
        a, b = await asyncio.gather(loyalty.award_for_order(db, 100), loyalty.award_for_order(db, 100))
    finally:
        loyalty._txn = original
    assert db.acct()["balance"] == 125 and db.acct()["lifetime_points"] == 125 and len(db.txns("earn")) == 1
    assert sum(1 for r in (a, b) if r) == 1


# ── cancelling takes the points back, once ─────────────────────────

@arun
async def test_a_cancelled_order_gives_its_points_back_once():
    db = Db()
    await loyalty.award_for_order(db, 100)
    r = await loyalty.reverse_for_order(db, 100)
    assert r == {"points_returned": 125, "new_balance": 0}
    assert db.acct()["balance"] == 0 and db.acct()["lifetime_points"] == 0
    assert await loyalty.reverse_for_order(db, 100) is None
    assert db.txns("reversal")[0]["points"] == -125 and len(db.txns("reversal")) == 1


@arun
async def test_cancelling_an_order_that_earned_nothing_changes_nothing():
    db = Db()
    assert await loyalty.reverse_for_order(db, 101) is None and not db.txns()


@arun
async def test_reversal_never_leaves_a_negative_balance_and_can_drop_a_tier():
    db = Db()
    db.acct().update(balance=0, lifetime_points=290)
    await loyalty.award_for_order(db, 100)                       # 415 lifetime -> silver
    assert db.acct()["tier"] == "silver"
    db.acct().update(balance=20)                                  # the rest was spent
    await loyalty.reverse_for_order(db, 100)
    assert db.acct()["balance"] == 0 and db.acct()["lifetime_points"] == 290 and db.acct()["tier"] == "bronze"


@arun
async def test_two_cancels_at_once_return_the_points_once():
    db = Db()
    await loyalty.award_for_order(db, 100)
    await asyncio.gather(*[loyalty.reverse_for_order(db, 100) for _ in range(5)])
    assert db.acct()["balance"] == 0 and len(db.txns("reversal")) == 1


# ── spending: points become a coupon ───────────────────────────────

def rich(db, balance=1000):
    db.acct().update(balance=balance, lifetime_points=balance)


@arun
async def test_redeeming_points_makes_a_private_single_use_coupon_in_my_coupons():
    db = Db(); rich(db)
    r = await loyalty.redeem_for_coupon(db, 1, 500)
    assert r["discount_amount"] == 5.0 and r["remaining_balance"] == 500 and r["coupon"]["code"].startswith("PTS-")
    c = db.tables["promo_codes"][0]
    assert (c["type"], c["value"], c["max_uses"], c["per_user_limit"], c["audience"], c["merchant_id"]) == ("fixed", 5.0, 1, 1, "private", None)
    assert c["expires_at"] and c["is_active"] is True
    w = db.tables["coupon_wallet"][0]
    assert (w["promo_code_id"], w["user_id"]) == (c["id"], 1)
    t = db.txns("redeem")[0]
    assert (t["points"], t["balance_after"], t["promo_code_id"]) == (-500, 500, c["id"])
    assert db.acct()["balance"] == 500 and db.acct()["lifetime_points"] == 1000   # lifetime (tier) is untouched


@arun
async def test_redeeming_checks_the_minimum_the_balance_and_the_program():
    db = Db(); rich(db, 150)
    with pytest.raises(BadRequestError, match="at least 100"):
        await loyalty.redeem_for_coupon(db, 1, 99)
    with pytest.raises(BadRequestError, match="enough points"):
        await loyalty.redeem_for_coupon(db, 1, 151)
    off = Db(is_enabled=False); rich(off)
    with pytest.raises(BadRequestError, match="not enabled"):
        await loyalty.redeem_for_coupon(off, 1, 500)
    assert db.acct()["balance"] == 150 and not db.tables["promo_codes"] and not db.txns()


@arun
async def test_the_same_points_cannot_be_spent_twice_at_once():
    db = Db(); rich(db, 600)
    results = await asyncio.gather(*[loyalty.redeem_for_coupon(db, 1, 500) for _ in range(4)], return_exceptions=True)
    ok = [r for r in results if isinstance(r, dict)]
    assert len(ok) == 1 and all(isinstance(r, BadRequestError) for r in results if not isinstance(r, dict))
    assert db.acct()["balance"] == 100 and len(db.tables["promo_codes"]) == 1 and len(db.txns("redeem")) == 1


@arun
async def test_a_failed_redemption_returns_the_points_and_switches_the_coupon_off():
    db = Db(); rich(db)
    db.fail_on_insert = "coupon_wallet"
    with pytest.raises(RuntimeError):
        await loyalty.redeem_for_coupon(db, 1, 500)
    assert db.acct()["balance"] == 1000 and not db.txns()
    assert all(c["is_active"] is False for c in db.tables["promo_codes"])    # nobody can use the half-made coupon


@arun
async def test_redeeming_works_before_the_migration_just_without_the_link():
    db = Db(migrated=False); rich(db)
    r = await loyalty.redeem_for_coupon(db, 1, 500)
    assert r["remaining_balance"] == 500 and "promo_code_id" not in db.txns("redeem")[0]


@arun
async def test_a_code_clash_is_retried():
    db = Db(); rich(db)
    db.tables["promo_codes"].append({"id": 1, "code": "PTS-AAAAAA"})
    codes = iter(["PTS-AAAAAA", "PTS-BBBBBB"])
    original = loyalty._new_code
    loyalty._new_code = lambda: next(codes)
    try:
        r = await loyalty.redeem_for_coupon(db, 1, 500)
    finally:
        loyalty._new_code = original
    assert r["coupon"]["code"] == "PTS-BBBBBB"


# ── delivery / cancellation hooks and the customer's message ───────

@arun
async def test_delivery_pays_points_and_tells_the_customer_once():
    db = Db()
    sent = []
    async def fake_notify(db_, uid, kind, title, body, **kw): sent.append((uid, kind, title, kw.get("dedupe_key")))
    original = notify.notify_user
    notify.notify_user = fake_notify
    try:
        await loyalty.on_order_delivered(db, 100)
    finally:
        notify.notify_user = original
    assert sent == [(1, "loyalty", "You earned 125 points", "points:100")]


@arun
async def test_a_failure_in_the_loyalty_step_never_breaks_a_delivery():
    db = Db()
    db.fail_on_insert = "points_transactions"
    await loyalty.on_order_delivered(db, 100)          # must not raise
    await loyalty.on_order_cancelled(db, 100)          # must not raise


# ── what is on the way ─────────────────────────────────────────────

@arun
async def test_pending_points_count_open_orders_of_shops_in_the_program():
    db = Db()
    db.tables["orders"].append({"id": 103, "user_id": 1, "merchant_id": 4, "total": 10.0, "status": "shipped"})
    assert await loyalty.pending_points(db, 1) == {"points": 300 + 100, "orders": 2}
    db.shop(4, loyalty_enabled=False)
    assert await loyalty.pending_points(db, 1) == {"points": 300, "orders": 1}
    assert await loyalty.pending_points(Db(is_enabled=False), 1) == {"points": 0, "orders": 0}


# ── can the platform afford it? ────────────────────────────────────

def test_verdict_compares_the_rebate_with_the_commission():
    assert loyalty._verdict(1.0, 10) == "healthy"      # gives back 10% of the commission
    assert loyalty._verdict(4.0, 10) == "healthy"      # exactly the comfort line
    assert loyalty._verdict(6.0, 10) == "tight"
    assert loyalty._verdict(10.0, 10) == "tight"
    assert loyalty._verdict(12.0, 10) == "loss"
    assert loyalty._verdict(1.0, 0) == "loss" and loyalty._verdict(0, 0) == "healthy"


@arun
async def test_sustainability_for_the_current_settings():
    db = Db()
    rich(db, 40000)
    s = await loyalty.sustainability(db)
    assert s["tiers"]["bronze"]["rebate_pct"] == 10.0                 # 10 pts/$ x 1 cent = 10% back
    assert s["tiers"]["gold"]["rebate_pct"] == 20.0                   # gold earns double
    assert s["max_rebate_pct"] == 20.0 and s["verdict"] == "loss"     # more than the whole commission
    assert s["recommended_points_per_dollar"] < SETTINGS["points_per_dollar"]
    assert s["recommended_max_rebate_pct"] <= s["commission_pct"] * 0.4 + 0.01
    assert s["actual"]["liability"] == 400.0 and s["actual"]["delivered_revenue"] == 32.5


@arun
async def test_a_gentle_setting_is_healthy():
    db = Db(points_per_dollar=1.0)
    s = await loyalty.sustainability(db)
    assert s["verdict"] == "healthy" and s["tiers"]["bronze"]["net_pct"] > 0


# ── wired into the order lifecycle ─────────────────────────────────

async def _transition(db, oid, new, monkeypatch):
    from app.services import coupons, deliveries, inventory, settlement
    async def noop(*a, **k): return None
    for mod, name in ((settlement, "on_order_status_changed"), (deliveries, "order_cancelled"), (deliveries, "order_delivered"),
                      (notify, "order_status_changed"), (inventory, "release_stock"), (coupons, "release_for_order")):
        monkeypatch.setattr(mod, name, noop)
    order = next(o for o in db.tables["orders"] if o["id"] == oid)
    return await order_status.change_status(db, dict(order), new, actor_type="admin", actor_id="1")


@arun
async def test_marking_an_order_delivered_pays_points(monkeypatch):
    db = Db()
    db.set_order(101, status="shipped")
    await _transition(db, 101, "delivered", monkeypatch)
    assert db.acct()["balance"] == 300 and db.txns("earn")[0]["order_id"] == 101


@arun
async def test_cancelling_an_open_order_returns_points_it_was_paid_when_placed(monkeypatch):
    """Orders placed before this change earned points up front; cancelling one must take them back."""
    db = Db()
    db.acct().update(balance=300, lifetime_points=300)
    db.tables["points_transactions"].append({"id": 1, "loyalty_account_id": 1, "type": "earn", "points": 300, "order_id": 101, "balance_after": 300})
    await _transition(db, 101, "cancelled", monkeypatch)
    assert db.acct()["balance"] == 0 and len(db.txns("reversal")) == 1


@arun
async def test_cancelling_before_delivery_never_touches_points(monkeypatch):
    db = Db()
    await _transition(db, 101, "cancelled", monkeypatch)
    assert db.acct()["balance"] == 0 and not db.txns()


def test_placing_an_order_no_longer_earns_points():
    import inspect
    from app.routes import orders
    assert "earn_points" not in inspect.getsource(orders) and not hasattr(loyalty, "earn_points")


# ── HTTP: who may do what ──────────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    db = Db()
    from contextlib import asynccontextmanager
    @asynccontextmanager
    async def fake():
        yield db
    monkeypatch.setattr(SupabaseClient, "service_role", staticmethod(fake))
    db.tables["users"] = [{"id": 1, "telegram_id": 111, "username": "u", "first_name": "U", "last_name": None}]
    return TestClient(app), db


def hdr(role, **kw):
    return {"Authorization": "Bearer " + mint_jwt(sub="1", role=role, expires_in=600, **kw)}


def test_only_the_super_admin_runs_the_program(client):
    c, _ = client
    shop = hdr(Role.MERCHANT_ADMIN, merchant_id=3)
    cust = hdr(Role.USER, telegram_id=111)
    for method, path, body in (("put", "/api/loyalty/admin/settings", SETTINGS), ("get", "/api/loyalty/admin/accounts", None),
                               ("post", "/api/loyalty/admin/backfill", None), ("get", "/api/loyalty/admin/sustainability", None),
                               ("get", "/api/loyalty/admin/stats", None),
                               ("post", "/api/loyalty/admin/adjust", {"account_id": 1, "points": 5000})):
        for h in (shop, cust):
            assert getattr(c, method)(path, headers=h, **({"json": body} if body else {})).status_code == 403, (method, path)
    assert c.get("/api/loyalty/admin/sustainability", headers=hdr(Role.SUPER_ADMIN)).status_code == 200


def test_a_shop_switches_rewards_for_its_own_shop_only(client):
    c, db = client
    r = c.put("/api/loyalty/shop", headers=hdr(Role.MERCHANT_ADMIN, merchant_id=3), json={"enabled": False})
    assert r.status_code == 200 and r.json() == {"enabled": False}
    assert db.tables["merchants"][0]["loyalty_enabled"] is False and db.tables["merchants"][1]["loyalty_enabled"] is True
    assert c.get("/api/loyalty/shop", headers=hdr(Role.MERCHANT_ADMIN, merchant_id=3)).json() == {"enabled": False}
    assert c.put("/api/loyalty/shop", headers=hdr(Role.USER, telegram_id=111), json={"enabled": False}).status_code == 403


def test_shop_switch_before_the_migration_says_what_to_run(client):
    c, db = client
    db.migrated = False
    r = c.put("/api/loyalty/shop", headers=hdr(Role.MERCHANT_ADMIN, merchant_id=3), json={"enabled": False})
    assert r.status_code == 400 and "031_loyalty.sql" in r.text


def test_a_customer_redeems_over_http_and_sees_pending_points(client):
    c, db = client
    db.acct().update(balance=1000, lifetime_points=1000)
    h = hdr(Role.USER, telegram_id=111)
    r = c.post("/api/loyalty/redeem", headers=h, json={"points": 500})
    assert r.status_code == 200 and r.json()["data"]["coupon"]["code"].startswith("PTS-")
    assert c.post("/api/loyalty/redeem", headers=h, json={"points": 9999}).status_code == 400
    assert c.get("/api/loyalty/pending", headers=h).json() == {"points": 300, "orders": 1}


def test_backfill_pays_only_delivered_orders_that_were_never_paid(client):
    c, db = client
    db.tables["points_transactions"].append({"id": 1, "loyalty_account_id": 1, "type": "earn", "points": 125, "order_id": 100, "balance_after": 125})
    r = c.post("/api/loyalty/admin/backfill", headers=hdr(Role.SUPER_ADMIN))
    assert r.status_code == 200 and r.json() == {"backfilled": 1, "skipped": 1, "errors": 0}
    assert {t["order_id"] for t in db.txns("earn")} == {100, 102}      # the pending order 101 was left alone


def test_settings_save_and_coupon_validity_before_the_migration(client):
    c, db = client
    body = {k: v for k, v in SETTINGS.items() if k not in ("id", "redeem_coupon_days")}
    assert c.put("/api/loyalty/admin/settings", headers=hdr(Role.SUPER_ADMIN), json={**body, "redeem_coupon_days": 14}).status_code == 200
    db.migrated = False
    assert c.put("/api/loyalty/admin/settings", headers=hdr(Role.SUPER_ADMIN), json=body).status_code == 200    # no days: still saves
    r = c.put("/api/loyalty/admin/settings", headers=hdr(Role.SUPER_ADMIN), json={**body, "redeem_coupon_days": 14})
    assert r.status_code == 400 and "031_loyalty.sql" in r.text


@arun
async def test_when_the_balance_cannot_be_updated_no_record_of_a_payment_is_left():
    db = Db()
    original = Q.update
    async def missing(self, data):
        if self.table == "loyalty_accounts":
            return []                      # every conditional write misses (someone keeps changing the account)
        return await original(self, data)
    Q.update = missing
    try:
        with pytest.raises(Exception):
            await loyalty.award_for_order(db, 100)
    finally:
        Q.update = original
    assert db.acct()["balance"] == 0 and not db.txns()          # no points and no record that says there were


def test_a_shop_switch_changes_the_signed_in_shop_not_another(client):
    c, db = client
    c.put("/api/loyalty/shop", headers=hdr(Role.MERCHANT_ADMIN, merchant_id=4), json={"enabled": False})
    assert db.tables["merchants"][1]["loyalty_enabled"] is False and db.tables["merchants"][0]["loyalty_enabled"] is True
