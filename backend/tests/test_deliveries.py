"""Delivery MVP: assigning a driver, the driver's job flow, and keeping order and delivery in step (database faked).

The fake keeps what matters: `orders.id`, `drivers.user_id` and `deliveries.order_id` are unique (a second
insert fails with 23505), conditional updates are atomic, and with `migrated=False` the drivers and
deliveries tables do not exist (PGRST205), exactly like the database before migration 028.
"""

import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.constants import Role
from app.core.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims, mint_jwt
from app.db.client import SupabaseClient
from app.main import app
from app.models.delivery import AssignRequest, AvailabilityUpdate, DriverCreate, DriverUpdate, JobActionRequest
from app.routes import deliveries as route
from app.routes import orders as orders_route
from app.services import deliveries, delivery_code, notify, order_status

UNIQUE = {"drivers": "user_id", "deliveries": "order_id"}
NEW_TABLES = ("drivers", "deliveries")


def pg_error(code, message="error", status=400):
    req = httpx.Request("POST", "http://db/x")
    return httpx.HTTPStatusError("e", request=req, response=httpx.Response(status, json={"code": code, "message": message}, request=req))


class Q:
    def __init__(self, db, table):
        self.db, self.table, self.f, self.order_by, self.max = db, table, [], None, None

    def _check(self):
        # like the real client: building a query is free, running it against a missing table fails
        if not self.db.migrated and self.table in NEW_TABLES:
            raise pg_error("PGRST205", f"Could not find the table 'public.{self.table}'", 404)

    def _add(self, *c): self.f.append(c); return self
    def eq(self, col, val): return self._add("eq", col, val)
    def in_(self, col, vals): return self._add("in", col, list(vals))

    def or_(self, *conds):
        parsed = []
        for c in conds:
            col, op, *val = c.split(".")
            parsed.append((col, op, ".".join(val)))
        return self._add("or", parsed, None)

    def order(self, col, *, desc=False, nulls_last=False): self.order_by = (col, desc); return self
    def limit(self, n): self.max = n; return self

    def _ok(self, r):
        for op, col, val in self.f:
            if op == "eq" and r.get(col) != val: return False
            if op == "in" and r.get(col) not in val: return False
            if op == "or":
                hit = False
                for c, o, v in col:
                    if o == "is" and v == "null" and r.get(c) is None: hit = True
                    if o == "eq" and str(r.get(c)) == v: hit = True
                if not hit: return False
        return True

    def _rows(self):
        rows = [r for r in self.db.tables.setdefault(self.table, []) if self._ok(r)]
        if self.order_by:
            col, desc = self.order_by
            rows = sorted(rows, key=lambda r: str(r.get(col) or ""), reverse=desc)
        return rows[: self.max] if self.max else rows

    async def select(self, *_):
        self._check()
        await asyncio.sleep(0)
        return [dict(r) for r in self._rows()]

    async def select_one(self, *_):
        rows = await self.select()
        return rows[0] if rows else None

    async def insert(self, data):
        self._check()
        await asyncio.sleep(0)
        rows = self.db.tables.setdefault(self.table, [])
        for row in (data if isinstance(data, list) else [data]):
            key = UNIQUE.get(self.table)
            if key and any(r.get(key) == row.get(key) for r in rows):
                raise pg_error("23505", "duplicate key value violates unique constraint", 409)
            self.db.next_id += 1
            rows.append({"id": self.db.next_id, **row})
        return [dict(rows[-1])]

    async def update(self, data):
        self._check()
        await asyncio.sleep(0)
        rows = self._rows()  # match and write in one step, like a single UPDATE ... WHERE
        for r in rows: r.update(data)
        return [dict(r) for r in rows]


class Db:
    def __init__(self, migrated=True):
        self.migrated, self.next_id = migrated, 1000
        self.tables = {
            "users": [{"id": 1, "telegram_id": 111}] + [{"id": i, "telegram_id": 1000 + i} for i in range(10, 16)],
            "merchants": [
                {"id": 3, "name": "Bloom", "phone": "012111111", "address": "Shop St 3", "latitude": 11.5, "longitude": 104.9},
                {"id": 4, "name": "Cakes", "phone": "012222222", "address": "Shop St 4", "latitude": 11.6, "longitude": 104.8},
            ],
            "orders": [], "order_items": [{"id": 1, "order_id": 50, "product_name": "shirt", "quantity": 2}],
            "notifications": [], "drivers": [], "deliveries": [],
        }
        self.pushes, self.driver_pushes = [], []
        self.add_driver(1, user=10, name="Platform Pat")                 # platform driver
        self.add_driver(2, user=11, name="Platform Pia")
        self.add_driver(3, user=12, name="Bloom Rider", merchant=3)      # Bloom's own rider
        self.add_driver(4, user=13, name="Cakes Rider", merchant=4)      # another shop's rider
        self.add_driver(5, user=14, name="Switched Off", active=False)
        self.add_order(50)

    def from_(self, table): return Q(self, table)

    def add_driver(self, id, *, user, name, merchant=None, active=True, available=True):
        self.tables["drivers"].append({"id": id, "user_id": user, "merchant_id": merchant, "full_name": name, "phone": f"0{id}00000",
                                       "vehicle": "Honda", "is_active": active, "is_available": available})

    def add_order(self, id, *, status="confirmed", delivery_type="delivery", merchant=3, payment="cod", payment_status="pending"):
        self.tables["orders"].append({
            "id": id, "order_code": f"FS-{id}", "user_id": 1, "merchant_id": merchant, "status": status, "delivery_type": delivery_type,
            "total": 21.6, "payment_method": payment, "payment_status": payment_status, "delivery_name": "Mai", "delivery_phone": "0123",
            "delivery_address": "Home 1", "delivery_latitude": 11.55, "delivery_longitude": 104.92, "distance_km": 2.1, "customer_note": "ring",
        })

    def row(self, table, row_id): return next(r for r in self.tables[table] if r["id"] == row_id)
    def order_status(self, id): return self.row("orders", id)["status"]
    def delivery(self, order_id): return next((r for r in self.tables["deliveries"] if r["order_id"] == order_id), None)
    def notes(self, **m): return [n for n in self.tables["notifications"] if all(n.get(k) == v for k, v in m.items())]


@pytest.fixture
def db(monkeypatch):
    from contextlib import asynccontextmanager
    database = Db()
    calls = {"settled": []}

    @asynccontextmanager
    async def service_role():
        yield database

    async def noop(*a, **k): return None

    async def settled(db_, order_id, status, **k): calls["settled"].append((order_id, status))

    async def push(db_, order, title, body): database.pushes.append((order["id"], title))

    async def push_driver(db_, driver, *, title, body): database.driver_pushes.append((driver["id"], title))

    monkeypatch.setattr(SupabaseClient, "service_role", staticmethod(service_role))
    monkeypatch.setattr(order_status.settlement, "on_order_status_changed", settled)
    monkeypatch.setattr(order_status.inventory, "release_stock", noop)
    monkeypatch.setattr(notify, "_push", push)
    monkeypatch.setattr(notify, "push_to_driver", push_driver)
    database.calls = calls
    return database


def run(coro): return asyncio.run(coro)


def tg(driver_id): return TokenClaims(sub=str(driver_id), role=Role.USER, telegram_id=1000 + {1: 10, 2: 11, 3: 12, 4: 13, 5: 14}[driver_id])
CUSTOMER = TokenClaims(sub="1", role=Role.USER, telegram_id=111)
BLOOM = TokenClaims(sub="9", role=Role.MERCHANT_ADMIN, merchant_id=3)
CAKES = TokenClaims(sub="8", role=Role.MERCHANT_ADMIN, merchant_id=4)
SUPER = TokenClaims(sub="1", role=Role.SUPER_ADMIN)


def assign(db, driver_id, order_id=50, user=BLOOM):
    return run(route.assign_driver(order_id, AssignRequest(driver_id=driver_id), user=user))


def act(db, driver_id, action, order_id=50, reason=None, code=None):
    # "deliver" needs the customer's code; by default give the right one
    if action == "deliver" and code is None:
        code = delivery_code.code_for(order_id)
    body = JobActionRequest(reason=reason, code=code) if (reason or code) else None
    return run(route.job_action(order_id, action, body, user=tg(driver_id)))


# ── assigning ──────────────────────────────────────────────────────

def test_shop_assigns_a_platform_driver(db):
    assert assign(db, 1)["data"] == {"status": "assigned"}
    d = db.delivery(50)
    assert (d["driver_id"], d["status"], d["assigned_by"]) == (1, "assigned", "merchant_admin:9")
    note = db.notes(user_id=10)[0]
    assert (note["title"], note["link"], note["kind"]) == ("New delivery", "/shop/driver", "delivery_assigned")
    assert "Bloom" in note["body"] and "Home 1" in note["body"] and "FS-50" in note["body"]
    assert db.driver_pushes == [(1, "New delivery")]


def test_shop_assigns_its_own_rider(db):
    assert assign(db, 3)["success"]


def test_only_delivery_orders_need_a_driver(db):
    db.add_order(51, delivery_type="pickup")
    with pytest.raises(BadRequestError):
        assign(db, 1, order_id=51)


@pytest.mark.parametrize("status", ["pending", "shipped", "delivered", "cancelled"])
def test_order_must_be_accepted_and_not_yet_gone(db, status):
    db.row("orders", 50)["status"] = status
    with pytest.raises(BadRequestError):
        assign(db, 1)
    assert db.delivery(50) is None


def test_another_shops_rider_is_refused(db):
    with pytest.raises(ForbiddenError):
        assign(db, 4)


@pytest.mark.parametrize("driver_id", [5])
def test_switched_off_driver_is_refused(db, driver_id):
    with pytest.raises(BadRequestError):
        assign(db, driver_id)


def test_driver_off_shift_is_refused(db):
    db.row("drivers", 1)["is_available"] = False
    with pytest.raises(BadRequestError):
        assign(db, 1)


def test_unknown_driver_is_not_found(db):
    with pytest.raises(NotFoundError):
        assign(db, 999)


def test_a_shop_cannot_assign_for_another_shops_order(db):
    with pytest.raises(ForbiddenError):
        assign(db, 4, user=CAKES)


def test_super_admin_can_assign_any_order(db):
    assert assign(db, 1, user=SUPER)["success"]
    assert db.delivery(50)["assigned_by"] == "super_admin:1"


def test_reassigning_replaces_the_driver(db):
    assign(db, 1)
    assign(db, 2)
    assert db.delivery(50)["driver_id"] == 2 and len(db.tables["deliveries"]) == 1
    assert run(deliveries.jobs(db, db.row("drivers", 1), "active")) == []   # the first driver no longer has it
    assert len(run(deliveries.jobs(db, db.row("drivers", 2), "active"))) == 1


def test_two_shops_assigning_at_once_make_one_delivery(db):
    async def go():
        return await asyncio.gather(
            route.assign_driver(50, AssignRequest(driver_id=1), user=BLOOM),
            route.assign_driver(50, AssignRequest(driver_id=2), user=SUPER), return_exceptions=True)

    results = run(go())
    assert len(db.tables["deliveries"]) == 1
    assert sum(isinstance(r, dict) for r in results) + sum(isinstance(r, ConflictError) for r in results) == 2


def test_cannot_reassign_once_the_driver_has_the_parcel(db):
    assign(db, 1)
    act(db, 1, "accept"); act(db, 1, "pickup")
    with pytest.raises((ConflictError, BadRequestError)):
        assign(db, 2)


def test_unassigning_takes_the_job_away_and_tells_the_driver(db):
    assign(db, 1)
    run(route.unassign_driver(50, user=BLOOM))
    assert db.delivery(50)["status"] == "cancelled"
    assert run(deliveries.jobs(db, db.row("drivers", 1), "active")) == []
    assert db.notes(user_id=10)[-1]["title"] == "Delivery taken off you"
    assign(db, 2)  # and the shop can give it to someone else
    assert db.delivery(50)["driver_id"] == 2


def test_cannot_unassign_after_pickup(db):
    assign(db, 1); act(db, 1, "accept"); act(db, 1, "pickup")
    with pytest.raises(BadRequestError):
        run(route.unassign_driver(50, user=BLOOM))


def test_assignable_drivers_are_platform_plus_own_shop(db):
    names = {d["full_name"] for d in run(route.drivers_for_order(50, user=BLOOM))["data"]}
    assert names == {"Platform Pat", "Platform Pia", "Bloom Rider"}  # not Cakes Rider, not the switched-off one
    assign(db, 1)
    pat = next(d for d in run(route.drivers_for_order(50, user=BLOOM))["data"] if d["id"] == 1)
    assert pat["active_jobs"] == 1


# ── the driver's job ───────────────────────────────────────────────

def test_full_delivery_moves_the_order_with_it(db):
    assign(db, 1)
    act(db, 1, "accept")
    assert db.delivery(50)["status"] == "accepted" and db.order_status(50) == "confirmed"
    act(db, 1, "pickup")
    assert (db.delivery(50)["status"], db.order_status(50)) == ("picked_up", "shipped")  # confirmed -> preparing -> out
    act(db, 1, "deliver")
    d = db.delivery(50)
    assert (d["status"], db.order_status(50)) == ("delivered", "delivered")
    assert d["accepted_at"] and d["picked_up_at"] and d["delivered_at"]
    assert (50, "delivered") in db.calls["settled"]  # the shop's earning becomes payable, same as a shop-side delivery


def test_customer_is_told_at_each_step(db):
    assign(db, 1); act(db, 1, "accept"); act(db, 1, "pickup"); act(db, 1, "deliver")
    assert [n["title"] for n in db.notes(user_id=1)] == ["Preparing your order", "Out for delivery", "Order delivered", "How was your order?"]
    assert [t for _, t in db.pushes] == ["Out for delivery", "Order delivered"]


def test_pickup_when_the_shop_already_started_preparing(db):
    db.row("orders", 50)["status"] = "processing"
    assign(db, 1); act(db, 1, "accept"); act(db, 1, "pickup")
    assert db.order_status(50) == "shipped"


def test_steps_must_come_in_order(db):
    assign(db, 1)
    for action in ("pickup", "deliver"):
        with pytest.raises(BadRequestError):
            act(db, 1, action)
    act(db, 1, "accept")
    with pytest.raises(BadRequestError):
        act(db, 1, "deliver")  # not picked up yet
    with pytest.raises(BadRequestError):
        act(db, 1, "accept")   # already accepted
    assert db.order_status(50) == "confirmed"


def test_unknown_action_is_refused(db):
    assign(db, 1)
    with pytest.raises(BadRequestError):
        act(db, 1, "teleport")


def test_a_driver_cannot_touch_someone_elses_job(db):
    assign(db, 1)
    with pytest.raises(NotFoundError):
        act(db, 2, "accept")
    assert db.delivery(50)["status"] == "assigned"


def test_double_tap_on_pickup_moves_the_order_once(db):
    assign(db, 1); act(db, 1, "accept")

    async def go():
        return await asyncio.gather(route.job_action(50, "pickup", None, user=tg(1)),
                                    route.job_action(50, "pickup", None, user=tg(1)), return_exceptions=True)

    results = run(go())
    assert sum(isinstance(r, dict) for r in results) == 1
    assert db.order_status(50) == "shipped"
    assert [n["title"] for n in db.notes(user_id=1)].count("Out for delivery") == 1


def test_declining_frees_the_order_and_tells_the_shop(db):
    assign(db, 1)
    act(db, 1, "decline")
    assert db.delivery(50)["status"] == "declined"
    assert run(deliveries.jobs(db, db.row("drivers", 1), "active")) == []
    assert db.notes(merchant_id=3)[-1]["title"] == "Driver declined"
    assign(db, 2)
    assert db.delivery(50)["driver_id"] == 2


def test_cannot_decline_after_pickup(db):
    assign(db, 1); act(db, 1, "accept"); act(db, 1, "pickup")
    with pytest.raises(BadRequestError):
        act(db, 1, "decline")


def test_failed_delivery_needs_a_reason_and_alerts_the_shop(db):
    assign(db, 1); act(db, 1, "accept"); act(db, 1, "pickup")
    with pytest.raises(BadRequestError):
        act(db, 1, "fail")                     # no reason at all
    with pytest.raises(BadRequestError):
        act(db, 1, "fail", reason="   ")       # long enough for the request model, but blank
    assert db.delivery(50)["status"] == "picked_up"  # nothing changed
    act(db, 1, "fail", reason="Nobody home")
    d = db.delivery(50)
    assert (d["status"], d["failure_reason"], db.order_status(50)) == ("failed", "Nobody home", "shipped")
    assert "Nobody home" in db.notes(merchant_id=3)[-1]["body"]


def test_after_a_failed_delivery_the_shop_can_send_another_driver(db):
    assign(db, 1); act(db, 1, "accept"); act(db, 1, "pickup"); act(db, 1, "fail", reason="Nobody home")
    assign(db, 2)                                 # the order is already "shipped"; this is the retry
    d = db.delivery(50)
    assert (d["driver_id"], d["status"], d["failure_reason"]) == (2, "assigned", None)
    act(db, 2, "accept"); act(db, 2, "pickup"); act(db, 2, "deliver")
    assert db.order_status(50) == "delivered"


def test_cancelling_the_order_cancels_the_job_and_tells_the_driver(db):
    assign(db, 1); act(db, 1, "accept")
    run(order_status.change_status(db, db.row("orders", 50), "cancelled", actor_type="merchant_admin", actor_id="9"))
    assert db.delivery(50)["status"] == "cancelled"
    assert db.notes(user_id=10)[-1]["title"] == "Delivery cancelled"
    for action in ("pickup", "deliver"):
        with pytest.raises(BadRequestError):
            act(db, 1, action)


def test_shop_delivering_by_itself_closes_the_delivery(db):
    assign(db, 1); act(db, 1, "accept"); act(db, 1, "pickup")
    run(order_status.change_status(db, db.row("orders", 50), "delivered", actor_type="merchant_admin", actor_id="9"))
    assert db.delivery(50)["status"] == "delivered"


def test_pickup_before_the_shop_accepted_is_refused(db):
    db.row("orders", 50)["status"] = "confirmed"
    assign(db, 1); act(db, 1, "accept")
    db.row("orders", 50)["status"] = "pending"
    with pytest.raises(BadRequestError):
        act(db, 1, "pickup")
    assert db.delivery(50)["status"] == "accepted"


# ── what the driver and customer can see ───────────────────────────

def test_driver_sees_what_they_need_for_the_job(db):
    assign(db, 1); act(db, 1, "accept")
    job = run(route.my_jobs("active", user=tg(1)))["data"][0]
    assert job["delivery"]["status"] == "accepted"
    assert (job["order"]["code"], job["order"]["item_count"], job["order"]["items"]) == ("FS-50", 2, ["2 × shirt"])
    assert (job["shop"]["name"], job["shop"]["address"], job["shop"]["phone"]) == ("Bloom", "Shop St 3", "012111111")
    assert (job["customer"]["name"], job["customer"]["phone"], job["customer"]["address"], job["customer"]["lat"]) == ("Mai", "0123", "Home 1", 11.55)
    assert job["collect_cash"] == 21.6  # cash on delivery: the driver collects the total


def test_online_paid_orders_collect_no_cash(db):
    db.row("orders", 50).update(payment_method="stripe", payment_status="paid")
    assign(db, 1)
    assert run(route.my_jobs("active", user=tg(1)))["data"][0]["collect_cash"] == 0.0


def test_active_and_done_lists_are_separate_and_private(db):
    assign(db, 1); act(db, 1, "accept"); act(db, 1, "pickup"); act(db, 1, "deliver")
    assert run(route.my_jobs("active", user=tg(1)))["data"] == []
    assert len(run(route.my_jobs("done", user=tg(1)))["data"]) == 1
    assert run(route.my_jobs("done", user=tg(2)))["data"] == []         # another driver sees nothing
    with pytest.raises(BadRequestError):
        run(route.my_jobs("everything", user=tg(1)))


def test_customer_sees_who_is_coming_but_not_a_declined_driver(db):
    assert run(deliveries.customer_view(db, 50)) is None
    assign(db, 1)
    view = run(deliveries.customer_view(db, 50))
    assert (view["status"], view["driver"]["name"], view["driver"]["phone"]) == ("assigned", "Platform Pat", "0100000")
    act(db, 1, "decline")
    assert run(deliveries.customer_view(db, 50)) is None


# ── being a driver ─────────────────────────────────────────────────

def test_not_a_driver(db):
    assert run(route.my_driver_profile(user=CUSTOMER)) == {"driver": None}
    with pytest.raises(ForbiddenError):
        run(route.my_jobs("active", user=CUSTOMER))
    with pytest.raises(ForbiddenError):
        run(route.job_action(50, "accept", None, user=CUSTOMER))


def test_switched_off_driver_cannot_work(db):
    assert run(route.my_driver_profile(user=tg(5)))["driver"]["is_active"] is False
    with pytest.raises(ForbiddenError):
        run(route.my_jobs("active", user=tg(5)))


def test_going_off_shift_stops_new_assignments(db):
    run(route.set_availability(AvailabilityUpdate(is_available=False), user=tg(1)))
    with pytest.raises(BadRequestError):
        assign(db, 1)
    run(route.set_availability(AvailabilityUpdate(is_available=True), user=tg(1)))
    assert assign(db, 1)["success"]


# ── managing drivers ───────────────────────────────────────────────

def create(db, user, **kw):
    body = {"telegram_id": 1015, "full_name": " New Rider ", "phone": "012 999 888", **kw}
    return run(route.create_driver(DriverCreate(**body), user=user))


def test_a_shop_creates_its_own_rider_only(db):
    row = create(db, BLOOM, merchant_id=4)["data"]          # trying to create for another shop is ignored
    assert (row["merchant_id"], row["full_name"], row["user_id"]) == (3, "New Rider", 15)


def test_super_admin_can_create_platform_and_shop_drivers(db):
    assert create(db, SUPER)["data"]["merchant_id"] is None
    db.tables["drivers"].clear()
    assert create(db, SUPER, merchant_id=4)["data"]["merchant_id"] == 4


def test_cannot_make_an_unknown_person_a_driver(db):
    with pytest.raises(BadRequestError):
        create(db, BLOOM, telegram_id=999999)


def test_a_person_is_only_one_driver(db):
    create(db, BLOOM)
    with pytest.raises(ConflictError):
        create(db, SUPER)


def test_driver_list_is_scoped(db):
    assert {d["full_name"] for d in run(route.list_drivers(user=BLOOM))["data"]} == {"Bloom Rider"}
    assert len(run(route.list_drivers(user=SUPER))["data"]) == 5
    assign(db, 3)
    rider = next(d for d in run(route.list_drivers(user=BLOOM))["data"])
    assert rider["active_jobs"] == 1 and rider["shop_name"] == "Bloom"


def test_a_shop_manages_only_its_own_riders(db):
    run(route.update_driver(3, DriverUpdate(is_active=False, vehicle="Tuk tuk"), user=BLOOM))
    assert (db.row("drivers", 3)["is_active"], db.row("drivers", 3)["vehicle"]) == (False, "Tuk tuk")
    for other in (1, 4):                                     # a platform driver and another shop's rider
        with pytest.raises(NotFoundError):
            run(route.update_driver(other, DriverUpdate(is_active=False), user=BLOOM))
    assert db.row("drivers", 1)["is_active"] is True
    run(route.update_driver(1, DriverUpdate(is_active=False), user=SUPER))
    assert db.row("drivers", 1)["is_active"] is False


def test_a_switched_off_driver_cannot_be_given_deliveries(db):
    run(route.update_driver(3, DriverUpdate(is_active=False), user=BLOOM))
    with pytest.raises(BadRequestError):
        assign(db, 3)


# ── before migration 028 ───────────────────────────────────────────

def test_everything_degrades_quietly_before_migration_028(db):
    db.migrated = False
    assert run(route.my_driver_profile(user=tg(1))) == {"driver": None}
    assert run(route.list_drivers(user=SUPER)) == {"data": []}
    assert run(deliveries.customer_view(db, 50)) is None
    # an order can still be cancelled or delivered by the shop: the delivery hooks must not break it
    run(order_status.change_status(db, db.row("orders", 50), "cancelled", actor_type="super_admin", actor_id="1"))
    assert db.order_status(50) == "cancelled"
    db.add_order(52)
    run(order_status.change_status(db, db.row("orders", 52), "processing", actor_type="super_admin", actor_id="1"))
    run(order_status.change_status(db, db.row("orders", 52), "shipped", actor_type="super_admin", actor_id="1"))
    run(order_status.change_status(db, db.row("orders", 52), "delivered", actor_type="super_admin", actor_id="1"))
    assert db.order_status(52) == "delivered"


# ── the HTTP layer: who may call what ──────────────────────────────

def bearer(role, **kw): return {"Authorization": "Bearer " + mint_jwt(sub="1", role=role, **kw)}


def test_roles_are_enforced_on_the_wire(db):
    c = TestClient(app)
    cust, shop, boss = bearer(Role.USER, telegram_id=111), bearer(Role.MERCHANT_ADMIN, merchant_id=3), bearer(Role.SUPER_ADMIN)
    assert c.get("/api/deliveries/me").status_code == 401
    assert c.get("/api/deliveries/me", headers=cust).json() == {"driver": None}
    assert c.get("/api/deliveries/me/jobs", headers=cust).status_code == 403          # a customer is not a driver
    assert c.get("/api/deliveries/me", headers=shop).status_code == 403               # the driver app is for people, not shop logins
    assert c.post("/api/deliveries/orders/50/assign", headers=cust, json={"driver_id": 1}).status_code == 403
    assert c.get("/api/deliveries/admin/drivers", headers=cust).status_code == 403
    assert c.post("/api/deliveries/orders/50/assign", headers=shop, json={"driver_id": 1}).status_code == 200
    assert c.get("/api/deliveries/admin/drivers", headers=boss).status_code == 200
    assert c.get("/api/deliveries/me/jobs", headers=bearer(Role.USER, telegram_id=1010)).status_code == 200  # driver Pat
    assert c.post("/api/deliveries/jobs/50/dance", headers=bearer(Role.USER, telegram_id=1010)).status_code == 400


def test_order_details_show_the_delivery_to_the_customer(db, monkeypatch):
    assign(db, 1)
    c = TestClient(app)
    monkeypatch.setattr(orders_route, "_get_db_user", lambda db_, user: _coro({"id": 1, "telegram_id": 111}))
    body = c.get("/api/orders/50", headers=bearer(Role.USER, telegram_id=111)).json()
    assert body["delivery"]["driver"]["name"] == "Platform Pat" and body["delivery"]["status"] == "assigned"


async def _coro(value): return value


def test_the_shop_sees_why_a_delivery_failed_but_the_customer_does_not(db):
    assign(db, 1); act(db, 1, "accept"); act(db, 1, "pickup"); act(db, 1, "fail", reason="Nobody home")
    assert run(route.order_delivery(50, user=BLOOM))["data"]["failure_reason"] == "Nobody home"
    assert "failure_reason" not in run(deliveries.customer_view(db, 50))
    with pytest.raises(ForbiddenError):
        run(route.order_delivery(50, user=CAKES))   # another shop sees nothing of this order


def test_shop_tools_explain_missing_setup_before_migration_028(db):
    db.migrated = False
    for call in (
        lambda: run(route.drivers_for_order(50, user=BLOOM)),
        lambda: assign(db, 1),
        lambda: run(route.unassign_driver(50, user=BLOOM)),
        lambda: create(db, BLOOM),
        lambda: run(route.update_driver(1, DriverUpdate(is_active=False), user=SUPER)),
    ):
        with pytest.raises(BadRequestError) as err:
            call()
        assert "not set up" in str(getattr(err.value, "detail", err.value))


# ── the delivery confirmation code ─────────────────────────────────

def _out_for_delivery(db):
    assign(db, 1); act(db, 1, "accept"); act(db, 1, "pickup")
    db.delivery(50)["code_attempts"] = 0  # migration 040 is in place


def test_code_is_four_digits_and_stable_per_order():
    a, b = delivery_code.code_for(50), delivery_code.code_for(51)
    assert len(a) == 4 and a.isdigit() and a == delivery_code.code_for(50)
    assert delivery_code.matches(50, a) and delivery_code.matches(50, f" {a[:2]} {a[2:]} ")  # spaces are fine
    assert not delivery_code.matches(50, a[:3]) and not delivery_code.matches(50, None)
    assert a != b or delivery_code.code_for(52) != a  # not the same code for every order


def test_delivering_needs_the_customers_code(db):
    _out_for_delivery(db)
    with pytest.raises(BadRequestError, match="4-digit"):
        act(db, 1, "deliver", code=" ")
    assert db.delivery(50)["status"] == "picked_up" and db.order_status(50) == "shipped"
    act(db, 1, "deliver")  # the right code
    assert db.delivery(50)["status"] == "delivered"


def test_wrong_codes_are_counted_and_lock_the_driver_out(db):
    _out_for_delivery(db)
    wrong = "0000" if delivery_code.code_for(50) != "0000" else "1111"
    for left in (4, 3, 2, 1):
        with pytest.raises(BadRequestError, match=f"{left} tr"):
            act(db, 1, "deliver", code=wrong)
    with pytest.raises(BadRequestError, match="Call the shop"):
        act(db, 1, "deliver", code=wrong)
    assert db.delivery(50)["code_attempts"] == 5
    with pytest.raises(ForbiddenError, match="Call the shop"):
        act(db, 1, "deliver")  # even the right code is refused now
    assert db.order_status(50) == "shipped"


def test_only_the_customer_sees_the_code(db):
    _out_for_delivery(db)
    code = delivery_code.code_for(50)
    assert run(deliveries.customer_view(db, 50))["confirmation_code"] == code
    assert "confirmation_code" not in run(route.order_delivery(50, user=BLOOM))["data"]
    assert code not in str(run(route.my_jobs(scope="active", user=tg(1))))


def test_the_code_disappears_once_delivered(db):
    _out_for_delivery(db)
    act(db, 1, "deliver")
    assert "confirmation_code" not in run(deliveries.customer_view(db, 50))


def test_out_for_delivery_message_carries_the_code(db):
    _out_for_delivery(db)
    out = next(n for n in db.notes(user_id=1) if n["title"] == "Out for delivery")
    assert delivery_code.code_for(50) in out["body"]
