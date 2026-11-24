"""Activity tracking: views, searches, add to cart and orders are recorded without ever getting in the way,
and the summary reaches shops and the platform (database faked).

The SQL that adds events up is tested against a real Postgres separately; here the fake `rpc` returns what
that function returns, so these tests cover everything around it.
"""

import asyncio
import functools
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.constants import Role
from app.core.security import TokenClaims, mint_jwt
from app.db.client import SupabaseClient
from app.main import app
from app.models.activity import ActivityIn
from app.services import activity

# The place-an-order and add-to-cart harnesses already exist in the coupon tests
from tests.test_coupons import MAI, db, place, shop  # noqa: F401  (fixtures)


def arun(fn):
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
    def gte(self, col, val): self.f.append(("gte", col, val)); return self

    def _rows(self):
        out = []
        for r in self.db.tables.setdefault(self.table, []):
            ok = True
            for op, c, v in self.f:
                ok &= {"eq": lambda: r.get(c) == v, "in": lambda: r.get(c) in v, "gte": lambda: (r.get(c) or "") >= v}[op]()
            if ok:
                out.append(r)
        return out

    def _check(self):
        if self.db.broken:
            raise RuntimeError("database down")
        if not self.db.migrated and self.table == "activity_events":
            raise pg_error("PGRST205", "Could not find the table 'public.activity_events'", 404)

    async def select(self, cols="*"):
        self._check(); await asyncio.sleep(0)
        return [dict(r) for r in self._rows()]

    async def select_one(self, cols="*"):
        rows = await self.select(cols)
        return rows[0] if rows else None

    async def insert(self, data):
        self._check(); await asyncio.sleep(0)
        if self.table == "activity_events" and data["event_type"] not in activity.EVENT_TYPES:
            raise pg_error("23514", "violates check constraint")
        self.db.next_id += 1
        row = {"id": self.db.next_id, "created_at": data.get("created_at") or datetime.now(timezone.utc).isoformat(), **data}
        self.db.tables.setdefault(self.table, []).append(row)
        return [dict(row)]


class Db:
    def __init__(self, migrated=True):
        self.migrated, self.broken, self.next_id = migrated, False, 100
        self.rpc_calls, self.rpc_result = [], {}
        self.tables = {
            "users": [{"id": 1, "telegram_id": 111}, {"id": 2, "telegram_id": 222}],
            "merchants": [{"id": 3, "name": "Bloom", "status": "active"}, {"id": 4, "name": "Shut", "status": "suspended"}],
            "products": [{"id": 10, "merchant_id": 3, "name": "Rose", "is_active": True}, {"id": 11, "merchant_id": 3, "name": "Old", "is_active": False},
                         {"id": 12, "merchant_id": 4, "name": "X", "is_active": True}, {"id": 13, "merchant_id": 3, "name": "Tulip", "is_active": True}],
            "activity_events": [],
        }

    def from_(self, table): return Q(self, table)

    async def rpc(self, name, params=None):
        self.rpc_calls.append((name, params))
        if not self.migrated:
            raise pg_error("PGRST202", "Could not find the function public.activity_summary", 404)
        return self.rpc_result

    def events(self, **kw): return [e for e in self.tables["activity_events"] if all(e.get(k) == v for k, v in kw.items())]


def body(**kw): return ActivityIn(**{"type": "product_view", "session_id": "sess-abcdef12", **kw})
USER = TokenClaims(sub="1", role=Role.USER, telegram_id=111)


# ── recording ──────────────────────────────────────────────────────

@arun
async def test_record_writes_an_event_without_empty_fields():
    db = Db()
    assert await activity.record(db, "add_to_cart", user_id=1, product_id=10, merchant_id=3) is True
    e = db.tables["activity_events"][0]
    assert (e["event_type"], e["user_id"], e["product_id"], e["merchant_id"]) == ("add_to_cart", 1, 10, 3)
    assert "query" not in e and "session_id" not in e


@arun
async def test_record_never_raises_whatever_goes_wrong():
    db = Db(); db.broken = True
    assert await activity.record(db, "order_placed", user_id=1, merchant_id=3) is False
    assert await activity.record(Db(migrated=False), "order_placed", user_id=1) is False       # before migration 033
    assert await activity.record(Db(), "nonsense") is False                                     # refused by the table's own check


# ── events from the browser ────────────────────────────────────────

@arun
async def test_a_product_view_takes_its_shop_from_the_database_not_the_browser():
    db = Db()
    assert await activity.ingest(db, None, body(product_id=10, merchant_id=4)) is True            # the browser claims shop 4
    e = db.tables["activity_events"][0]
    assert (e["product_id"], e["merchant_id"], e["session_id"]) == (10, 3, "sess-abcdef12")       # recorded as shop 3


@arun
async def test_a_signed_in_customer_is_recorded_by_user():
    db = Db()
    assert await activity.ingest(db, USER, body(type="shop_view", merchant_id=3)) is True
    e = db.tables["activity_events"][0]
    assert (e["user_id"], e["merchant_id"], e["event_type"]) == (1, 3, "shop_view")


@arun
async def test_unknown_inactive_or_closed_things_are_ignored():
    db = Db()
    for b in (body(product_id=999), body(product_id=11), body(type="shop_view", merchant_id=4), body(type="shop_view", merchant_id=999),
              body(), body(type="shop_view")):                    # the last two name nothing
        assert await activity.ingest(db, None, b) is False
    assert not db.tables["activity_events"]


@arun
async def test_shop_staff_and_the_platform_are_not_counted():
    db = Db()
    for role in (Role.MERCHANT_ADMIN, Role.SUPER_ADMIN):
        staff = TokenClaims(sub="9", role=role, merchant_id=3)
        assert await activity.ingest(db, staff, body(product_id=10)) is False
    assert not db.tables["activity_events"]


@arun
async def test_a_visit_with_no_way_to_tell_visitors_apart_is_ignored():
    db = Db()
    anon = ActivityIn(type="product_view", product_id=10)          # no session id, not signed in
    assert await activity.ingest(db, None, anon) is False


@arun
async def test_the_same_visitor_looking_again_within_half_an_hour_counts_once():
    db = Db()
    assert await activity.ingest(db, None, body(product_id=10)) is True
    assert await activity.ingest(db, None, body(product_id=10)) is False
    assert await activity.ingest(db, None, body(product_id=10, session_id="other-visit1")) is True      # another visitor
    assert await activity.ingest(db, None, body(type="shop_view", merchant_id=3)) is True              # another thing
    assert len(db.events(product_id=10)) == 2
    for e in db.events(product_id=10):                                                                 # a view from long ago no longer blocks
        e["created_at"] = (datetime.now(timezone.utc) - timedelta(minutes=activity.DEDUPE_MINUTES + 1)).isoformat()
    assert await activity.ingest(db, None, body(product_id=10)) is True


@arun
async def test_looking_at_different_things_always_counts():
    db = Db()
    assert await activity.ingest(db, None, body(product_id=10)) is True
    assert await activity.ingest(db, None, body(product_id=13)) is True                      # another product, same visitor
    assert await activity.ingest(db, None, body(type="search", query="rose")) is True
    assert await activity.ingest(db, None, body(type="search", query="tulip")) is True       # another search, same visitor
    assert len(db.tables["activity_events"]) == 4


@arun
async def test_dedupe_follows_the_customer_not_the_browser_session():
    db = Db()
    assert await activity.ingest(db, USER, body(product_id=10, session_id="phone-aaaa1111")) is True
    assert await activity.ingest(db, USER, body(product_id=10, session_id="laptop-bbbb2222")) is False


@arun
async def test_searches_are_cleaned_and_counted_once_per_visitor():
    db = Db()
    assert await activity.ingest(db, None, body(type="search", query="  Red   MUG ", result_count=0)) is True
    e = db.tables["activity_events"][0]
    assert (e["query"], e["result_count"]) == ("red mug", 0)
    assert await activity.ingest(db, None, body(type="search", query="red mug", result_count=4)) is False
    for junk in (None, "", " ", "a"):                                                     # too short to mean anything
        assert await activity.ingest(db, None, body(type="search", query=junk)) is False
    assert len(db.tables["activity_events"]) == 1


@arun
async def test_a_very_long_search_is_cut_not_refused():
    db = Db()
    assert await activity.ingest(db, None, body(type="search", query="x" * 150)) is True
    assert len(db.tables["activity_events"][0]["query"]) == activity.MAX_QUERY_LEN


@arun
async def test_the_browser_path_never_raises():
    db = Db(); db.broken = True
    assert await activity.ingest(db, None, body(product_id=10)) is False
    assert await activity.ingest(Db(migrated=False), None, body(product_id=10)) is False


# ── the summary ────────────────────────────────────────────────────

RPC = {
    "totals": {"product_view": 40, "add_to_cart": 10, "order_placed": 4, "search": 7},
    "funnel": {"viewed": 30, "carted": 9, "ordered": 3},
    "daily": [{"date": datetime.now(timezone.utc).date().isoformat(), "product_view": 12, "search": 2}],
    "top_products": [{"product_id": 10, "views": 25, "carts": 5}, {"product_id": 404, "views": 3, "carts": 0}],
    "top_searches": [{"query": "cake", "searches": 4, "no_results": 4}],
}


@arun
async def test_summary_shapes_the_database_answer():
    db = Db(); db.rpc_result = RPC
    s = await activity.summary(db, 7, merchant_id=3)
    assert db.rpc_calls == [("activity_summary", {"p_days": 7, "p_merchant_id": 3})]
    assert s["setup_needed"] is False and s["merchant_id"] == 3
    assert s["totals"] == {"product_view": 40, "shop_view": 0, "search": 7, "add_to_cart": 10, "order_placed": 4}      # a missing type is 0
    assert s["funnel"] == {"viewed": 30, "carted": 9, "ordered": 3, "view_to_cart_pct": 30.0, "cart_to_order_pct": 33.3}
    assert [t["name"] for t in s["top_products"]] == ["Rose", "Removed product"]                                       # a deleted product does not break it
    assert s["top_products"][0]["cart_rate_pct"] == 20.0
    assert s["top_searches"] == [{"query": "cake", "searches": 4, "no_results": 4}]


@arun
async def test_the_daily_series_has_one_row_per_day_with_zeros_for_quiet_days():
    db = Db(); db.rpc_result = RPC
    s = await activity.summary(db, 7)
    assert len(s["daily"]) == 7 and s["daily"][-1]["date"] == datetime.now(timezone.utc).date().isoformat()
    assert s["daily"][-1]["product_view"] == 12 and s["daily"][0] == {"date": s["daily"][0]["date"], **{t: 0 for t in activity.EVENT_TYPES}}
    assert s["merchant_id"] is None


@arun
async def test_rates_are_none_not_a_division_error_when_there_is_nothing():
    db = Db(); db.rpc_result = {"totals": {}, "funnel": {}, "daily": [], "top_products": [], "top_searches": []}
    s = await activity.summary(db, 30)
    assert s["funnel"] == {"viewed": 0, "carted": 0, "ordered": 0, "view_to_cart_pct": None, "cart_to_order_pct": None}


@arun
async def test_the_window_is_kept_between_one_day_and_a_year():
    db = Db(); db.rpc_result = RPC
    assert (await activity.summary(db, 0))["days"] == 1 and (await activity.summary(db, 99999))["days"] == activity.MAX_DAYS
    assert [c[1]["p_days"] for c in db.rpc_calls] == [1, activity.MAX_DAYS]


@arun
async def test_before_the_migration_the_summary_says_set_up_needed():
    assert await activity.summary(Db(migrated=False), 30) == {"setup_needed": True, "days": 30}


# ── what the server records itself ─────────────────────────────────

def test_placing_an_order_records_it_for_the_shop(db, shop):
    order_id = place()["data"]["order_id"]
    events = db.tables["activity_events"]
    assert [(e["event_type"], e["user_id"], e["merchant_id"], e["order_id"]) for e in events] == [("order_placed", 1, 3, order_id)]


def test_an_order_is_still_placed_when_tracking_is_broken(db, shop, monkeypatch):
    from tests import test_coupons
    original = test_coupons.Q.insert
    async def broken(self, data):
        if self.table == "activity_events":
            raise RuntimeError("tracking down")
        return await original(self, data)
    monkeypatch.setattr(test_coupons.Q, "insert", broken)
    assert place()["data"]["order_id"]
    assert not db.tables.get("activity_events")


def test_adding_to_the_cart_records_it(db, monkeypatch):
    from app.routes import cart as cart_route
    from app.models.cart import CartItemAdd
    async def person(db_, user): return {"id": 1, "telegram_id": 111}
    monkeypatch.setattr(cart_route, "_get_db_user", person)
    db.tables["products"] = [{"id": 1, "merchant_id": 3, "base_price": 12, "stock": 9, "name": "Mug", "is_active": True}]
    db.tables["cart"], db.tables["cart_items"] = [], []
    asyncio.run(cart_route.add_to_cart(CartItemAdd(product_id=1, quantity=1, selected_variants=[]), user=MAI))
    assert [(e["event_type"], e["user_id"], e["product_id"], e["merchant_id"]) for e in db.tables["activity_events"]] == [("add_to_cart", 1, 1, 3)]


# ── HTTP ───────────────────────────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    db = Db(); db.rpc_result = RPC
    @asynccontextmanager
    async def fake():
        yield db
    monkeypatch.setattr(SupabaseClient, "service_role", staticmethod(fake))
    return TestClient(app), db


def hdr(role, **kw):
    return {"Authorization": "Bearer " + mint_jwt(sub="1", role=role, expires_in=600, **kw)}


def test_a_guest_can_report_a_view_and_gets_ok_either_way(client):
    c, db = client
    r = c.post("/api/activity", json={"type": "product_view", "session_id": "guest-12345678", "product_id": 10})
    assert r.status_code == 200 and r.json() == {"recorded": True}
    assert c.post("/api/activity", json={"type": "product_view", "session_id": "guest-12345678", "product_id": 10}).json() == {"recorded": False}
    db.broken = True
    assert c.post("/api/activity", json={"type": "product_view", "session_id": "guest-87654321", "product_id": 10}).status_code == 200   # never an error


def test_only_browser_events_are_accepted_over_http(client):
    c, _ = client
    for bad in ({"type": "order_placed", "session_id": "guest-12345678"}, {"type": "add_to_cart", "session_id": "guest-12345678", "product_id": 10},
                {"type": "product_view", "session_id": "bad id!!", "product_id": 10}, {"type": "product_view", "session_id": "short", "product_id": 10},
                {"type": "product_view", "session_id": "guest-12345678", "product_id": -1},
                {"type": "search", "session_id": "guest-12345678", "query": "x" * 201},
                {"type": "search", "session_id": "guest-12345678", "query": "ok", "result_count": -5}):
        assert c.post("/api/activity", json=bad).status_code == 422, bad


def test_staff_browsing_is_not_counted_over_http(client):
    c, db = client
    r = c.post("/api/activity", headers=hdr(Role.MERCHANT_ADMIN, merchant_id=3), json={"type": "product_view", "session_id": "guest-12345678", "product_id": 10})
    assert r.status_code == 200 and r.json() == {"recorded": False} and not db.tables["activity_events"]


def test_who_may_read_the_summary(client):
    c, _ = client
    assert c.get("/api/activity/summary").status_code == 401
    assert c.get("/api/activity/summary", headers=hdr(Role.USER, telegram_id=111)).status_code == 403
    assert c.get("/api/activity/summary", headers=hdr(Role.SUPER_ADMIN)).status_code == 200
    assert c.get("/api/activity/summary", headers=hdr(Role.MERCHANT_ADMIN, merchant_id=3)).status_code == 200


def test_a_shop_only_ever_sees_its_own_customers(client):
    c, db = client
    c.get("/api/activity/summary?merchant_id=4", headers=hdr(Role.MERCHANT_ADMIN, merchant_id=3))
    assert db.rpc_calls[-1][1]["p_merchant_id"] == 3                      # asking for another shop changes nothing
    c.get("/api/activity/summary?merchant_id=4", headers=hdr(Role.SUPER_ADMIN))
    assert db.rpc_calls[-1][1]["p_merchant_id"] == 4                      # the platform can look at any shop
    c.get("/api/activity/summary", headers=hdr(Role.SUPER_ADMIN))
    assert db.rpc_calls[-1][1]["p_merchant_id"] is None                   # or at everything
    r = c.get("/api/activity/summary?days=9999", headers=hdr(Role.SUPER_ADMIN))
    assert r.json()["days"] == activity.MAX_DAYS
