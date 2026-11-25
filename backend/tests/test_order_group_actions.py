"""Accept / Reject in the shop's Telegram order group, end to end.

Runs the real tap handler, the real order_status.change_status, the real refund recording and the real
activity log against an in-memory database (selects return only the asked-for columns, updates are
conditional like PostgREST). Telegram is replaced by a recorder of sent and edited messages.

Covers (decisions 2026-11-25): cash accept and reject with reasons; paid "can't fulfil – cancel &
refund"; permissions for owner, manager, staff, unlinked people and another shop's staff; the wrong
group; two people tapping at once; dashboard and customer actions redrawing the group message; the
activity log naming the person and saying it was done in Telegram.
"""

import asyncio
from datetime import datetime, timezone

import pytest

from app.core.constants import Role
from app.core.exceptions import ForbiddenError
from app.core.security import TokenClaims
from app.routes import orders as orders_route
from app.services import (
    coupons, deliveries, inventory, loyalty, notify, order_group, settlement,
)

GROUP, OTHER_GROUP = -1001, -2002
OWNER_TG, MANAGER_TG, STAFF_TG, STRANGER_TG, OTHER_SHOP_TG = 11, 22, 33, 44, 55


class Q:
    def __init__(self, db, table):
        self.db, self.table, self.tests = db, table, []

    def _t(self, f): self.tests.append(f); return self
    def eq(self, c, v): return self._t(lambda r: r.get(c) == v)
    def neq(self, c, v): return self._t(lambda r: r.get(c) != v)
    def in_(self, c, vs): return self._t(lambda r: r.get(c) in list(vs))
    def is_(self, c, v): return self._t(lambda r: r.get(c) is None)
    def not_(self, c, op, v): return self._t(lambda r: r.get(c) is not None)
    def order(self, *a, **k): return self
    def limit(self, n): return self

    def _rows(self):
        return [r for r in self.db.t.setdefault(self.table, []) if all(t(r) for t in self.tests)]

    async def select(self, columns="*"):
        await asyncio.sleep(0)
        rows = [dict(r) for r in self._rows()]
        if not columns or columns.strip() == "*":
            return rows
        keep = [c.strip() for c in columns.split(",")]
        return [{k: r.get(k) for k in keep} for r in rows]

    async def select_one(self, columns="*"):
        rows = await self.select(columns)
        return rows[0] if rows else None

    async def update(self, data):
        await asyncio.sleep(0)
        rows = self._rows()   # match and write in one step, like UPDATE … WHERE
        for r in rows:
            r.update(data)
        return [dict(r) for r in rows]

    async def insert(self, data):
        rows = self.db.t.setdefault(self.table, [])
        row = {"id": len(rows) + 1, "created_at": datetime.now(timezone.utc).isoformat(), **data}
        rows.append(row)
        return [dict(row)]


class DB:
    def __init__(self):
        self.t = {
            "merchants": [{"id": 3, "name": "Bloom & Co.", "telegram_group_id": GROUP},
                          {"id": 4, "name": "Other Shop", "telegram_group_id": OTHER_GROUP}],
            "merchant_admins": [
                {"id": 1, "merchant_id": 3, "full_name": "Justin", "email": "o@b", "role": "owner", "telegram_id": OWNER_TG, "is_active": True},
                {"id": 2, "merchant_id": 3, "full_name": "Mia", "email": "m@b", "role": "manager", "telegram_id": MANAGER_TG, "is_active": True},
                {"id": 3, "merchant_id": 3, "full_name": "Sok", "email": "s@b", "role": "staff", "telegram_id": STAFF_TG, "is_active": True},
                {"id": 4, "merchant_id": 4, "full_name": "Elsewhere", "email": "e@o", "role": "owner", "telegram_id": OTHER_SHOP_TG, "is_active": True},
            ],
            "orders": [
                {"id": 50, "order_code": "FS-COD", "merchant_id": 3, "user_id": 7, "status": "pending", "payment_method": "cod",
                 "payment_status": "pending", "total": "12.00", "delivery_address": "St 51", "customer_name": "Ana <VIP>",
                 "customer_phone": "012", "delivery_type": "delivery", "telegram_group_message_id": None},
                {"id": 60, "order_code": "FS-PAID", "merchant_id": 3, "user_id": 7, "status": "confirmed", "payment_method": "khqr",
                 "payment_status": "paid", "payment_ref": "apv-9", "total": "30.00", "delivery_address": "St 63", "customer_name": "Bo",
                 "customer_phone": "013", "delivery_type": "delivery", "telegram_group_message_id": None},
            ],
            "order_items": [{"order_id": 50, "product_name": "Rose bouquet", "quantity": 1, "unit_price": 12, "subtotal": 12,
                             "product_id": 1, "selected_variants": None},
                            {"order_id": 60, "product_name": "Dress", "quantity": 1, "unit_price": 30, "subtotal": 30,
                             "product_id": 2, "selected_variants": None}],
            "merchant_audit_log": [], "refunds": [], "settlement_audit_log": [], "notifications": [],
        }

    def from_(self, table):
        return Q(self, table)

    def order(self, oid):
        return next(o for o in self.t["orders"] if o["id"] == oid)


@pytest.fixture
def env(monkeypatch):
    db = DB()
    tg = {"sent": [], "edited": []}
    side = {"released": [], "notified": []}

    async def send(chat_id, text, rows):
        tg["sent"].append({"chat": chat_id, "text": text, "buttons": rows})
        return 900 + len(tg["sent"])

    async def edit(chat_id, message_id, text, rows):
        tg["edited"].append({"chat": chat_id, "msg": message_id, "text": text, "buttons": rows})

    async def noop(*a, **k):
        return None

    async def release(db_, items):
        side["released"].append(len(items))

    async def status_notice(db_, order_id, status, **k):
        side["notified"].append((order_id, status))

    monkeypatch.setattr(order_group, "_send", send)
    monkeypatch.setattr(order_group, "_edit", edit)
    monkeypatch.setattr(settlement, "on_order_status_changed", noop)
    monkeypatch.setattr(inventory, "release_stock", release)
    monkeypatch.setattr(coupons, "release_for_order", noop)
    monkeypatch.setattr(loyalty, "on_order_cancelled", noop)
    monkeypatch.setattr(deliveries, "order_cancelled", noop)
    monkeypatch.setattr(notify, "order_status_changed", status_notice)
    monkeypatch.setattr(notify, "notify_user", noop)
    return db, tg, side


def run(c):
    return asyncio.run(c)


def tap(db, data, tg_id, chat=GROUP, msg=901):
    return run(order_group.apply_tap(db, chat_id=chat, message_id=msg, telegram_id=tg_id, data=data))


def labels(rows):
    return [b[0] for row in (rows or []) for b in row]


# ── Posting ─────────────────────────────────────────────────────

def test_cash_order_is_posted_with_accept_and_reject(env):
    db, tg, _ = env
    assert run(order_group.post_new(db, 50)) == 901
    (sent,) = tg["sent"]
    assert sent["chat"] == GROUP and labels(sent["buttons"]) == ["✅ Accept", "✖ Reject"]
    assert "Ana &lt;VIP&gt;" in sent["text"]   # customer text is escaped, never parsed as HTML
    assert db.order(50)["telegram_group_message_id"] == 901


def test_paid_order_is_posted_with_cancel_and_refund(env):
    db, tg, _ = env
    run(order_group.post_new(db, 60))
    assert labels(tg["sent"][0]["buttons"]) == ["✖ Can't fulfil – cancel & refund"]
    assert "PAID ✅" in tg["sent"][0]["text"]


# ── Cash: accept and reject ─────────────────────────────────────

def test_staff_accepts_a_cash_order(env):
    db, tg, side = env
    out = tap(db, "oa:acc:50", STAFF_TG)
    assert out["answer"] == "Accepted ✅" and db.order(50)["status"] == "confirmed"
    (edit,) = tg["edited"]
    assert edit["buttons"] is None and "✅ Accepted by Sok" in edit["text"]
    assert side["notified"] == [(50, "confirmed")]          # the customer is told, as from the dashboard
    (log,) = db.t["merchant_audit_log"]
    assert log["action"] == "order.accepted" and log["actor_name"] == "Sok" and log["actor_type"] == "staff"
    assert log["new_value"]["via"] == "Telegram"


def test_reject_asks_why_then_rejects_with_the_reason(env):
    db, tg, side = env
    first = tap(db, "oa:rej:50", MANAGER_TG)
    assert db.order(50)["status"] == "pending"                  # nothing happens yet
    assert labels(tg["edited"][-1]["buttons"]) == ["Out of stock", "Shop is closed", "Can't deliver there", "Other", "‹ Back"]
    tap(db, "oa:back:50", MANAGER_TG)
    assert labels(tg["edited"][-1]["buttons"]) == ["✅ Accept", "✖ Reject"]   # back to the start
    tap(db, "oa:rej:50", MANAGER_TG)
    out = tap(db, "oa:rr:50:oos", MANAGER_TG)
    o = db.order(50)
    assert out["answer"] == "Rejected" and o["status"] == "cancelled" and o["admin_note"] == "Rejected in Telegram: Out of stock"
    assert side["released"] == [1]                               # stock goes back
    assert "✖ Rejected by Mia · Out of stock" in tg["edited"][-1]["text"] and tg["edited"][-1]["buttons"] is None
    (log,) = db.t["merchant_audit_log"]
    assert log["action"] == "order.rejected" and log["actor_name"] == "Mia" and log["new_value"]["note"] == "Out of stock"
    assert db.t["refunds"] == []                                 # cash: nothing to refund
    assert first["alert"] is False


# ── Paid: cancel & refund ───────────────────────────────────────

def test_owner_cancels_a_paid_order_and_the_refund_is_recorded(env):
    db, tg, _ = env
    tap(db, "oa:rej:60", OWNER_TG)
    out = tap(db, "oa:rr:60:area", OWNER_TG)
    assert out["answer"] == "Cancelled; the customer will be refunded"
    assert db.order(60)["status"] == "cancelled" and db.order(60)["admin_note"] == "Cancelled in Telegram: Can't deliver there"
    (refund,) = db.t["refunds"]
    assert refund["order_id"] == 60 and refund["amount"] == "30.00" and refund["reason"] == "order_cancelled"
    assert refund["requested_by_type"] == "merchant_admin" and refund["requested_by_id"] == "1"
    actions = [r["action"] for r in db.t["merchant_audit_log"]]
    assert "refund.requested" in actions and "order.status_changed" in actions
    assert "the customer will be refunded" in tg["edited"][-1]["text"]


# ── Permissions ─────────────────────────────────────────────────

def test_staff_cannot_reject_or_cancel(env):
    db, tg, _ = env
    out = tap(db, "oa:rej:50", STAFF_TG)
    assert out["alert"] and "can't reject" in out["answer"] and tg["edited"] == []
    out = tap(db, "oa:rr:50:oos", STAFF_TG)              # even with a hand-made reason tap
    assert out["alert"] and db.order(50)["status"] == "pending"
    assert tap(db, "oa:rej:60", STAFF_TG)["alert"]


@pytest.mark.parametrize("who", [STRANGER_TG, OTHER_SHOP_TG])
def test_people_outside_the_shop_cannot_act(env, who):
    db, tg, _ = env
    out = tap(db, "oa:acc:50", who)
    assert out["alert"] and "Only this shop's team" in out["answer"]
    assert db.order(50)["status"] == "pending" and tg["edited"] == [] and db.t["merchant_audit_log"] == []


def test_a_deactivated_account_cannot_act(env):
    db, _, _ = env
    db.t["merchant_admins"][2]["is_active"] = False
    assert tap(db, "oa:acc:50", STAFF_TG)["alert"] and db.order(50)["status"] == "pending"


def test_taps_only_count_in_the_shops_own_group(env):
    db, _, _ = env
    out = tap(db, "oa:acc:50", OWNER_TG, chat=OTHER_GROUP)
    assert out["alert"] and "another shop" in out["answer"] and db.order(50)["status"] == "pending"


@pytest.mark.parametrize("data", ["oa:acc:x", "oa:rr:50:bogus", "oa:dance:50", "xx:acc:50", "", None])
def test_bad_button_data(env, data):
    db, _, _ = env
    assert tap(db, data, OWNER_TG)["alert"] and db.order(50)["status"] == "pending"


# ── Races and stale buttons ─────────────────────────────────────

def test_two_people_accept_at_once(env):
    db, tg, side = env

    async def both():
        return await asyncio.gather(
            order_group.apply_tap(db, chat_id=GROUP, message_id=901, telegram_id=OWNER_TG, data="oa:acc:50"),
            order_group.apply_tap(db, chat_id=GROUP, message_id=901, telegram_id=STAFF_TG, data="oa:acc:50"),
        )

    a, b = run(both())
    answers = sorted([a["answer"], b["answer"]])
    assert answers[0] == "Accepted ✅" and answers[1].startswith("Already accepted")
    assert side["notified"] == [(50, "confirmed")]                 # the customer is told once
    assert len(db.t["merchant_audit_log"]) == 1                    # one log entry


def test_accept_and_reject_at_once(env):
    db, _, side = env

    async def both():
        return await asyncio.gather(
            order_group.apply_tap(db, chat_id=GROUP, message_id=901, telegram_id=STAFF_TG, data="oa:acc:50"),
            order_group.apply_tap(db, chat_id=GROUP, message_id=901, telegram_id=OWNER_TG, data="oa:rr:50:closed"),
        )

    results = run(both())
    assert sum(1 for r in results if not r["alert"]) == 1          # exactly one wins
    assert db.order(50)["status"] in ("confirmed", "cancelled")
    assert len(side["notified"]) == 1 and len(db.t["merchant_audit_log"]) == 1


def test_a_stale_button_after_the_dashboard_accepted(env):
    db, tg, _ = env
    db.order(50)["status"] = "confirmed"
    out = tap(db, "oa:acc:50", OWNER_TG)
    assert out["alert"] and "already accepted" in out["answer"]
    assert tg["edited"][-1]["buttons"] is None                     # the message is brought up to date


# ── Dashboard and customer actions redraw the group message ─────

OWNER_TOKEN = TokenClaims(sub="1", role=Role.MERCHANT_ADMIN, merchant_id=3, merchant_role="owner", name="Justin")
STAFF_TOKEN = TokenClaims(sub="3", role=Role.MERCHANT_ADMIN, merchant_id=3, merchant_role="staff", name="Sok")


def use_db(monkeypatch, db):
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def service_role():
        yield db
    monkeypatch.setattr(orders_route.SupabaseClient, "service_role", service_role)


def test_dashboard_accept_updates_the_group_message(env, monkeypatch):
    db, tg, _ = env
    run(order_group.post_new(db, 50))
    use_db(monkeypatch, db)
    run(orders_route.update_order_status(50, {"status": "confirmed"}, user=STAFF_TOKEN))
    edit = tg["edited"][-1]
    assert edit["msg"] == 901 and edit["buttons"] is None and "✅ Accepted by Sok in the dashboard" in edit["text"]
    assert db.t["merchant_audit_log"][-1].get("new_value", {}).get("via") is None   # not marked as Telegram


def test_dashboard_cancel_of_a_paid_order_updates_the_message(env, monkeypatch):
    db, tg, _ = env
    run(order_group.post_new(db, 60))
    use_db(monkeypatch, db)
    run(orders_route.update_order_status(60, {"status": "cancelled", "admin_note": "Damaged in stock"}, user=OWNER_TOKEN))
    edit = tg["edited"][-1]
    assert "✖ Cancelled by Justin in the dashboard · Damaged in stock · the customer will be refunded" in edit["text"]
    assert edit["buttons"] is None and len(db.t["refunds"]) == 1


def test_dashboard_permission_still_applies(env, monkeypatch):
    db, tg, _ = env
    use_db(monkeypatch, db)
    with pytest.raises(ForbiddenError):
        run(orders_route.update_order_status(50, {"status": "cancelled"}, user=STAFF_TOKEN))
    assert tg["edited"] == []


def test_no_message_stored_means_nothing_to_redraw(env, monkeypatch):
    db, tg, _ = env   # order 50 was never posted (e.g. the shop had no group then)
    use_db(monkeypatch, db)
    run(orders_route.update_order_status(50, {"status": "confirmed"}, user=OWNER_TOKEN))
    assert tg["edited"] == [] and db.order(50)["status"] == "confirmed"


def test_customer_cancelling_updates_the_message(env, monkeypatch):
    db, tg, _ = env
    db.t["users"] = [{"id": 7, "telegram_id": 777}]
    run(order_group.post_new(db, 50))
    use_db(monkeypatch, db)
    customer = TokenClaims(sub="u7", role=Role.USER, telegram_id=777)
    run(orders_route.cancel_order(50, user=customer))
    edit = tg["edited"][-1]
    assert db.order(50)["status"] == "cancelled" and edit["msg"] == 901 and edit["buttons"] is None
    assert "✖ Cancelled by the customer" in edit["text"]
