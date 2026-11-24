"""Strict monthly settlement cutoff.

The SQL side (create_merchant_payout's window) is verified by
supabase/tests/025_payout_period_cutoff_test.sql; these tests cover the month
boundaries and how the API drives the function.
"""

import asyncio
from datetime import datetime, timezone

import pytest

from app.core.exceptions import BadRequestError
from app.models.settlement import MonthlySettlement
from app.routes import settlements as route
from app.services import settlement

UTC = timezone.utc


# ── month boundaries ────────────────────────────────────────────


def test_november_window_is_phnom_penh_month_in_utc():
    start, end = settlement.month_bounds("2026-11")
    # Cambodia is UTC+7: Nov 1 00:00 local = Oct 31 17:00 UTC
    assert start == datetime(2026, 10, 31, 17, 0, tzinfo=UTC)
    assert end == datetime(2026, 11, 30, 17, 0, tzinfo=UTC)


def _in_window(ts: datetime, month: str) -> bool:
    start, end = settlement.month_bounds(month)
    return start <= ts < end  # same half-open rule the SQL uses


def test_last_second_of_november_is_in_and_first_second_of_december_is_out():
    # 2026-11-30 23:59:59 Phnom Penh = 16:59:59 UTC
    assert _in_window(datetime(2026, 11, 30, 16, 59, 59, tzinfo=UTC), "2026-11")
    # 2026-12-01 00:00:00 Phnom Penh = 17:00:00 UTC on Nov 30
    assert not _in_window(datetime(2026, 11, 30, 17, 0, 0, tzinfo=UTC), "2026-11")
    assert _in_window(datetime(2026, 11, 30, 17, 0, 0, tzinfo=UTC), "2026-12")
    # First moment of November local time
    assert _in_window(datetime(2026, 10, 31, 17, 0, 0, tzinfo=UTC), "2026-11")
    assert not _in_window(datetime(2026, 10, 31, 16, 59, 59, tzinfo=UTC), "2026-11")


def test_december_rolls_into_next_year():
    start, end = settlement.month_bounds("2026-12")
    assert start == datetime(2026, 11, 30, 17, 0, tzinfo=UTC)
    assert end == datetime(2026, 12, 31, 17, 0, tzinfo=UTC)


def test_leap_february():
    start, end = settlement.month_bounds("2028-02")
    assert (end - start).days == 29


def test_months_tile_without_gap_or_overlap():
    prev_end = None
    for m in range(1, 13):
        start, end = settlement.month_bounds(f"2026-{m:02d}")
        assert start < end
        if prev_end:
            assert start == prev_end
        prev_end = end


def test_month_format_is_validated():
    for bad in ("2026-13", "2026-00", "26-11", "2026-1", "november"):
        with pytest.raises(Exception):
            MonthlySettlement(month=bad)


# ── API behaviour with a fake ledger ────────────────────────────


class _Query:
    def __init__(self, rows):
        self.rows = rows

    def eq(self, *_):
        return self

    async def select(self, *_):
        return self.rows


class _Db:
    def __init__(self, balances, merchants):
        self.t = {"merchant_balances": balances, "merchants": merchants}

    def from_(self, name):
        return _Query(self.t[name])


class _Ctx:
    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        return self.db

    async def __aexit__(self, *_):
        return False


class _Admin:
    role = "super_admin"
    sub = "1"


def _run(monkeypatch, *, rpc, month="2026-11", balances=None, merchants=None):
    balances = balances if balances is not None else [
        {"merchant_id": 1, "merchant_name": "A", "available_amount": "10.00"},
        {"merchant_id": 2, "merchant_name": "B", "available_amount": "5.00"},
    ]
    merchants = merchants if merchants is not None else [
        {"id": 1, "payout_verification_status": "verified"},
        {"id": 2, "payout_verification_status": "unverified"},
    ]
    monkeypatch.setattr(route.SupabaseClient, "service_role", lambda: _Ctx(_Db(balances, merchants)))
    monkeypatch.setattr(route.settlement, "rpc", rpc)
    return asyncio.run(route.admin_monthly_settlement(MonthlySettlement(month=month), user=_Admin()))["data"]


def test_payout_gets_month_window_and_note(monkeypatch):
    calls = []

    async def rpc(db, fn, params):
        calls.append((fn, params))
        return {"id": 99, "amount": "10.00"}

    data = _run(monkeypatch, rpc=rpc)
    (fn, params), = calls
    assert fn == "create_merchant_payout" and params["p_merchant_id"] == 1
    assert params["p_note"] == "Monthly settlement 2026-11"
    start, end = settlement.month_bounds("2026-11")
    assert params["p_period_start"] == start.isoformat()
    assert params["p_period_end"] == end.isoformat()
    # unverified merchant is skipped, not paid
    assert [s["merchant_id"] for s in data["skipped"]] == [2]
    assert [c["merchant_id"] for c in data["created"]] == [1]


def test_rerunning_a_settled_month_creates_nothing(monkeypatch):
    async def rpc(db, fn, params):
        raise BadRequestError("Nothing to pay out for merchant 1 (available 0)")

    data = _run(monkeypatch, rpc=rpc)
    assert data["created"] == []
    assert [s["merchant_id"] for s in data["skipped"]] == [2]  # only the unverified one


def test_future_month_is_refused(monkeypatch):
    async def rpc(db, fn, params):
        raise AssertionError("must not be called")

    with pytest.raises(BadRequestError):
        _run(monkeypatch, rpc=rpc, month="2999-01")
