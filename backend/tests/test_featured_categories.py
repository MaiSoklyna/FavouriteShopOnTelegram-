"""Home categories: featured ones by priority, scheduled ones only when on, 4–8 shown."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from app.core.exceptions import BadRequestError
from app.routes.featured_categories import FeaturedIn, pick_home

PP = ZoneInfo("Asia/Phnom_Penh")
NOW = datetime(2026, 12, 20, 12, tzinfo=PP).astimezone(timezone.utc)
CATS = [{"id": i, "name": f"Cat {i}", "product_count": 20 - i, "sort_order": i} for i in range(1, 13)]


def feat(id, category_id, priority=100, kind="permanent", **sched):
    return {"id": id, "category_id": category_id, "priority": priority, "kind": kind, "is_active": True, "schedule_type": "once"} | sched


def ids(rows):
    return [r["id"] for r in rows]


def test_featured_show_in_priority_order_then_top_up_to_four():
    home = pick_home([feat(1, 9, priority=20), feat(2, 7, priority=10)], CATS, NOW)
    assert ids(home)[:2] == [7, 9]
    assert len(home) == 4 and [r["source"] for r in home[2:]] == ["most_products", "most_products"]
    assert ids(home)[2:] == [1, 2]  # most products, skipping the ones already shown


def test_never_more_than_eight():
    home = pick_home([feat(i, i) for i in range(1, 11)], CATS, NOW)
    assert len(home) == 8 and all(r["featured_id"] for r in home)


def test_seasonal_only_in_season():
    xmas = feat(1, 11, kind="seasonal", schedule_type="yearly", yearly_ranges=[{"start": "12-01", "end": "12-26"}])
    assert 11 in ids(pick_home([xmas], CATS, NOW))
    assert 11 not in ids(pick_home([xmas], CATS, datetime(2027, 1, 5, tzinfo=timezone.utc))[:1])


def test_scheduled_window_ends():
    sale = feat(1, 12, kind="scheduled", starts_at="2026-12-01T00:00:00Z", ends_at="2026-12-15T00:00:00Z")
    assert 12 not in ids(pick_home([sale], CATS, NOW))


def test_switched_off_rows_are_ignored_and_duplicates_shown_once():
    rows = [feat(1, 5) | {"is_active": False}, feat(2, 6, priority=1), feat(3, 6, priority=2)]
    home = pick_home(rows, CATS, NOW)
    assert ids(home).count(6) == 1 and home[0]["id"] == 6 and 5 not in ids(home)[:1]


def test_nothing_featured_is_todays_home():
    # Before anything is chosen Home keeps its 8 most-stocked categories
    assert ids(pick_home([], CATS, NOW)) == [1, 2, 3, 4, 5, 6, 7, 8]


def test_form_rules_by_kind():
    assert FeaturedIn(category_id=1, kind="permanent", starts_at="2026-01-01T00:00:00Z").row()["starts_at"] is None
    with pytest.raises(BadRequestError):
        FeaturedIn(category_id=1, kind="seasonal").row()
    with pytest.raises(BadRequestError):
        FeaturedIn(category_id=1, kind="scheduled").row()
    row = FeaturedIn(category_id=1, kind="seasonal", schedule_type="once", yearly_ranges=[{"start": "12-01", "end": "12-26"}]).row()
    assert row["schedule_type"] == "yearly"
