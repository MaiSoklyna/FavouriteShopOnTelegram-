"""Merchant setup wizard: the checklist, going live once, the visibility rule, and Telegram group linking.

Decisions (2026-11-25): required = name, shop type, logo, address + pin, opening hours (weekly or
24/7), Telegram order group, a category, a product, delivery settings. Existing shops stay visible.
A live shop that loses an item stays visible. The owner may choose the shop type before going live.
"""

import asyncio
import time
from contextlib import asynccontextmanager

import pytest

from app.core.constants import Role
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims
from app.routes import merchant_setup as setup_route
from app.routes import merchants as merchants_route
from app.routes import orders as orders_route
from app.services import audit, notify, shop_setup

OWNER = TokenClaims(sub="1", role=Role.MERCHANT_ADMIN, merchant_id=7, merchant_role="owner")
STAFF = TokenClaims(sub="2", role=Role.MERCHANT_ADMIN, merchant_id=7, merchant_role="staff")
ADMIN = TokenClaims(sub="1", role=Role.SUPER_ADMIN, name="Nadra")
WEEKLY = {"mon": [["08:00", "20:00"]], "sat": [["09:00", "17:00"]]}


class Q:
    def __init__(self, db, table):
        self.db, self.table, self.tests = db, table, []

    def eq(self, c, v): self.tests.append(lambda r: r.get(c) == v); return self
    def neq(self, c, v): self.tests.append(lambda r: r.get(c) != v); return self
    def in_(self, c, vs): self.tests.append(lambda r: r.get(c) in vs); return self
    def ilike(self, c, v): return self
    def order(self, *a, **k): return self
    def limit(self, n): return self
    def offset(self, n): return self

    def is_(self, c, v):
        self.tests.append(lambda r: r.get(c) is None); return self

    def not_(self, c, op, v):
        self.tests.append(lambda r: r.get(c) is not None); return self

    def _rows(self):
        return [r for r in self.db.t.setdefault(self.table, []) if all(t(r) for t in self.tests)]

    async def select(self, *_):
        await asyncio.sleep(0)
        return [dict(r) for r in self._rows()]

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
        rows = self.db.t.setdefault(self.table, [])
        row = {"id": len(rows) + 100, **data}
        rows.append(row)
        return [dict(row)]


def new_shop(**kw):
    """A shop just approved: active, nothing set up yet."""
    return {"id": 7, "name": "Moon Bakery", "status": "active", "shop_category_id": None, "shop_subcategory_id": None,
            "logo_url": None, "address": None, "latitude": None, "longitude": None, "opening_hours": None,
            "telegram_group_id": None, "delivery_radius_km": 5, "delivery_base_fee": None, "delivery_fee_mode": None,
            "tagline": None, "description": None, "aba_account": None, "fb_page": None, "instagram": None,
            "setup_completed_at": None, "created_at": "2026-11-25T00:00:00Z", **kw}


def complete(**kw):
    base = dict(shop_category_id=1, logo_url="https://x/logo.png", address="St 51", latitude=11.5, longitude=104.9,
                opening_hours=WEEKLY, telegram_group_id=-100123, delivery_fee_mode="platform")
    return new_shop(**{**base, **kw})


class DB:
    def __init__(self, shop, categories=1, products=1):
        self.t = {
            "merchants": [shop, {**complete(), "id": 1, "name": "Live Shop", "setup_completed_at": "2026-01-01T00:00:00Z"}],
            "categories": [{"id": i, "merchant_id": 7, "name": f"Cat {i}", "is_active": True, "sort_order": i} for i in range(1, categories + 1)],
            "products": [{"id": 50 + i, "merchant_id": 7, "is_active": True, "name": f"P{i}"} for i in range(products)]
                        + [{"id": 90, "merchant_id": 1, "is_active": True, "name": "Live product"}],
            "merchant_hero_images": [], "merchant_admins": [],
            "category_templates": [
                {"id": 1, "shop_category_id": 1, "shop_subcategory_id": 1, "name": "Cakes", "icon_emoji": "🎂", "is_active": True},
                {"id": 2, "shop_category_id": 1, "shop_subcategory_id": 1, "name": "Cookies", "icon_emoji": "🍪", "is_active": True},
                {"id": 3, "shop_category_id": 1, "shop_subcategory_id": None, "name": "Food", "icon_emoji": "🍽️", "is_active": True},
            ],
        }

    def from_(self, table):
        return Q(self, table)

    def shop(self, mid=7):
        return next(m for m in self.t["merchants"] if m["id"] == mid)


@pytest.fixture
def spy(monkeypatch):
    calls = {"audit": [], "notify": []}

    async def record(db, user, **kw):
        calls["audit"].append({"user": user, **kw})

    async def notify_merchant(db, mid, kind, title, body, **kw):
        calls["notify"].append((mid, title))
        return True

    monkeypatch.setattr(audit, "record", record)
    monkeypatch.setattr(notify, "notify_merchant", notify_merchant)
    return calls


def run(c):
    return asyncio.run(c)


def use(monkeypatch, db, *modules):
    @asynccontextmanager
    async def service_role():
        yield db
    for m in modules:
        monkeypatch.setattr(m.SupabaseClient, "service_role", service_role)


# ── The checklist ───────────────────────────────────────────────

def test_a_new_shop_has_everything_left_to_do(spy):
    state = run(shop_setup.checklist(DB(new_shop(), categories=0, products=0), 7))
    assert state["done"] == 1 and state["total"] == 9 and not state["complete"]  # only the name
    assert state["missing"][:3] == ["Shop type", "Logo", "Address and map location"]


def test_a_complete_shop(spy):
    state = run(shop_setup.checklist(DB(complete()), 7))
    assert state["complete"] and state["missing"] == []


@pytest.mark.parametrize("change, missing", [
    ({"address": "  "}, "Address and map location"),
    ({"latitude": None}, "Address and map location"),
    ({"opening_hours": {}}, "Opening hours"),
    ({"opening_hours": {"mon": []}}, "Opening hours"),
    ({"telegram_group_id": 5847427348}, "Telegram order group"),   # a person, not a group
    ({"delivery_fee_mode": None}, "Delivery settings"),
    ({"delivery_fee_mode": "custom", "delivery_base_fee": None}, "Delivery settings"),
    ({"delivery_radius_km": 0}, "Delivery settings"),
])
def test_each_required_item(spy, change, missing):
    assert run(shop_setup.checklist(DB(complete(**change)), 7))["missing"] == [missing]


def test_categories_and_products_are_required(spy):
    assert run(shop_setup.checklist(DB(complete(), categories=0), 7))["missing"] == ["At least one category"]
    assert run(shop_setup.checklist(DB(complete(), products=0), 7))["missing"] == ["At least one product"]


def test_24_7_counts_as_opening_hours(spy):
    state = run(shop_setup.checklist(DB(complete(opening_hours=shop_setup.ALWAYS_OPEN)), 7))
    assert state["complete"] and state["always_open"]
    from app.services.delivery import is_open
    assert is_open(shop_setup.ALWAYS_OPEN)


def test_custom_delivery_fees(spy):
    assert run(shop_setup.checklist(DB(complete(delivery_fee_mode="custom", delivery_base_fee=1)), 7))["complete"]


# ── Going live ──────────────────────────────────────────────────

def test_shop_goes_live_once_when_complete(spy):
    db = DB(complete())
    state = run(shop_setup.refresh(db, 7))
    assert state["live"] and db.shop()["setup_completed_at"]
    assert run(shop_setup.refresh(db, 7)) is None   # already live: nothing more
    assert [a["action"] for a in spy["audit"]] == ["shop.went_live"]
    assert spy["notify"] == [(7, "Your shop is live 🎉")]


def test_incomplete_shop_stays_hidden(spy):
    db = DB(complete(logo_url=None))
    state = run(shop_setup.refresh(db, 7))
    assert not state["live"] and db.shop()["setup_completed_at"] is None


def test_suspended_shop_does_not_go_live(spy):
    db = DB(complete(status="suspended"))
    run(shop_setup.refresh(db, 7))
    assert db.shop()["setup_completed_at"] is None


def test_a_live_shop_missing_an_item_stays_live(spy):
    db = DB(complete(setup_completed_at="2026-11-01T00:00:00Z"), products=0)
    assert run(shop_setup.refresh(db, 7)) is None
    state = run(shop_setup.checklist(db, 7))
    assert state["live"] and state["missing"] == ["At least one product"]   # shown as a warning


def test_platform_publishes_by_hand(spy):
    db = DB(new_shop())
    assert run(shop_setup.publish(db, 7, ADMIN)) is True
    assert db.shop()["setup_completed_at"] and spy["audit"][0]["action"] == "shop.published_by_platform"
    assert run(shop_setup.publish(db, 7, ADMIN)) is False


# ── Who customers see ───────────────────────────────────────────

def test_visibility_rule(spy):
    db = DB(new_shop())
    assert run(shop_setup.visible_shop_ids(db)) == {1}
    assert not shop_setup.is_visible(new_shop())
    assert shop_setup.is_visible(complete(setup_completed_at="x"))
    assert not shop_setup.is_visible(complete(setup_completed_at="x", status="suspended"))
    assert not shop_setup.is_visible({"status": "active"})   # setup_completed_at not read: hidden, never leaked


def test_customers_do_not_see_a_shop_that_is_not_live(spy, monkeypatch):
    db = DB(new_shop())
    use(monkeypatch, db, merchants_route)
    listed = run(merchants_route.list_merchants(status=None, search=None, shop_category_id=None, shop_subcategory_id=None, user=None))
    assert [m["id"] for m in listed] == [1]
    with pytest.raises(NotFoundError):
        run(merchants_route.get_merchant(7, user=None))
    assert run(merchants_route.get_merchant(7, user=OWNER))["id"] == 7   # its own people can preview it


def test_checkout_refuses_a_shop_that_is_not_live(spy):
    db = DB(new_shop())
    db.t["cart"] = [{"id": 1, "user_id": 3, "merchant_id": 7}]
    db.t["cart_items"] = [{"id": 1, "cart_id": 1, "product_id": 50, "quantity": 1, "unit_price": 2, "selected_variants": None}]
    db.t["products"][0].update({"base_price": 2, "stock": 9})
    with pytest.raises(BadRequestError, match="isn't taking orders"):
        run(orders_route._price_cart(db, 3, 7, None, "pickup", None))


# ── Telegram group link ─────────────────────────────────────────

def test_link_code_links_the_group(spy):
    db = DB(complete(telegram_group_id=None))
    code = shop_setup.link_code(7)
    out = run(shop_setup.link_group(db, code.lower(), -100555, "Moon orders"))
    assert out["ok"] and out["merchant_id"] == 7 and db.shop()["telegram_group_id"] == -100555
    assert db.shop()["setup_completed_at"]   # that was the last missing item


def test_link_code_from_the_previous_window_still_works():
    window = int(time.time() // shop_setup.LINK_WINDOW_SECONDS)
    assert shop_setup.match_link_code(shop_setup.link_code(7, window - 1), [1, 7]) == 7
    assert shop_setup.match_link_code(shop_setup.link_code(7, window - 2), [1, 7]) is None   # expired


def test_link_refuses_private_chats_and_bad_codes(spy):
    db = DB(new_shop())
    assert not run(shop_setup.link_group(db, shop_setup.link_code(7), 5847427348, None))["ok"]
    assert not run(shop_setup.link_group(db, "ZZZZZZ", -100555, None))["ok"]
    assert db.shop()["telegram_group_id"] is None


def test_codes_differ_per_shop():
    assert shop_setup.link_code(7) != shop_setup.link_code(1)


# ── API ─────────────────────────────────────────────────────────

def test_setup_endpoint_and_starter_suggestions(spy, monkeypatch):
    db = DB(new_shop(shop_category_id=1, shop_subcategory_id=1), categories=0)
    db.t["categories"] = [{"id": 1, "merchant_id": 7, "name": "cakes", "is_active": True, "sort_order": 1}]
    use(monkeypatch, db, setup_route)
    out = run(setup_route.get_setup(merchant_id=None, user=OWNER))
    assert [s["name"] for s in out["suggestions"]] == ["Cookies"]   # subtype-specific, minus what it has
    assert out["can_edit_settings"] and out["can_change_type"]
    assert not run(setup_route.get_setup(merchant_id=None, user=STAFF))["can_edit_settings"]


def test_create_starter_categories(spy, monkeypatch):
    db = DB(new_shop(), categories=0)
    use(monkeypatch, db, setup_route)
    out = run(setup_route.create_starter_categories(setup_route.StarterCategories(names=["Cakes", " cakes ", "My Specials"]),
                                                    merchant_id=None, user=OWNER))
    assert [c["name"] for c in out["created"]] == ["Cakes", "My Specials"]
    assert db.t["categories"][0]["icon_emoji"] == "🎂" and db.t["categories"][0]["merchant_id"] == 7


def test_only_the_owner_gets_a_link_code():
    with pytest.raises(ForbiddenError):
        run(setup_route.telegram_code(merchant_id=None, user=STAFF))
    out = run(setup_route.telegram_code(merchant_id=None, user=OWNER))
    assert out["code"] == shop_setup.link_code(7) and out["command"].startswith("/link@")


def test_opening_hours_are_checked():
    merchants_route._check_hours(WEEKLY)
    merchants_route._check_hours(shop_setup.ALWAYS_OPEN)
    with pytest.raises(BadRequestError):
        merchants_route._check_hours({"monday": [["08:00", "20:00"]]})
    with pytest.raises(BadRequestError):
        merchants_route._check_hours({"mon": [["8am", "20:00"]]})
