"""Checkout picks the best live auto-apply promotion when no code is typed (database faked)."""

import asyncio
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import patch

from app.routes import orders

CART = [{"product_id": 1, "unit_price": "10.00", "quantity": 3}]  # subtotal 30.00
SAT = datetime(2026, 10, 31, 5, tzinfo=timezone.utc)   # Saturday noon in Phnom Penh
FRI = datetime(2026, 10, 30, 5, tzinfo=timezone.utc)


class Q:
    def __init__(self, rows):
        self.rows = rows

    def eq(self, *_):
        return self

    def or_(self, *_):
        return self

    def in_(self, col, values):
        return Q([r for r in self.rows if r.get(col) in values])

    async def select(self, *_):
        return self.rows


class DB:
    def __init__(self, promotions, codes):
        self.t = {"promotions": promotions, "promo_codes": codes}

    def from_(self, table):
        if self.t.get(table) is None:
            raise RuntimeError("PGRST205 promotions")
        return Q(self.t[table])


WEEKEND = {"id": 1, "title": "Weekend Sale", "scope": "shop", "merchant_id": 3, "promo_code_id": 10, "is_active": True,
           "auto_apply": True, "schedule_type": "weekly", "weekdays": [6, 0]}
PLATFORM = {"id": 2, "title": "Byme24 Day", "scope": "platform", "merchant_id": None, "promo_code_id": 11, "is_active": True,
            "auto_apply": True, "schedule_type": "once"}
CODES = [
    {"id": 10, "code": "WEEKEND", "type": "percent", "value": 20, "min_order": 0, "is_active": True},
    {"id": 11, "code": "BYME24", "type": "fixed", "value": 2, "min_order": 0, "is_active": True},
]


def run(db, now):
    real = orders.promo_schedule.window
    with patch.object(orders.promo_schedule, "window", lambda p, n=None: real(p, now)):
        return asyncio.run(orders._best_auto_promotion(db, 3, CART, Decimal("30.00")))


def test_biggest_discount_wins():
    code, promotion, amount = run(DB([WEEKEND, PLATFORM], CODES), SAT)
    assert promotion["title"] == "Weekend Sale" and amount == Decimal("6.00")


def test_off_day_promotion_is_skipped():
    code, promotion, amount = run(DB([WEEKEND, PLATFORM], CODES), FRI)
    assert promotion["title"] == "Byme24 Day" and amount == Decimal("2.00")


def test_minimum_order_is_respected():
    codes = [CODES[0] | {"min_order": 50}, CODES[1]]
    _, promotion, _ = run(DB([WEEKEND, PLATFORM], codes), SAT)
    assert promotion["title"] == "Byme24 Day"


def test_not_auto_apply_means_code_only():
    _, promotion, amount = run(DB([WEEKEND | {"auto_apply": False}], CODES), SAT)
    assert promotion is None and amount == Decimal("0.00")


def test_no_promotions_table_yet():
    assert run(DB(None, CODES), SAT) == (None, None, Decimal("0.00"))


def test_platform_promotion_limited_to_a_category_only_counts_that_category():
    class Rows:
        def __init__(self, rows): self.rows = rows
        def eq(self, *_): return self
        def in_(self, col, values): return Rows([r for r in self.rows if r.get(col) in values])
        async def select(self, *_): return self.rows

    class CatDB:
        def from_(self, table):
            # product 1 is in category 7, product 2 isn't
            return Rows([{"id": 1, "category_id": 7}] if table == "products" else [])

    items = [{"product_id": 1, "unit_price": "10.00", "quantity": 1}, {"product_id": 2, "unit_price": "5.00", "quantity": 2}]
    promo = {"id": 9, "scope": "platform", "category_id": 7}
    base = asyncio.run(orders._eligible_base(CatDB(), promo, items, Decimal("20.00")))
    assert base == Decimal("10.00")  # only the category-7 line counts
