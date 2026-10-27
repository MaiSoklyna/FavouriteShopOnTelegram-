"""Promotion schedules: on the right days in Cambodia time, with the right end of the run."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.services.promo_schedule import describe, next_start, window

PP = ZoneInfo("Asia/Phnom_Penh")


def at(y, m, d, h=12):
    """A moment given in Cambodia time, as UTC."""
    return datetime(y, m, d, h, tzinfo=PP).astimezone(timezone.utc)


WEEKEND = {"is_active": True, "schedule_type": "weekly", "weekdays": [6, 0]}
PAYDAY = {"is_active": True, "schedule_type": "monthly", "month_days": [25]}
XMAS = {"is_active": True, "schedule_type": "yearly", "yearly_ranges": [{"start": "12-25", "end": "12-25"}]}
KNY = {"is_active": True, "schedule_type": "yearly", "yearly_ranges": [{"start": "04-14", "end": "04-16"}]}


def test_weekend_sale_on_saturday_runs_to_sunday_midnight():
    live, until = window(WEEKEND, at(2026, 10, 31))  # Saturday
    assert live and until == datetime(2026, 11, 2, tzinfo=PP).astimezone(timezone.utc)


def test_weekend_sale_off_on_friday():
    assert window(WEEKEND, at(2026, 10, 30))[0] is False


def test_days_are_counted_in_cambodia_time():
    # Friday 18:00 UTC is already Saturday 01:00 in Phnom Penh
    assert window(WEEKEND, datetime(2026, 10, 30, 18, tzinfo=timezone.utc))[0] is True


def test_monthly_25th():
    assert window(PAYDAY, at(2026, 11, 25))[0] is True
    assert window(PAYDAY, at(2026, 11, 24))[0] is False


def test_monthly_31st_also_covers_the_last_day_of_short_months():
    eom = {"is_active": True, "schedule_type": "monthly", "month_days": [31]}
    assert window(eom, at(2026, 11, 30))[0] is True   # November has 30 days
    assert window(eom, at(2026, 11, 29))[0] is False


def test_christmas_every_year():
    assert window(XMAS, at(2026, 12, 25))[0] is True
    assert window(XMAS, at(2027, 12, 25))[0] is True
    assert window(XMAS, at(2026, 12, 24))[0] is False


def test_khmer_new_year_range_ends_after_the_16th():
    live, until = window(KNY, at(2027, 4, 15))
    assert live and until == datetime(2027, 4, 17, tzinfo=PP).astimezone(timezone.utc)


def test_yearly_range_can_wrap_the_new_year():
    nye = {"is_active": True, "schedule_type": "yearly", "yearly_ranges": [{"start": "12-30", "end": "01-02"}]}
    assert window(nye, at(2026, 12, 31))[0] and window(nye, at(2027, 1, 2))[0]
    assert window(nye, at(2027, 1, 3))[0] is False


def test_outer_window_and_switch_still_apply():
    assert window(WEEKEND | {"ends_at": "2026-10-01T00:00:00Z"}, at(2026, 10, 31))[0] is False
    assert window(WEEKEND | {"is_active": False}, at(2026, 10, 31))[0] is False


def test_one_time_uses_its_dates():
    once = {"is_active": True, "schedule_type": "once", "starts_at": "2026-10-20T00:00:00Z", "ends_at": "2026-12-07T12:50:00Z"}
    live, until = window(once, at(2026, 11, 1))
    assert live and until == datetime(2026, 12, 7, 12, 50, tzinfo=timezone.utc)
    assert window(once, at(2026, 12, 8))[0] is False


def test_next_start_for_the_admin_list():
    assert next_start(WEEKEND, at(2026, 10, 29)) == datetime(2026, 10, 31, tzinfo=PP).astimezone(timezone.utc)
    assert next_start(XMAS, at(2026, 12, 26)) == datetime(2027, 12, 25, tzinfo=PP).astimezone(timezone.utc)


def test_plain_words():
    assert describe(WEEKEND) == "Every weekend (Saturday and Sunday)"
    assert describe(PAYDAY) == "Every 25th of the month"
    assert describe(XMAS) == "Every year: 25 December"
    assert describe(KNY) == "Every year: 14 April – 16 April"
