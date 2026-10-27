"""Promotions — a banner and an offer in one (migration 018).

scope 'shop' covers every product in the shop, 'product' only the listed
products, 'category' the shop's products in one category, 'platform' every
shop (no merchant). The coupon is a promo_codes row the admin form keeps in
step, so checkout validates it as before; orders._price_cart reads the scope
to discount only eligible items. When a promotion is on comes from its
schedule (services/promo_schedule, migration 019) — checked on every read.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, File, UploadFile
from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.constants import Role
from app.core.dependencies import require_any_admin
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import StorageClient, SupabaseClient
from app.services import promo_schedule

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/promotions", tags=["Promotions"])

# Where a promotion shows. Home has one Promotions section; 'home_featured' (before 021) means the same.
LOCATIONS = {"home_promotions", "shop_page"}
MIGRATION_HINT = "The promotions table doesn't exist yet: run supabase/migrations/018_promotions.sql"


def _table_missing(exc: Exception) -> bool:
    """PostgREST answers 404 PGRST205 for a table it doesn't know (migration 018 not run)."""
    resp = getattr(exc, "response", None)
    body = resp.text if resp is not None else str(exc)
    return "PGRST205" in body and "promotion" in body


ALLOWED_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MAX_IMAGE_BYTES = 4 * 1024 * 1024
PRODUCT_COLUMNS = "id,name,base_price,compare_price,primary_image,icon_emoji,merchant_id,category_id,stock,is_active"


class PromotionIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    subtitle: str | None = Field(None, max_length=500)
    scope: str = Field(..., pattern=r"^(shop|product|category|platform)$")
    merchant_id: int | None = None
    category_id: int | None = None
    product_ids: list[int] = []
    # The offer is optional: a promotion can be only a banner. Code and discount go together.
    code: str | None = Field(None, min_length=3, max_length=30)
    discount_type: str | None = Field(None, pattern=r"^(percent|fixed)$")
    discount_value: float | None = Field(None, gt=0)
    min_order: float = Field(0, ge=0)
    max_uses: int | None = Field(None, ge=1)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    display_locations: list[str] = ["home_promotions"]
    is_active: bool = True
    sort_order: int = 0
    # Schedule (migration 019)
    schedule_type: str = Field("once", pattern=r"^(once|weekly|monthly|yearly)$")
    weekdays: list[int] = []
    month_days: list[int] = []
    yearly_ranges: list[dict] = []
    # Applied at checkout without the customer typing the code
    auto_apply: bool = True

    @field_validator("weekdays")
    @classmethod
    def _weekdays(cls, v: list[int]) -> list[int]:
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("Weekdays are 0 (Sunday) to 6 (Saturday)")
        return sorted(set(v))

    @field_validator("month_days")
    @classmethod
    def _month_days(cls, v: list[int]) -> list[int]:
        if any(d < 1 or d > 31 for d in v):
            raise ValueError("Days of the month are 1 to 31")
        return sorted(set(v))

    @field_validator("yearly_ranges")
    @classmethod
    def _yearly(cls, v: list[dict]) -> list[dict]:
        out = []
        for r in v:
            start, end = str(r.get("start", "")), str(r.get("end") or r.get("start", ""))
            for md in (start, end):
                try:
                    datetime.strptime(f"2024-{md}", "%Y-%m-%d")  # 2024 is a leap year, so 02-29 is allowed
                except ValueError:
                    raise ValueError(f"'{md}' is not a month-day like 12-25") from None
            out.append({"start": start, "end": end})
        return out

    @field_validator("code")
    @classmethod
    def _code(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        v = v.strip().upper()
        if not v.replace("-", "").replace("_", "").isalnum():
            raise ValueError("Code can use letters, numbers, - and _ only")
        return v

    @model_validator(mode="after")
    def _offer_complete(self):
        if bool(self.code) != bool(self.discount_type and self.discount_value):
            raise ValueError("A coupon code needs a discount, and a discount needs a code")
        return self

    @field_validator("display_locations")
    @classmethod
    def _locations(cls, v: list[str]) -> list[str]:
        v = ["home_promotions" if x == "home_featured" else x for x in v]
        bad = set(v) - LOCATIONS
        if bad:
            raise ValueError(f"Unknown display location: {', '.join(sorted(bad))}")
        return sorted(set(v))


def _is_live(p: dict, now: datetime | None = None) -> bool:
    return promo_schedule.window(p, now)[0]


def _with_schedule(p: dict, now: datetime | None = None) -> dict:
    """Add is_live, active_until (end of the current run) and the schedule in words."""
    live, until = promo_schedule.window(p, now)
    p["is_live"] = live
    p["active_until"] = until.isoformat() if until else None
    p["schedule_text"] = promo_schedule.describe(p)
    return p


async def _enrich(db, rows: list[dict]) -> list[dict]:
    """Attach shop, category name, the offer (code row) and product count."""
    if not rows:
        return rows
    mids = list({r["merchant_id"] for r in rows if r.get("merchant_id")})
    cids = list({r["category_id"] for r in rows if r.get("category_id")})
    codes = list({r["promo_code_id"] for r in rows if r.get("promo_code_id")})
    pids = [r["id"] for r in rows if r["scope"] == "product"]
    shops = {m["id"]: m for m in (await db.from_("merchants").in_("id", mids).select("id,name,logo_url,icon_emoji,accent_color") if mids else [])}
    cats = {c["id"]: c["name"] for c in (await db.from_("categories").in_("id", cids).select("id,name") if cids else [])}
    offers = {c["id"]: c for c in (await db.from_("promo_codes").in_("id", codes).select("id,code,type,value,min_order,max_uses,used_count,is_active") if codes else [])}
    counts: dict[int, int] = {}
    if pids:
        for link in await db.from_("promotion_products").in_("promotion_id", pids).select("promotion_id"):
            counts[link["promotion_id"]] = counts.get(link["promotion_id"], 0) + 1
    for r in rows:
        r["shop"] = shops.get(r.get("merchant_id"))
        r["category_name"] = cats.get(r.get("category_id"))
        o = offers.get(r.get("promo_code_id"))
        r["offer"] = {k: o[k] for k in ("code", "type", "value", "min_order", "max_uses", "used_count", "is_active")} if o else None
        r["product_count"] = counts.get(r["id"]) if r["scope"] == "product" else None
    return rows


# ── Public ──────────────────────────────────────────────────

@router.get("")
async def list_promotions(location: str | None = None, merchant_id: int | None = None):
    """Live promotions, optionally for one display location and/or shop."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("promotions").eq("is_active", True).order("sort_order").order("id", desc=True)
        if merchant_id:
            q = q.or_(f"merchant_id.eq.{merchant_id}", "merchant_id.is.null")
        try:
            all_rows = await q.select()
        except Exception as exc:
            if _table_missing(exc):  # before migration 018 the app simply has no promotions
                return []
            raise
        now = datetime.now(timezone.utc)
        rows = [_with_schedule(r, now) for r in all_rows]
        want = "home_promotions" if location == "home_featured" else location
        rows = [r for r in rows if r["is_live"] and (not want or want in ["home_promotions" if x == "home_featured" else x for x in (r.get("display_locations") or [])])]
        rows = await _enrich(db, rows)
        # Every promotion shows; one whose code was switched off or used up shows without its offer
        for r in rows:
            o = r["offer"]
            if o and (not o["is_active"] or (o["max_uses"] and (o["used_count"] or 0) >= o["max_uses"])):
                r["offer"] = None
        return rows


@router.get("/{promotion_id}")
async def get_promotion(promotion_id: int):
    """One promotion with its offer, eligible shop and eligible products."""
    async with SupabaseClient.service_role() as db:
        try:
            p = await db.from_("promotions").eq("id", promotion_id).select_one()
        except Exception as exc:
            if not _table_missing(exc):
                raise
            p = None
        if not p:
            raise NotFoundError("Promotion", promotion_id)
        _with_schedule(p)
        if not p["is_live"]:
            # A scheduled sale on an off day still has a page that says when it's back
            nxt = promo_schedule.next_start(p)
            if not nxt:
                raise NotFoundError("Promotion", promotion_id)
            p["next_start"] = nxt.isoformat()
        p = (await _enrich(db, [p]))[0]
        q = db.from_("products").eq("is_active", True)
        if p.get("merchant_id"):
            q = q.eq("merchant_id", p["merchant_id"])
        elif p.get("category_id"):
            # A platform-wide promotion for one category (e.g. a former category banner)
            q = q.eq("category_id", p["category_id"])
        if p["scope"] == "product":
            ids = [x["product_id"] for x in await db.from_("promotion_products").eq("promotion_id", promotion_id).select("product_id")]
            p["products"] = await q.in_("id", ids).select(PRODUCT_COLUMNS) if ids else []
        elif p["scope"] == "category":
            p["products"] = await q.eq("category_id", p["category_id"]).limit(60).select(PRODUCT_COLUMNS)
        else:
            p["products"] = await q.order("id", desc=True).limit(60).select(PRODUCT_COLUMNS)
        return p


# ── Admin ───────────────────────────────────────────────────

def _own_shop(user: TokenClaims, merchant_id: int | None, scope: str = "shop") -> int | None:
    """Merchant admins work on their own shop only; super admins pick one, or none for platform-wide."""
    if scope == "platform":
        if user.role != Role.SUPER_ADMIN:
            raise ForbiddenError("Only a super admin can create platform-wide promotions")
        return None
    if user.role == Role.MERCHANT_ADMIN:
        if not user.merchant_id:
            raise ForbiddenError("No shop linked to this account")
        return user.merchant_id
    if not merchant_id:
        raise BadRequestError("Choose the shop this promotion belongs to")
    return merchant_id


async def _load_own(db, promotion_id: int, user: TokenClaims) -> dict:
    p = await db.from_("promotions").eq("id", promotion_id).select_one()
    if not p:
        raise NotFoundError("Promotion", promotion_id)
    if user.role == Role.MERCHANT_ADMIN and p.get("merchant_id") != user.merchant_id:
        raise ForbiddenError("This promotion belongs to another shop")
    return p


async def _check_targets(db, body: PromotionIn, merchant_id: int | None) -> list[int]:
    """Validate the category / products against the shop. Returns the product ids to link."""
    if body.starts_at and body.ends_at and body.starts_at >= body.ends_at:
        raise BadRequestError("End date must be after the start date")
    if body.discount_type == "percent" and (body.discount_value or 0) > 100:
        raise BadRequestError("A percentage discount can't be more than 100")
    if body.schedule_type == "weekly" and not body.weekdays:
        raise BadRequestError("Pick the days of the week it runs")
    if body.schedule_type == "monthly" and not body.month_days:
        raise BadRequestError("Pick the days of the month it runs")
    if body.schedule_type == "yearly" and not body.yearly_ranges:
        raise BadRequestError("Add at least one date it runs every year")
    if body.scope == "platform" and body.category_id:
        if not await db.from_("categories").eq("id", body.category_id).select_one("id"):
            raise BadRequestError("That category doesn't exist")
    if body.scope == "category":
        if not body.category_id:
            raise BadRequestError("Choose the category this promotion covers")
        cat = await db.from_("categories").eq("id", body.category_id).select_one("id,merchant_id")
        if not cat or (cat.get("merchant_id") and cat["merchant_id"] != merchant_id):
            raise BadRequestError("That category isn't available for this shop")
    if body.scope == "product":
        ids = sorted(set(body.product_ids))
        if not ids:
            raise BadRequestError("Choose at least one product")
        found = await db.from_("products").in_("id", ids).eq("merchant_id", merchant_id).select("id")
        if len(found) != len(ids):
            raise BadRequestError("Some products aren't in this shop")
        return ids
    return []


async def _sync_code(db, body: PromotionIn, merchant_id: int | None, promotion_id: int | None, current_code_id: int | None) -> int | None:
    """Create or update the promo_codes row behind this promotion. Returns its id, or None
    for a promotion without an offer (its old code, if any, is switched off)."""
    if not body.code:
        if current_code_id:
            await db.from_("promo_codes").eq("id", current_code_id).update({"is_active": False})
        return None
    q = db.from_("promo_codes").eq("code", body.code)
    q = q.eq("merchant_id", merchant_id) if merchant_id else q.is_("merchant_id", "null")
    existing = await q.select_one("id")
    if existing and existing["id"] != current_code_id:
        clash = await db.from_("promotions").eq("promo_code_id", existing["id"]).select("id")
        if any(c["id"] != promotion_id for c in clash):
            raise BadRequestError(f"Code {body.code} is already used by another promotion")
    row = {
        "merchant_id": merchant_id, "code": body.code, "type": body.discount_type,
        "value": body.discount_value, "min_order": body.min_order, "max_uses": body.max_uses,
        "expires_at": body.ends_at.isoformat() if body.ends_at else None, "is_active": body.is_active,
    }
    code_id = existing["id"] if existing else current_code_id
    if code_id:
        await db.from_("promo_codes").eq("id", code_id).update(row)
        return code_id
    return (await db.from_("promo_codes").insert(row))[0]["id"]


def _promotion_row(body: PromotionIn, merchant_id: int | None, code_id: int | None) -> dict:
    return {
        "title": body.title.strip(), "subtitle": (body.subtitle or "").strip() or None, "scope": body.scope,
        # Platform-wide may be limited to one category (its products from every shop)
        "merchant_id": merchant_id, "category_id": body.category_id if body.scope in ("category", "platform") else None,
        "promo_code_id": code_id,
        "starts_at": body.starts_at.isoformat() if body.starts_at else None,
        "ends_at": body.ends_at.isoformat() if body.ends_at else None,
        "display_locations": body.display_locations, "is_active": body.is_active, "sort_order": body.sort_order,
        "schedule_type": body.schedule_type,
        "weekdays": body.weekdays if body.schedule_type == "weekly" else [],
        "month_days": body.month_days if body.schedule_type == "monthly" else [],
        "yearly_ranges": body.yearly_ranges if body.schedule_type == "yearly" else [],
        "auto_apply": body.auto_apply,
    }


@router.get("/admin/list")
async def admin_list(user: TokenClaims = require_any_admin()):
    """All promotions (super admin) or this shop's (merchant admin), with product ids for editing."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("promotions").order("sort_order").order("id", desc=True)
        if user.role == Role.MERCHANT_ADMIN:
            q = q.eq("merchant_id", user.merchant_id or 0)
        try:
            rows = await _enrich(db, await q.select())
        except Exception as exc:
            if _table_missing(exc):
                raise BadRequestError(MIGRATION_HINT) from exc
            raise
        ids = [r["id"] for r in rows if r["scope"] == "product"]
        links: dict[int, list[int]] = {}
        if ids:
            for x in await db.from_("promotion_products").in_("promotion_id", ids).select("promotion_id,product_id"):
                links.setdefault(x["promotion_id"], []).append(x["product_id"])
        now = datetime.now(timezone.utc)
        for r in rows:
            r["product_ids"] = links.get(r["id"], [])
            _with_schedule(r, now)
            nxt = None if r["is_live"] else promo_schedule.next_start(r, now)
            r["next_start"] = nxt.isoformat() if nxt else None
        return rows


@router.post("/admin")
async def admin_create(body: PromotionIn, user: TokenClaims = require_any_admin()):
    async with SupabaseClient.service_role() as db:
        merchant_id = _own_shop(user, body.merchant_id, body.scope)
        product_ids = await _check_targets(db, body, merchant_id)
        code_id = await _sync_code(db, body, merchant_id, None, None)
        p = (await db.from_("promotions").insert(_promotion_row(body, merchant_id, code_id)))[0]
        if product_ids:
            await db.from_("promotion_products").insert([{"promotion_id": p["id"], "product_id": i} for i in product_ids])
        return p


@router.put("/admin/{promotion_id}")
async def admin_update(promotion_id: int, body: PromotionIn, user: TokenClaims = require_any_admin()):
    async with SupabaseClient.service_role() as db:
        current = await _load_own(db, promotion_id, user)
        merchant_id = current["merchant_id"] if user.role == Role.MERCHANT_ADMIN else _own_shop(user, body.merchant_id, body.scope)
        if user.role == Role.MERCHANT_ADMIN and body.scope == "platform":
            raise ForbiddenError("Only a super admin can create platform-wide promotions")
        product_ids = await _check_targets(db, body, merchant_id)
        code_id = await _sync_code(db, body, merchant_id, promotion_id, current.get("promo_code_id") if merchant_id == current.get("merchant_id") else None)
        row = _promotion_row(body, merchant_id, code_id) | {"updated_at": datetime.now(timezone.utc).isoformat()}
        p = (await db.from_("promotions").eq("id", promotion_id).update(row))[0]
        await db.from_("promotion_products").eq("promotion_id", promotion_id).delete()
        if product_ids:
            await db.from_("promotion_products").insert([{"promotion_id": promotion_id, "product_id": i} for i in product_ids])
        return p


@router.delete("/admin/{promotion_id}")
async def admin_delete(promotion_id: int, user: TokenClaims = require_any_admin()):
    """Delete a promotion and switch its code off (past orders keep their discount)."""
    async with SupabaseClient.service_role() as db:
        p = await _load_own(db, promotion_id, user)
        if p.get("promo_code_id"):
            await db.from_("promo_codes").eq("id", p["promo_code_id"]).update({"is_active": False})
        await db.from_("promotions").eq("id", promotion_id).delete()
        return {"deleted": promotion_id}


@router.post("/admin/{promotion_id}/image")
async def admin_upload_image(promotion_id: int, file: UploadFile = File(...), user: TokenClaims = require_any_admin()):
    if file.content_type not in ALLOWED_MIME:
        raise BadRequestError("Image must be PNG, JPEG, WebP, or GIF")
    content = await file.read()
    if len(content) > MAX_IMAGE_BYTES:
        raise BadRequestError("Image too large (max 4 MB)")
    async with SupabaseClient.service_role() as db:
        await _load_own(db, promotion_id, user)
        ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "jpg"
        url = await StorageClient().upload(
            bucket="product-images", path=f"promotions/{promotion_id}/{int(time.time() * 1000)}.{ext}",
            content=content, content_type=file.content_type or "application/octet-stream",
        )
        await db.from_("promotions").eq("id", promotion_id).update({"image_url": url})
        return {"url": url}
