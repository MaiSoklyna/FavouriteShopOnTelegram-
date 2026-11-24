"""Setting a shop's category and subcategory (admin merchant editor): who may, and what is checked."""

import asyncio

import pytest

from app.core.constants import Role
from app.core.exceptions import BadRequestError
from app.core.security import TokenClaims
from app.models.merchant import MerchantCreate, MerchantUpdate
from app.routes import merchants as route
from tests.shop_fakes import FakeDb, install

SUPER = TokenClaims(sub="1", role=Role.SUPER_ADMIN)
OWN_SHOP_ADMIN = TokenClaims(sub="9", role=Role.MERCHANT_ADMIN, merchant_id=4)


@pytest.fixture
def db(monkeypatch):
    return install(monkeypatch, FakeDb())


def update(merchant_id, user=SUPER, **fields):
    return asyncio.run(route.update_merchant(merchant_id, MerchantUpdate(**fields), user=user))


def cat_of(db, merchant_id):
    m = db.merchant(merchant_id)
    return m["shop_category_id"], m["shop_subcategory_id"]


def test_super_admin_sets_category_and_subcategory(db):
    update(4, shop_category_id=2, shop_subcategory_id=3)
    assert cat_of(db, 4) == (2, 3)


def test_subcategory_must_belong_to_the_category(db):
    with pytest.raises(BadRequestError):
        update(4, shop_category_id=2, shop_subcategory_id=1)  # Cake Shop is under Food, not Fashion
    assert cat_of(db, 4) == (None, None)


def test_unknown_category_is_refused(db):
    with pytest.raises(BadRequestError):
        update(4, shop_category_id=99)
    assert cat_of(db, 4) == (None, None)


def test_subcategory_needs_a_category(db):
    with pytest.raises(BadRequestError):
        update(4, shop_subcategory_id=3)


def test_changing_category_resets_the_old_subcategory(db):
    update(1, shop_category_id=2)  # Cake Corner moves Food -> Fashion; its Cake Shop subcategory no longer fits
    assert cat_of(db, 1) == (2, None)


def test_changing_only_the_subcategory_keeps_the_category(db):
    update(1, shop_subcategory_id=2)  # Cake Shop -> Coffee Shop, still Food
    assert cat_of(db, 1) == (1, 2)


def test_other_edits_leave_the_category_alone(db):
    update(1, tagline="Fresh daily")
    assert db.merchant(1)["tagline"] == "Fresh daily"
    assert cat_of(db, 1) == (1, 1)


def test_null_clears_the_category_and_its_subcategory(db):
    update(1, shop_category_id=None)
    assert cat_of(db, 1) == (None, None)


def test_merchant_admin_cannot_change_their_own_shops_category(db):
    update(4, user=OWN_SHOP_ADMIN, shop_category_id=2, shop_subcategory_id=3, tagline="Hello")
    assert db.merchant(4)["tagline"] == "Hello"  # the rest of the edit still goes through
    assert cat_of(db, 4) == (None, None)          # discovery placement is a super-admin decision


def test_create_with_a_valid_category(db):
    body = MerchantCreate(name="New Cafe", slug="new-cafe", owner_name="O", email="o@x.com",
                          shop_category_id=1, shop_subcategory_id=2)
    asyncio.run(route.create_merchant(body, user=SUPER))
    created = db.merchant(6)
    assert (created["shop_category_id"], created["shop_subcategory_id"]) == (1, 2)


def test_create_with_a_mismatched_subcategory_is_refused(db):
    body = MerchantCreate(name="Bad Cafe", slug="bad-cafe", owner_name="O", email="o@x.com",
                          shop_category_id=2, shop_subcategory_id=1)
    with pytest.raises(BadRequestError):
        asyncio.run(route.create_merchant(body, user=SUPER))
    assert len(db.tables["merchants"]) == 5


def test_create_without_a_category_still_works(db):
    body = MerchantCreate(name="No Cat", slug="no-cat", owner_name="O", email="o@x.com")
    asyncio.run(route.create_merchant(body, user=SUPER))
    assert "shop_category_id" not in db.merchant(6)  # column is not sent unless set
