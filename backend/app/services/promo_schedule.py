"""When a promotion is on — schedules checked at read time, no switching jobs.

A promotion is live when it is enabled, `now` is inside its outer window
(starts_at … ends_at, either may be open) and, for recurring schedules, today
(in Cambodia time) is one of its days:

    once     the outer window alone
    weekly   weekdays: 0 = Sunday … 6 = Saturday
    monthly  month_days: 1 … 31 (31 also covers the last day of a shorter month)
    yearly   yearly_ranges: [{"start": "MM-DD", "end": "MM-DD"}], inclusive, may wrap the year

`window()` also says until when the current run lasts (end of today's run of
consecutive active days, capped by ends_at), so the app can say "Ends tonight".
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Phnom_Penh")
WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
MAX_RUN_DAYS = 400  # a schedule with every day on is open-ended; stop looking after this


def ts(v) -> datetime | None:
    if not v:
        return None
    if isinstance(v, datetime):
        d = v
    else:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _md(s: str) -> tuple[int, int]:
    m, d = s.split("-")
    return int(m), int(d)


def day_matches(p: dict, day: date) -> bool:
    """Is `day` (a Cambodia calendar date) one of this promotion's days?"""
    kind = p.get("schedule_type") or "once"
    if kind == "once":
        return True
    if kind == "weekly":
        # Python: Monday = 0; schedule: Sunday = 0
        return (day.weekday() + 1) % 7 in set(p.get("weekdays") or [])
    if kind == "monthly":
        wanted = set(p.get("month_days") or [])
        last = calendar.monthrange(day.year, day.month)[1]
        return day.day in wanted or (day.day == last and any(d > last for d in wanted))
    if kind == "yearly":
        md = (day.month, day.day)
        for r in p.get("yearly_ranges") or []:
            start, end = _md(r["start"]), _md(r["end"])
            if (start <= md <= end) if start <= end else (md >= start or md <= end):
                return True
        return False
    return False


def window(p: dict, now: datetime | None = None) -> tuple[bool, datetime | None]:
    """(live now?, when the current run ends — None if open-ended)."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    start, end = ts(p.get("starts_at")), ts(p.get("ends_at"))
    if not p.get("is_active") or (start and now < start) or (end and now >= end):
        return False, None
    today = now.astimezone(TZ).date()
    if not day_matches(p, today):
        return False, None
    if (p.get("schedule_type") or "once") == "once":
        return True, end
    # Walk forward over consecutive active days: a Sat+Sun sale runs until Sunday midnight
    day = today
    for _ in range(MAX_RUN_DAYS):
        nxt = day + timedelta(days=1)
        if not day_matches(p, nxt):
            until = datetime.combine(nxt, time.min, TZ).astimezone(timezone.utc)
            return True, min(until, end) if end else until
        day = nxt
    return True, end


def next_start(p: dict, now: datetime | None = None) -> datetime | None:
    """When it next switches on (for the admin list). None if it never will again."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if not p.get("is_active"):
        return None
    start, end = ts(p.get("starts_at")), ts(p.get("ends_at"))
    if (p.get("schedule_type") or "once") == "once":
        return start if start and start > now and (not end or start < end) else None
    first = max(now, start) if start else now
    day = first.astimezone(TZ).date()
    for i in range(MAX_RUN_DAYS):
        d = day + timedelta(days=i)
        if day_matches(p, d):
            at = max(datetime.combine(d, time.min, TZ).astimezone(timezone.utc), start or now)
            if at <= now:
                continue
            return at if not end or at < end else None
    return None


def describe(p: dict) -> str:
    """Plain words for the schedule: "Every Saturday and Sunday", "Every 25th", "Every 25 December"."""
    kind = p.get("schedule_type") or "once"
    if kind == "weekly":
        names = [WEEKDAY_NAMES[d] for d in sorted(set(p.get("weekdays") or []), key=lambda d: (d - 1) % 7)]
        if set(p.get("weekdays") or []) == {0, 6}:
            return "Every weekend (Saturday and Sunday)"
        return "Every " + _join(names) if names else "Weekly"
    if kind == "monthly":
        days = sorted(set(p.get("month_days") or []))
        return "Every " + _join([_ordinal(d) for d in days]) + " of the month" if days else "Monthly"
    if kind == "yearly":
        parts = []
        for r in p.get("yearly_ranges") or []:
            (sm, sd), (em, ed) = _md(r["start"]), _md(r["end"])
            parts.append(f"{sd} {MONTHS[sm - 1]}" if (sm, sd) == (em, ed) else f"{sd} {MONTHS[sm - 1]} – {ed} {MONTHS[em - 1]}")
        return "Every year: " + _join(parts) if parts else "Yearly"
    return "One time"


def _ordinal(n: int) -> str:
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]
