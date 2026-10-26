"""Featured categories — which category icons Home shows, and when (migration 020).

Home gets the live rows (schedule checked now, same rules as promotions) by
priority, at most HOME_MAX. With fewer than HOME_MIN it tops up through a fill
strategy so Home is never short; categories that aren't featured stay on the
Discover / Categories pages, which keep listing every category.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator

from app.core.dependencies import require_super_admin
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.services import promo_schedule

router = APIRouter(prefix="/featured-categories", tags=["FeaturedCategories"])

HOME_MIN, HOME_MAX = 4, 8
MIGRATION_HINT = "Featured categories aren't set up yet: run supabase/migrations/020_featured_categories.sql"


def _table_missing(exc: Exception) -> bool:
    resp = getattr(exc, "response", None)
    body = resp.text if resp is not None else str(exc)
    return "PGRST205" in body and "featured_categories" in body


# ── Fill strategies: how Home tops up to HOME_MIN ──────────────
# Each takes the active categories (with product_count) and returns them best-first.
# 'trending' (most viewed this week) and 'best_selling' (most ordered in 30 days)
# plug in here once their numbers exist; until then they fall back to most_products.

def _most_products(categories: list[dict]) -> list[dict]:
    return sorted(categories, key=lambda c: (-(c.get("product_count") or 0), c.get("sort_order") or 0, c["id"]))


FILL_STRATEGIES = {"most_products": _most_products}
DEFAULT_FILL = "most_products"


class FeaturedIn(BaseModel):
    category_id: int
    kind: str = Field("permanent", pattern=r"^(permanent|seasonal|scheduled)$")
    priority: int = Field(100, ge=0, le=10000)
    schedule_type: str = Field("once", pattern=r"^(once|weekly|monthly|yearly)$")
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    weekdays: list[int] = []
    month_days: list[int] = []
    yearly_ranges: list[dict] = []
    is_active: bool = True

    @field_validator("yearly_ranges")
    @classmethod
    def _yearly(cls, v: list[dict]) -> list[dict]:
        out = []
        for r in v:
            start, end = str(r.get("start", "")), str(r.get("end") or r.get("start", ""))
            for md in (start, end):
                try:
                    datetime.strptime(f"2024-{md}", "%Y-%m-%d")
                except ValueError:
                    raise ValueError(f"'{md}' is not a month-day like 12-25") from None
            out.append({"start": start, "end": end})
        return out

    def row(self) -> dict:
        """Normalise by kind: permanent has no schedule, seasonal is yearly, scheduled is the rest."""
        kind = self.kind
        schedule = "once" if kind == "permanent" else "yearly" if kind == "seasonal" else self.schedule_type
        if kind == "scheduled" and schedule == "yearly":
            raise BadRequestError("Use Seasonal for categories that come back every year")
        if kind == "seasonal" and not self.yearly_ranges:
            raise BadRequestError("Add the dates this category shows every year")
        if kind == "scheduled":
            if schedule == "once" and not (self.starts_at or self.ends_at):
                raise BadRequestError("Give a scheduled category a start or end date")
            if schedule == "weekly" and not self.weekdays:
                raise BadRequestError("Pick the days of the week")
            if schedule == "monthly" and not self.month_days:
                raise BadRequestError("Pick the days of the month")
        if self.starts_at and self.ends_at and self.starts_at >= self.ends_at:
            raise BadRequestError("End date must be after the start date")
        return {
            "category_id": self.category_id, "kind": kind, "priority": self.priority, "schedule_type": schedule,
            "starts_at": self.starts_at.isoformat() if self.starts_at and kind == "scheduled" else None,
            "ends_at": self.ends_at.isoformat() if self.ends_at and kind == "scheduled" else None,
            "weekdays": sorted(set(self.weekdays)) if schedule == "weekly" else [],
            "month_days": sorted(set(self.month_days)) if schedule == "monthly" else [],
            "yearly_ranges": self.yearly_ranges if schedule == "yearly" else [],
            "is_active": self.is_active,
        }


def pick_home(featured: list[dict], categories: list[dict], now: datetime | None = None, fill: str = DEFAULT_FILL) -> list[dict]:
    """The categories Home shows: live featured ones by priority (max 8), topped up to 4.
    With nothing featured right now, Home looks as it always has: 8, most products first.

    Each result is the category dict plus `featured_id` (None when filled in) and `source`.
    """
    by_id = {c["id"]: c for c in categories}
    live = sorted((f for f in featured if promo_schedule.window(f, now)[0]), key=lambda f: (f.get("priority", 100), f["id"]))
    out: list[dict] = []
    seen: set[int] = set()
    for f in live:
        c = by_id.get(f["category_id"])
        if c and c["id"] not in seen:
            out.append(c | {"featured_id": f["id"], "source": f["kind"]})
            seen.add(c["id"])
        if len(out) == HOME_MAX:
            return out
    target = HOME_MIN if out else HOME_MAX
    if len(out) < target:
        for c in FILL_STRATEGIES.get(fill, _most_products)([c for c in categories if c["id"] not in seen]):
            out.append(c | {"featured_id": None, "source": fill})
            if len(out) == target:
                break
    return out


async def _categories(db) -> list[dict]:
    """Active categories (global and shop-owned, as Home has always shown) with active product counts."""
    cats = await db.from_("categories").eq("is_active", True).order("sort_order").select("id,name,name_kh,icon_emoji,image_url,sort_order,merchant_id")
    counts: dict[int, int] = {}
    if cats:
        for p in await db.from_("products").in_("category_id", [c["id"] for c in cats]).eq("is_active", True).select("category_id"):
            counts[p["category_id"]] = counts.get(p["category_id"], 0) + 1
    return [c | {"product_count": counts.get(c["id"], 0)} for c in cats]


@router.get("/home")
async def home_categories():
    """What Home shows right now. Before migration 020 it is simply the top-up list."""
    async with SupabaseClient.service_role() as db:
        categories = await _categories(db)
        try:
            featured = await db.from_("featured_categories").eq("is_active", True).select()
        except Exception as exc:
            if not _table_missing(exc):
                raise
            featured = []
        return pick_home(featured, categories)


@router.get("/admin")
async def admin_list(user: TokenClaims = require_super_admin()):
    async with SupabaseClient.service_role() as db:
        categories = await _categories(db)
        try:
            rows = await db.from_("featured_categories").order("priority").order("id").select()
        except Exception as exc:
            if _table_missing(exc):
                raise BadRequestError(MIGRATION_HINT) from exc
            raise
        names = {c["id"]: c for c in categories}
        now = datetime.now(timezone.utc)
        for r in rows:
            live, until = promo_schedule.window(r, now)
            nxt = None if live else promo_schedule.next_start(r, now)
            r |= {"category": names.get(r["category_id"]), "is_live": live, "active_until": until.isoformat() if until else None,
                  "next_start": nxt.isoformat() if nxt else None, "schedule_text": "Always" if r["kind"] == "permanent" else promo_schedule.describe(r)}
        return {"rows": rows, "home": pick_home(rows, categories, now), "min": HOME_MIN, "max": HOME_MAX}


async def _check_category(db, category_id: int) -> None:
    if not await db.from_("categories").eq("id", category_id).eq("is_active", True).select_one("id"):
        raise NotFoundError("Category", category_id)


@router.post("/admin")
async def admin_create(body: FeaturedIn, user: TokenClaims = require_super_admin()):
    async with SupabaseClient.service_role() as db:
        await _check_category(db, body.category_id)
        return (await db.from_("featured_categories").insert(body.row()))[0]


@router.put("/admin/{featured_id}")
async def admin_update(featured_id: int, body: FeaturedIn, user: TokenClaims = require_super_admin()):
    async with SupabaseClient.service_role() as db:
        await _check_category(db, body.category_id)
        rows = await db.from_("featured_categories").eq("id", featured_id).update(body.row() | {"updated_at": datetime.now(timezone.utc).isoformat()})
        if not rows:
            raise NotFoundError("Featured category", featured_id)
        return rows[0]


@router.delete("/admin/{featured_id}")
async def admin_delete(featured_id: int, user: TokenClaims = require_super_admin()):
    async with SupabaseClient.service_role() as db:
        await db.from_("featured_categories").eq("id", featured_id).delete()
        return {"deleted": featured_id}


class ReorderIn(BaseModel):
    ids: list[int] = Field(..., min_length=1)


@router.post("/admin/reorder")
async def admin_reorder(body: ReorderIn, user: TokenClaims = require_super_admin()):
    """Save a new display order: the first id gets priority 10, the next 20, …"""
    async with SupabaseClient.service_role() as db:
        for i, fid in enumerate(body.ids):
            await db.from_("featured_categories").eq("id", fid).update({"priority": (i + 1) * 10})
        return {"ok": True}
