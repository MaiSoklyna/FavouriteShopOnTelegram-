"""Shop staff accounts and the shop activity log (database faked).

Covers: owner-only routes refuse staff, operational routes allow staff, a deactivated staff member
is locked out at once, older owner tokens keep working, owners manage only their own shop's staff,
and the important changes (price, delete, order accept/reject, driver assignment, payout account,
staff actions) land in the activity log with who, what and when. A failing log write never
breaks the change itself.
"""

from __future__ import annotations

import re
from contextlib import asynccontextmanager
from decimal import Decimal

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core import dependencies
from app.core.constants import Role
from app.core.security import mint_jwt
from app.db.client import SupabaseClient
from app.main import app
from app.services import audit, deliveries, order_status


# ── A small in-memory PostgREST ─────────────────────────────────


class Q:
    def __init__(self, db, table):
        self.db, self.table, self.f, self.ors, self.orders, self.off, self.lim = db, table, [], [], [], 0, None

    def _add(self, op, col, val):
        self.f.append((op, col, val))
        return self

    def eq(self, c, v): return self._add("eq", c, v)
    def neq(self, c, v): return self._add("neq", c, v)
    def gte(self, c, v): return self._add("gte", c, v)
    def lt(self, c, v): return self._add("lt", c, v)
    def lte(self, c, v): return self._add("lte", c, v)
    def in_(self, c, v): return self._add("in", c, list(v))
    def ilike(self, c, p): return self._add("ilike", c, p.strip("*").lower())

    def or_(self, *conds):
        self.ors.append(conds)
        return self

    def order(self, col, *, desc=False, nulls_last=False):
        self.orders.append((col, desc))
        return self

    def offset(self, n): self.off = n; return self
    def limit(self, n): self.lim = n; return self

    @staticmethod
    def _test(row, op, col, val):
        have = row.get(col)
        if op == "eq": return have == val
        if op == "neq": return have != val
        if op == "in": return have in val
        if op == "gte": return have is not None and str(have) >= str(val)
        if op == "lt": return have is not None and str(have) < str(val)
        if op == "lte": return have is not None and str(have) <= str(val)
        if op == "ilike": return val in str(have or "").lower()
        raise AssertionError(op)

    def _or_ok(self, row, conds):
        for c in conds:
            m = re.match(r"(\w+)\.(ilike|eq|is)\.(.*)", c)
            col, op, val = m.groups()
            if op == "ilike" and val.strip("*").lower() in str(row.get(col) or "").lower():
                return True
            if op == "eq" and str(row.get(col)) == val:
                return True
            if op == "is" and val == "null" and row.get(col) is None:
                return True
        return False

    def _rows(self):
        self.db.check(self.table)
        rows = [r for r in self.db.t.setdefault(self.table, [])
                if all(self._test(r, *f) for f in self.f) and all(self._or_ok(r, o) for o in self.ors)]
        for col, desc in reversed(self.orders):
            rows = sorted(rows, key=lambda r: (r.get(col) is None, r.get(col)), reverse=desc)
        rows = rows[self.off:]
        return rows[: self.lim] if self.lim is not None else rows

    async def select(self, *_):
        return [dict(r) for r in self._rows()]

    async def select_one(self, *_):
        rows = self._rows()
        return dict(rows[0]) if rows else None

    async def insert(self, data):
        self.db.check(self.table, write=True)
        rows = self.db.t.setdefault(self.table, [])
        out = []
        for d in (data if isinstance(data, list) else [data]):
            row = {"id": max((r["id"] for r in rows), default=0) + 1, **d}
            if self.table == audit.TABLE:
                self.db.clock += 1
                row.setdefault("created_at", f"2026-11-23T10:{self.db.clock:02d}:00+00:00")
            rows.append(row)
            out.append(dict(row))
        return out

    async def update(self, data):
        rows = self._rows()
        for r in rows:
            r.update(data)
        return [dict(r) for r in rows]

    async def delete(self):
        gone = self._rows()
        self.db.t[self.table] = [r for r in self.db.t[self.table] if r not in gone]
        return gone


class FakeDb:
    def __init__(self):
        self.clock = 0
        self.broken_log = False
        self.t = {
            "merchants": [
                {"id": 1, "name": "Cake Shop", "status": "active", "description": "Cakes", "phone": "012",
                 "aba_account": "001122334", "aba_account_name": "CAKE SHOP", "payout_verification_status": "verified",
                 "payout_enabled": True, "logo_update_history": []},
                {"id": 2, "name": "Other Shop", "status": "active"},
            ],
            "merchant_admins": [
                {"id": 10, "merchant_id": 1, "full_name": "Lyna", "email": "owner@cake.test", "role": "admin",
                 "is_active": True, "password_hash": "x", "telegram_id": 111, "created_at": "2026-01-01"},
                {"id": 11, "merchant_id": 1, "full_name": "Sara", "email": "sara@cake.test", "role": "staff",
                 "is_active": True, "password_hash": "x", "telegram_id": None, "created_at": "2026-02-01"},
                {"id": 12, "merchant_id": 1, "full_name": "Kosal", "email": "kosal@cake.test", "role": "manager",
                 "is_active": True, "password_hash": "x", "telegram_id": None, "created_at": "2026-03-01"},
                {"id": 20, "merchant_id": 2, "full_name": "Other Owner", "email": "o@other.test", "role": "owner",
                 "is_active": True, "password_hash": "x", "telegram_id": 222, "created_at": "2026-01-01"},
                {"id": 21, "merchant_id": 2, "full_name": "Other Staff", "email": "s@other.test", "role": "staff",
                 "is_active": True, "password_hash": "x", "telegram_id": None, "created_at": "2026-02-01"},
            ],
            "super_admins": [{"id": 1, "full_name": "Platform", "email": "root@platform.test"}],
            "products": [
                {"id": 5, "merchant_id": 1, "name": "Matcha Cake", "base_price": 15.0, "compare_price": None,
                 "stock": 10, "is_active": True, "category_id": None, "description": "Green"},
                {"id": 6, "merchant_id": 2, "name": "Other Thing", "base_price": 3.0, "stock": 1, "is_active": True},
            ],
            "orders": [
                {"id": 100, "merchant_id": 1, "status": "pending", "order_code": "FS-1", "delivery_type": "delivery"},
                {"id": 101, "merchant_id": 1, "status": "pending", "order_code": "FS-2", "delivery_type": "delivery"},
            ],
            "drivers": [{"id": 7, "merchant_id": 1, "full_name": "Dara", "phone": "099", "vehicle": "Moto", "is_active": True}],
            "deliveries": [],
            audit.TABLE: [],
        }

    def check(self, table, write=False):
        if table == audit.TABLE and write and self.broken_log:
            req = httpx.Request("POST", "http://db/x")
            raise httpx.HTTPStatusError("boom", request=req, response=httpx.Response(500, json={"code": "XX000"}, request=req))

    def from_(self, table):
        return Q(self, table)

    def log(self, action=None):
        rows = self.t[audit.TABLE]
        return [r for r in rows if action is None or r["action"] == action]


@pytest.fixture
def db(monkeypatch):
    fake = FakeDb()

    @asynccontextmanager
    async def service_role():
        yield fake

    monkeypatch.setattr(SupabaseClient, "service_role", staticmethod(service_role))
    dependencies._staff_checks.clear()
    yield fake
    dependencies._staff_checks.clear()


@pytest.fixture
def client(db):
    return TestClient(app)


def bearer(sub, *, role=Role.MERCHANT_ADMIN, merchant_id=1, merchant_role=None, name=None):
    tok = mint_jwt(sub=str(sub), role=role, merchant_id=merchant_id, merchant_role=merchant_role, name=name, expires_in=600)
    return {"Authorization": f"Bearer {tok}"}


OWNER = bearer(10, merchant_role="owner", name="Lyna")
OLD_OWNER = bearer(10)  # a token from before staff accounts existed: no shop role in it
STAFF = bearer(11, merchant_role="staff", name="Sara")
MANAGER = bearer(12, merchant_role="manager", name="Kosal")
SUPER = bearer(1, role=Role.SUPER_ADMIN, merchant_id=None, name="Platform")


# ── Who may do what ─────────────────────────────────────────────

OWNER_ONLY = [
    ("get", "/api/merchant-staff", None),
    ("post", "/api/merchant-staff", {"full_name": "X", "email": "x@y.test", "password": "longenough"}),
    ("get", "/api/merchant-activity", None),
    ("patch", "/api/merchants/1", {"description": "new"}),
    ("get", "/api/settlements/merchant/balance", None),
    ("get", "/api/settlements/merchant/earnings", None),
    ("get", "/api/settlements/merchant/payouts", None),
    ("get", "/api/settlements/merchant/payout-account", None),
    ("put", "/api/settlements/merchant/payout-account", {"aba_account": "999888777", "aba_account_name": "SARA"}),
    ("get", "/api/loyalty/shop", None),
    ("put", "/api/loyalty/shop", {"enabled": False}),
]


@pytest.mark.parametrize("method,body", [("get", None), ("put", {"is_enabled": False})])
def test_ai_settings_are_platform_only(client, db, method, body):
    """The AI assistant's settings are one row for the whole platform: no shop account may read or change them."""
    db.t["ai_settings"] = [{"id": 1, "is_enabled": True, "system_prompt": "Be nice"}]
    kw = {"json": body} if body is not None else {}
    for who in (STAFF, OWNER, OLD_OWNER):
        assert getattr(client, method)("/api/ai/admin/settings", headers=who, **kw).status_code == 403
    assert db.t["ai_settings"][0]["is_enabled"] is True
    assert getattr(client, method)("/api/ai/admin/settings", headers=SUPER, **kw).status_code == 200


@pytest.mark.parametrize("method,path,body", OWNER_ONLY)
def test_staff_are_refused_owner_only_actions(client, db, method, path, body):
    r = getattr(client, method)(path, headers=STAFF, **({"json": body} if body is not None else {}))
    assert r.status_code == 403, (path, r.text)
    assert "owner" in r.text.lower()
    assert db.t["merchants"][0]["aba_account"] == "001122334"  # nothing changed


def test_staff_can_do_operational_work(client, db, monkeypatch):
    async def fake_change(db_, order, new_status, **kw):
        order["status"] = new_status
    monkeypatch.setattr(order_status, "change_status", fake_change)

    assert client.patch("/api/products/5", json={"stock": 4}, headers=STAFF).status_code == 200
    assert client.patch("/api/orders/admin/100/status", json={"status": "confirmed"}, headers=STAFF).status_code == 200
    # Promotions, coupons and drivers are a manager's job
    assert client.post("/api/promos", json={"code": "STAFF10", "type": "percent", "value": 10}, headers=MANAGER).status_code == 200
    assert client.patch("/api/promos/1", json={"is_active": False}, headers=MANAGER).status_code == 200
    assert [e["action"] for e in db.log()][-2:] == ["coupon.created", "coupon.disabled"]
    assert client.patch("/api/deliveries/admin/drivers/7", json={"is_active": False}, headers=MANAGER).status_code == 200


def test_older_owner_tokens_still_count_as_owner(client):
    r = client.get("/api/merchant-staff", headers=OLD_OWNER)
    assert r.status_code == 200
    names = [p["full_name"] for p in r.json()["data"]]
    assert names == ["Lyna", "Kosal", "Sara"]  # owner first; never another shop's people
    assert r.json()["data"][0]["role"] == "owner" and r.json()["data"][0]["is_you"]


def test_deactivated_staff_are_locked_out_immediately(client, db):
    assert client.patch("/api/products/5", json={"stock": 9}, headers=STAFF).status_code == 200
    r = client.patch("/api/merchant-staff/11", json={"is_active": False}, headers=OWNER)
    assert r.status_code == 200
    r = client.patch("/api/products/5", json={"stock": 8}, headers=STAFF)
    assert r.status_code == 401 and "no longer active" in r.text
    assert db.t["products"][0]["stock"] == 9


def test_removed_or_moved_staff_lose_access(client, db):
    db.t["merchant_admins"][1]["merchant_id"] = 2  # moved to another shop: the token still says shop 1
    assert client.patch("/api/products/5", json={"stock": 1}, headers=STAFF).status_code == 401
    dependencies._staff_checks.clear()
    db.t["merchant_admins"].pop(1)  # removed outright
    assert client.patch("/api/products/5", json={"stock": 1}, headers=STAFF).status_code == 401
    assert db.t["products"][0]["stock"] == 10


# ── Owners manage their own staff ───────────────────────────────


def test_owner_adds_staff_with_their_own_login(client, db):
    r = client.post("/api/merchant-staff", headers=OWNER,
                    json={"full_name": " John ", "email": "John@Cake.test", "password": "secret123", "telegram_id": 333})
    assert r.status_code == 200, r.text
    row = db.t["merchant_admins"][-1]
    assert (row["merchant_id"], row["role"], row["email"], row["full_name"]) == (1, "staff", "john@cake.test", "John")
    assert row["password_hash"] != "secret123"
    entry = db.log("staff.added")[0]
    assert (entry["actor_name"], entry["actor_type"], entry["target_label"]) == ("Lyna", "owner", "John")
    assert "password" not in str(entry["new_value"]).lower()


@pytest.mark.parametrize("payload,msg", [
    ({"email": "sara@cake.test"}, "email"),          # another staff member's email
    ({"email": "root@platform.test"}, "email"),      # a platform admin's email
    ({"email": "new@cake.test", "telegram_id": 222}, "Telegram"),  # another shop's owner
])
def test_staff_logins_must_be_unique(client, payload, msg):
    body = {"full_name": "Dup", "password": "secret123", **payload}
    r = client.post("/api/merchant-staff", headers=OWNER, json=body)
    assert r.status_code == 409 and msg in r.text


def test_owner_cannot_change_owners_or_other_shops_staff(client, db):
    assert client.patch("/api/merchant-staff/10", json={"is_active": False}, headers=OWNER).status_code == 403  # self/owner
    assert client.delete("/api/merchant-staff/10", headers=OWNER).status_code == 403
    assert client.patch("/api/merchant-staff/21", json={"is_active": False}, headers=OWNER).status_code == 404
    assert client.delete("/api/merchant-staff/21", headers=OWNER).status_code == 404
    assert all(a["is_active"] for a in db.t["merchant_admins"])


def test_staff_actions_are_logged_without_secrets(client, db):
    client.patch("/api/merchant-staff/11", json={"full_name": "Sara K", "new_password": "another1"}, headers=OWNER)
    client.patch("/api/merchant-staff/11", json={"is_active": False}, headers=OWNER)
    client.patch("/api/merchant-staff/11", json={"is_active": True}, headers=OWNER)
    client.delete("/api/merchant-staff/11", headers=OWNER)
    actions = [r["action"] for r in db.log()]
    assert actions == ["staff.updated", "staff.deactivated", "staff.reactivated", "staff.removed"]
    upd = db.log("staff.updated")[0]
    assert upd["new_value"] == {"full_name": "Sara K", "password": "(reset)"}
    assert "another1" not in str(db.log())
    assert not any(a["id"] == 11 for a in db.t["merchant_admins"])


# ── What lands in the log ───────────────────────────────────────


def test_price_change_is_its_own_entry_with_old_and_new(client, db):
    r = client.patch("/api/products/5", json={"base_price": 12, "stock": 10, "name": "Matcha Cake"}, headers=MANAGER)
    assert r.status_code == 200
    assert [e["action"] for e in db.log()] == ["product.price_changed"]  # unchanged stock/name are not news
    e = db.log("product.price_changed")[0]
    assert e["old_value"] == {"base_price": 15.0} and e["new_value"] == {"base_price": 12.0}
    assert (e["actor_type"], e["actor_id"], e["actor_name"], e["target_label"], e["merchant_id"]) == ("manager", "12", "Kosal", "Matcha Cake", 1)

    # Staff may still edit the product; sending the unchanged price along is fine
    client.patch("/api/products/5", json={"base_price": 12, "description": "Very green"}, headers=STAFF)
    assert db.log()[-1]["action"] == "product.updated"
    assert db.log()[-1]["new_value"] == {"description": "Very green"}


def test_product_delete_is_logged(client, db):
    assert client.delete("/api/products/5", headers=MANAGER).status_code == 200
    e = db.log("product.deleted")[0]
    assert e["target_label"] == "Matcha Cake" and e["old_value"]["base_price"] == 15.0


def test_order_accept_and_reject_are_named(client, db, monkeypatch):
    async def fake_change(db_, order, new_status, **kw):
        order["status"] = new_status
    monkeypatch.setattr(order_status, "change_status", fake_change)
    client.patch("/api/orders/admin/100/status", json={"status": "confirmed"}, headers=STAFF)
    client.patch("/api/orders/admin/101/status", json={"status": "cancelled", "admin_note": "Out of matcha"}, headers=OWNER)
    acc, rej = db.log("order.accepted")[0], db.log("order.rejected")[0]
    assert (acc["actor_name"], acc["target_label"], acc["old_value"], acc["new_value"]) == ("Sara", "FS-1", {"status": "pending"}, {"status": "confirmed"})
    assert rej["actor_name"] == "Lyna" and rej["new_value"]["note"] == "Out of matcha"


def test_driver_assignment_is_logged(client, db, monkeypatch):
    async def fake_assign(db_, order, driver_id, *, by):
        return {"status": "assigned"}
    monkeypatch.setattr(deliveries, "assign", fake_assign)
    assert client.post("/api/deliveries/orders/100/assign", json={"driver_id": 7}, headers=STAFF).status_code == 200
    e = db.log("order.driver_assigned")[0]
    assert e["new_value"]["driver"] == "Dara" and e["target_label"] == "FS-1"


def test_payout_account_change_is_logged_masked(client, db, monkeypatch):
    async def no_settlement_audit(*a, **k):
        return None
    from app.services import settlement
    monkeypatch.setattr(settlement, "audit", no_settlement_audit)
    r = client.put("/api/settlements/merchant/payout-account", headers=OWNER,
                   json={"aba_account": "999 888 777", "aba_account_name": "CAKE SHOP CO"})
    assert r.status_code == 200, r.text
    e = db.log("payout.account_updated")[0]
    assert e["new_value"]["aba_account"] == "•••8777" and e["old_value"]["aba_account"] == "•••2334"
    assert "999888777" not in str(e)


def test_a_failing_log_never_blocks_the_change(client, db):
    db.broken_log = True
    assert client.patch("/api/products/5", json={"base_price": 9}, headers=MANAGER).status_code == 200
    assert db.t["products"][0]["base_price"] == 9


def test_platform_admin_edits_are_named(client, db):
    client.patch("/api/products/5", json={"base_price": 14}, headers=SUPER)
    e = db.log("product.price_changed")[0]
    assert (e["actor_type"], e["actor_name"]) == ("super_admin", "Platform")


# ── The activity page ───────────────────────────────────────────


def _seed(client):
    client.patch("/api/products/5", json={"base_price": 12}, headers=MANAGER)
    client.patch("/api/products/5", json={"description": "New"}, headers=OWNER)
    client.delete("/api/products/5", headers=MANAGER)


def test_activity_feed_is_newest_first_and_shop_scoped(client, db):
    _seed(client)
    db.t[audit.TABLE].append({"id": 999, "merchant_id": 2, "action": "product.deleted", "actor_name": "Other",
                              "target_label": "Other Thing", "created_at": "2026-11-23T11:00:00+00:00"})
    r = client.get("/api/merchant-activity", headers=OWNER)
    assert r.status_code == 200
    body = r.json()
    assert [e["action"] for e in body["data"]] == ["product.deleted", "product.updated", "product.price_changed"]
    assert "Other Thing" not in r.text
    assert {p["name"] for p in body["people"]} == {"Lyna", "Kosal", "Sara"}


def test_activity_filters(client, db):
    _seed(client)
    by_group = client.get("/api/merchant-activity?action=product", headers=OWNER).json()["data"]
    assert len(by_group) == 3
    only_price = client.get("/api/merchant-activity?action=product.price_changed", headers=OWNER).json()["data"]
    assert [e["action"] for e in only_price] == ["product.price_changed"]
    by_kosal = client.get("/api/merchant-activity?actor_id=12", headers=OWNER).json()["data"]
    assert {e["actor_name"] for e in by_kosal} == {"Kosal"} and len(by_kosal) == 2
    search = client.get("/api/merchant-activity?q=matcha", headers=OWNER).json()["data"]
    assert len(search) == 3
    assert client.get("/api/merchant-activity?action=nonsense", headers=OWNER).status_code == 400


def test_activity_date_range_uses_shop_days(client, db):
    db.t[audit.TABLE] += [
        {"id": 1, "merchant_id": 1, "action": "product.updated", "created_at": "2026-11-20T16:59:00+00:00"},  # 23:59 on the 20th in Phnom Penh
        {"id": 2, "merchant_id": 1, "action": "product.updated", "created_at": "2026-11-20T17:00:00+00:00"},  # 00:00 on the 21st
    ]
    rows = client.get("/api/merchant-activity?date_from=2026-11-21&date_to=2026-11-21", headers=OWNER).json()["data"]
    assert [r["id"] for r in rows] == [2]
    assert client.get("/api/merchant-activity?date_from=2026-11-22&date_to=2026-11-21", headers=OWNER).status_code == 400


def test_activity_paging(client, db):
    for i in range(5):
        client.patch("/api/products/5", json={"stock": i + 20}, headers=STAFF)
    first = client.get("/api/merchant-activity?page_size=2", headers=OWNER).json()
    assert len(first["data"]) == 2 and first["has_more"]
    last = client.get("/api/merchant-activity?page_size=2&page=3", headers=OWNER).json()
    assert len(last["data"]) == 1 and not last["has_more"]


def test_super_admin_reads_any_shop_but_must_say_which(client, db):
    _seed(client)
    assert client.get("/api/merchant-activity", headers=SUPER).status_code == 400
    assert len(client.get("/api/merchant-activity?merchant_id=1", headers=SUPER).json()["data"]) == 3


# ── Helpers ─────────────────────────────────────────────────────


def test_diff_ignores_number_formats_and_empty_values():
    old, new = audit.diff({"a": 15, "b": None, "c": "x"}, {"a": Decimal("15.00"), "b": "", "c": "y"})
    assert (old, new) == ({"c": "x"}, {"c": "y"})


@pytest.mark.parametrize("old,new,action", [
    ("pending", "confirmed", "order.accepted"),
    ("pending", "cancelled", "order.rejected"),
    ("confirmed", "cancelled", "order.status_changed"),
    ("processing", "shipped", "order.status_changed"),
])
def test_order_action_names(old, new, action):
    assert audit.order_action(old, new) == action
