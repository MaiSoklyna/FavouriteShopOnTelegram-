"""A merchant admin's promotions and promo codes stay in their own shop (database faked)."""

import asyncio

import pytest

from app.core.constants import Role
from app.core.exceptions import ForbiddenError, NotFoundError
from app.core.security import TokenClaims
from app.routes.promos import _load_own_promo
from app.routes.promotions import _own_shop

MERCHANT = TokenClaims(sub="7", role=Role.MERCHANT_ADMIN, merchant_id=1)
SUPER = TokenClaims(sub="1", role=Role.SUPER_ADMIN)


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def eq(self, col, v):
        return FakeQuery([r for r in self.rows if r.get(col) == v])

    async def select_one(self, *_):
        return dict(self.rows[0]) if self.rows else None


class FakeDb:
    def __init__(self, rows):
        self.rows = rows

    def from_(self, _table):
        return FakeQuery(self.rows)


CODES = [{"id": 10, "merchant_id": 1}, {"id": 20, "merchant_id": 2}, {"id": 30, "merchant_id": None}]


def test_merchant_promotion_is_forced_to_own_shop():
    # Whatever shop the request names, a merchant admin's promotion lands in their own shop
    assert _own_shop(MERCHANT, 2) == 1
    assert _own_shop(MERCHANT, None, "product") == 1


def test_merchant_cannot_make_platform_wide():
    with pytest.raises(ForbiddenError):
        _own_shop(MERCHANT, None, "platform")


def test_merchant_without_shop_is_refused():
    with pytest.raises(ForbiddenError):
        _own_shop(TokenClaims(sub="8", role=Role.MERCHANT_ADMIN), 1)


def test_super_admin_picks_any_shop_or_platform():
    assert _own_shop(SUPER, 2) == 2
    assert _own_shop(SUPER, None, "platform") is None


def test_merchant_can_edit_own_code():
    assert asyncio.run(_load_own_promo(FakeDb(CODES), 10, MERCHANT))["id"] == 10


@pytest.mark.parametrize("promo_id", [20, 30])
def test_merchant_cannot_edit_another_shops_or_platform_code(promo_id):
    with pytest.raises(ForbiddenError):
        asyncio.run(_load_own_promo(FakeDb(CODES), promo_id, MERCHANT))


def test_super_admin_can_edit_any_code():
    assert asyncio.run(_load_own_promo(FakeDb(CODES), 20, SUPER))["id"] == 20


def test_missing_code_is_not_found():
    with pytest.raises(NotFoundError):
        asyncio.run(_load_own_promo(FakeDb(CODES), 99, MERCHANT))
