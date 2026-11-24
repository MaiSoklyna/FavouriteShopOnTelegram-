"""Owner / Manager / Staff permissions, sign-in history and the shop dashboard (database faked).

Covers: the matrix itself, central enforcement on every shop request (Staff refused sensitive
actions, Manager allowed them, Manager refused owner-only areas), role changes taking effect at
once, invites with a role, sign-in/sign-out entries in the activity log, and the dashboard
trimmed to what each role may see.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app.core.constants import shop_role
from app.core.permissions import ROLE_PERMISSIONS, ROUTE_RULES, Perm, required_permission, role_can
from app.core.security import hash_password
from app.main import app
from app.services import order_status
from app.services.delivery import SHOP_TZ
from tests.test_merchant_staff import MANAGER, OWNER, STAFF, SUPER, client, db  # noqa: F401  (fixtures)


# ── The matrix ──────────────────────────────────────────────────


def test_matrix_shape():
    assert ROLE_PERMISSIONS["owner"] == frozenset(Perm)
    assert ROLE_PERMISSIONS["staff"] == {Perm.PRODUCTS_EDIT, Perm.ORDERS_PROCESS}
    manager = ROLE_PERMISSIONS["manager"]
    assert {Perm.PRODUCTS_PRICE, Perm.PRODUCTS_DELETE, Perm.ORDERS_CANCEL, Perm.SALES_VIEW, Perm.ACTIVITY_VIEW} <= manager
    assert not manager & {Perm.STAFF_MANAGE, Perm.FINANCE_MANAGE, Perm.SHOP_SETTINGS}
    assert not role_can("someone-else", Perm.PRODUCTS_EDIT)


@pytest.mark.parametrize("raw,expected", [
    ("owner", "owner"), ("admin", "owner"), (None, "owner"), ("", "owner"),
    ("manager", "manager"), (" Manager ", "manager"), ("staff", "staff"),
])
def test_role_names_are_normalised(raw, expected):
    assert shop_role(raw) == expected


def test_every_rule_points_at_a_real_endpoint():
    """A typo in ROUTE_RULES would silently leave an endpoint open."""
    routes = [(m, r.path) for r in app.routes for m in getattr(r, "methods", ()) or ()]
    for methods, rule_path, perm in ROUTE_RULES:
        hits = [(m, p) for m, p in routes if m in methods and required_permission(m, p) == perm
                and (p == rule_path or (rule_path.endswith("*") and p.startswith(rule_path[:-1])))]
        assert hits, f"no endpoint matches {methods} {rule_path}"


# ── Central enforcement ─────────────────────────────────────────

SENSITIVE = [
    ("delete", "/api/products/5", None, "delete products"),
    ("patch", "/api/products/5", {"base_price": 1}, "change product prices"),
    ("patch", "/api/orders/admin/100/status", {"status": "cancelled"}, "reject or cancel orders"),
    ("post", "/api/promos", {"code": "X10", "type": "percent", "value": 10}, "promotions"),
    ("patch", "/api/deliveries/admin/drivers/7", {"is_active": False}, "manage drivers"),
    ("post", "/api/collections/admin", {"title": "Sale"}, "collections"),
    ("get", "/api/analytics/dashboard", None, "sales"),
    ("get", "/api/merchant-activity", None, "activity log"),
]


@pytest.mark.parametrize("method,path,body,words", SENSITIVE)
def test_staff_are_refused_sensitive_actions(client, db, method, path, body, words):
    before = [dict(p) for p in db.t["products"]], [dict(o) for o in db.t["orders"]]
    r = getattr(client, method)(path, headers=STAFF, **({"json": body} if body is not None else {}))
    assert r.status_code == 403, (path, r.text)
    assert "Your role (Staff)" in r.text and words in r.text.lower()
    assert ([dict(p) for p in db.t["products"]], [dict(o) for o in db.t["orders"]]) == before  # nothing changed


def test_managers_may_do_them(client, db, monkeypatch):
    async def fake_change(db_, order, new_status, **kw):
        order["status"] = new_status
    monkeypatch.setattr(order_status, "change_status", fake_change)
    assert client.patch("/api/products/5", json={"base_price": 13}, headers=MANAGER).status_code == 200
    assert client.patch("/api/orders/admin/100/status", json={"status": "cancelled"}, headers=MANAGER).status_code == 200
    assert client.get("/api/merchant-activity", headers=MANAGER).status_code == 200
    assert client.delete("/api/products/5", headers=MANAGER).status_code == 200


@pytest.mark.parametrize("method,path,body", [
    ("get", "/api/merchant-staff", None),
    ("post", "/api/merchant-staff", {"full_name": "X", "email": "x@y.test", "password": "longenough"}),
    ("patch", "/api/merchants/1", {"description": "new"}),
    ("get", "/api/settlements/merchant/earnings", None),
    ("put", "/api/settlements/merchant/payout-account", {"aba_account": "999888777", "aba_account_name": "K"}),
])
def test_managers_are_refused_owner_only_areas(client, db, method, path, body):
    r = getattr(client, method)(path, headers=MANAGER, **({"json": body} if body is not None else {}))
    assert r.status_code == 403, (path, r.text)
    assert db.t["merchants"][0]["aba_account"] == "001122334"


def test_staff_keep_their_daily_work(client, db, monkeypatch):
    async def fake_change(db_, order, new_status, **kw):
        order["status"] = new_status
    monkeypatch.setattr(order_status, "change_status", fake_change)
    assert client.patch("/api/products/5", json={"stock": 3, "base_price": 15}, headers=STAFF).status_code == 200  # same price
    assert client.patch("/api/orders/admin/100/status", json={"status": "confirmed"}, headers=STAFF).status_code == 200
    assert client.get("/api/promotions/admin/list", headers=STAFF).status_code != 403  # reading is open


def test_super_admin_is_not_limited(client, db):
    assert client.delete("/api/products/5", headers=SUPER).status_code == 200


# ── People and roles ────────────────────────────────────────────


def test_owner_invites_a_manager(client, db):
    r = client.post("/api/merchant-staff", headers=OWNER, json={
        "full_name": "Vanna", "email": "vanna@cake.test", "password": "Temp-pass-123", "role": "manager"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["role"] == "manager"
    entry = db.log("staff.added")[-1]
    assert entry["new_value"]["role"] == "manager" and "Temp-pass" not in str(entry)


def test_owner_cannot_create_another_owner(client):
    r = client.post("/api/merchant-staff", headers=OWNER, json={
        "full_name": "Boss", "email": "boss@cake.test", "password": "longenough", "role": "owner"})
    assert r.status_code == 422


def test_role_change_is_logged_and_takes_effect_at_once(client, db):
    assert client.get("/api/products/5", headers=STAFF).status_code != 401
    r = client.patch("/api/merchant-staff/11", headers=OWNER, json={"role": "manager"})
    assert r.status_code == 200 and r.json()["data"]["role"] == "manager"
    e = db.log("staff.role_changed")[-1]
    assert (e["old_value"], e["new_value"], e["target_label"]) == ({"role": "staff"}, {"role": "manager"}, "Sara")
    # Sara's old Staff token no longer matches her account: she signs in again as Manager
    assert client.patch("/api/products/5", json={"stock": 2}, headers=STAFF).status_code == 401


def test_owners_role_cannot_be_changed(client):
    assert client.patch("/api/merchant-staff/10", headers=OWNER, json={"role": "staff"}).status_code == 403


def test_my_permissions(client):
    staff = client.get("/api/merchant-permissions", headers=STAFF).json()
    assert staff["role"] == "staff" and set(staff["permissions"]) == {"products.edit", "orders.process"}
    keys = [p["key"] for p in staff["matrix"]["permissions"]]
    assert "staff.manage" in keys and len(keys) == len(Perm)
    owner = client.get("/api/merchant-permissions", headers=OWNER).json()
    assert owner["role"] == "owner" and len(owner["permissions"]) == len(Perm)


# ── Sign-in and sign-out history ────────────────────────────────


def test_password_sign_in_and_sign_out_are_logged(client, db):
    sara = next(a for a in db.t["merchant_admins"] if a["id"] == 11)
    sara["password_hash"] = hash_password("sara-secret-1")
    r = client.post("/api/auth/admin-login", json={"email": "sara@cake.test", "password": "sara-secret-1"})
    assert r.status_code == 200, r.text
    e = db.log("account.login")[-1]
    assert (e["actor_name"], e["actor_type"], e["merchant_id"], e["new_value"]) == ("Sara", "staff", 1, {"method": "password"})
    assert "sara-secret" not in str(db.log())

    assert client.post("/api/auth/logout", headers=STAFF).json() == {"success": True}
    out = db.log("account.logout")[-1]
    assert (out["actor_name"], out["target_label"]) == ("Sara", "Sara")
    # The activity page can filter on them
    rows = client.get("/api/merchant-activity?action=access", headers=OWNER).json()["data"]
    assert [x["action"] for x in rows] == ["account.logout", "account.login"]


def test_failed_sign_in_is_not_logged_as_a_sign_in(client, db):
    next(a for a in db.t["merchant_admins"] if a["id"] == 11)["password_hash"] = hash_password("sara-secret-1")
    client.post("/api/auth/admin-login", json={"email": "sara@cake.test", "password": "wrong-password"})
    assert db.log("account.login") == []


# ── The dashboard ───────────────────────────────────────────────


def _at(days_ago: int, hour: int = 12) -> str:
    d = datetime.now(SHOP_TZ).replace(hour=hour, minute=0, second=0, microsecond=0) - timedelta(days=days_ago)
    return d.isoformat()


@pytest.fixture
def sales(db):
    db.t["orders"] = [
        {"id": 100, "merchant_id": 1, "status": "pending", "total": 10, "created_at": _at(0), "order_code": "FS-1"},
        {"id": 101, "merchant_id": 1, "status": "delivered", "total": 20, "platform_discount_amount": 2, "created_at": _at(1)},
        {"id": 102, "merchant_id": 1, "status": "cancelled", "total": 50, "created_at": _at(2)},
        {"id": 103, "merchant_id": 1, "status": "shipped", "total": 30, "created_at": _at(3)},
        {"id": 104, "merchant_id": 1, "status": "delivered", "total": 8, "created_at": _at(10)},   # previous 7-day period
        {"id": 200, "merchant_id": 2, "status": "delivered", "total": 999, "created_at": _at(0)},  # another shop
    ]
    db.t["order_items"] = [
        {"order_id": 100, "product_id": 5, "product_name": "Matcha Cake", "quantity": 1, "subtotal": 10},
        {"order_id": 101, "product_id": 5, "product_name": "Matcha Cake", "quantity": 2, "subtotal": 20},
        {"order_id": 103, "product_id": 9, "product_name": "Tea", "quantity": 1, "subtotal": 30},
        {"order_id": 102, "product_id": 9, "product_name": "Tea", "quantity": 9, "subtotal": 50},  # cancelled
        {"order_id": 200, "product_id": 6, "product_name": "Other Thing", "quantity": 99, "subtotal": 999},
    ]
    return db


def test_owner_dashboard(client, sales):
    client.patch("/api/products/5", json={"description": "Fresh"}, headers=OWNER)
    body = client.get("/api/merchant-dashboard?days=7", headers=OWNER).json()
    o = body["orders"]
    assert (o["waiting"], o["in_progress"], o["today"], o["period"], o["delivered"], o["cancelled"]) == (1, 1, 1, 4, 1, 1)
    s = body["sales"]
    assert s["today"] == 10 and s["period"] == 62  # 10 + (20 + 2 platform-funded) + 30; cancelled excluded
    assert s["previous_period"] == 8 and s["change_pct"] == 675.0
    assert s["paid_orders"] == 3 and s["average_order_value"] == 20.67
    assert len(s["daily"]) == 7 and sum(d["revenue"] for d in s["daily"]) == 62
    assert [(p["name"], p["quantity"]) for p in body["top_products"]] == [("Matcha Cake", 3), ("Tea", 1)]
    assert "Other Thing" not in str(body)
    assert body["recent_activity"][0]["action"] == "product.updated"


def test_staff_dashboard_shows_orders_only(client, sales):
    body = client.get("/api/merchant-dashboard?days=7", headers=STAFF).json()
    assert body["role"] == "staff" and body["orders"]["waiting"] == 1
    assert body["sales"] is None and body["top_products"] is None and body["recent_activity"] is None


def test_manager_dashboard_has_sales_and_activity(client, sales):
    body = client.get("/api/merchant-dashboard?days=7", headers=MANAGER).json()
    assert body["sales"]["period"] == 62 and body["recent_activity"] == []


def test_dashboard_is_for_shop_accounts(client):
    assert client.get("/api/merchant-dashboard", headers=SUPER).status_code == 403
