"""The coupon sheet's loyalty row: how many points the customer can use right here, or why not."""

import asyncio
from decimal import Decimal

import pytest

from app.routes import coupons as route
from app.services import loyalty

SETTINGS = {"is_enabled": True, "min_redeem_points": 100, "points_value_cents": 1}


class DB:
    def __init__(self, balance):
        self.balance = balance

    def from_(self, table):
        db = self

        class Q:
            def eq(self, *a): return self
            async def select_one(self, *a):
                return {"balance": db.balance} if db.balance is not None else None
        return Q()


def offer(monkeypatch, balance, subtotal, settings=SETTINGS):
    async def get_settings(db):
        return settings
    monkeypatch.setattr(loyalty, "get_settings", get_settings)
    return asyncio.run(route._points_offer(DB(balance), 5, Decimal(str(subtotal))))


def test_uses_whole_blocks_of_the_minimum(monkeypatch):
    o = offer(monkeypatch, 583, "26.98")
    assert o == {"eligible": True, "balance": 583, "min_points": 100, "use_points": 500, "value": 5.0, "reason": None}


def test_never_more_than_the_cart(monkeypatch):
    o = offer(monkeypatch, 583, "2.40")
    assert o["use_points"] == 200 and o["value"] == 2.0


def test_not_enough_points_says_how_many_are_needed(monkeypatch):
    o = offer(monkeypatch, 40, "26.98")
    assert not o["eligible"] and o["reason"] == "Need 100 loyalty points (you have 40)"


def test_no_account_yet_counts_as_zero(monkeypatch):
    assert offer(monkeypatch, None, "26.98")["reason"] == "Need 100 loyalty points (you have 0)"


def test_cart_too_small(monkeypatch):
    o = offer(monkeypatch, 583, "0.50")
    assert not o["eligible"] and o["reason"] == "Your order is too small to use points"


@pytest.mark.parametrize("settings", [None, {**SETTINGS, "is_enabled": False}])
def test_program_off_means_no_row(monkeypatch, settings):
    assert offer(monkeypatch, 583, "26.98", settings) is None
