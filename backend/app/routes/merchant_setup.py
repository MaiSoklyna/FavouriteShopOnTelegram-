"""Shop setup wizard API.

The checklist, starter category suggestions, the Telegram group link code, and the platform's
"Publish now". The shop's own settings (hours, location, fees, type) are saved through the existing
PATCH /merchants/{id}; categories and products through their own endpoints. Every one of those
calls shop_setup.refresh, which makes the shop live once everything required is done.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.config import settings
from app.core.constants import Role, shop_role
from app.core.dependencies import require_any_admin, require_super_admin
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.services import audit, shop_setup

router = APIRouter(prefix="/merchant-setup", tags=["Shop setup"])

SHOP_FIELDS = ("id,name,status,shop_category_id,shop_subcategory_id,logo_url,address,latitude,longitude,opening_hours,"
               "telegram_group_id,delivery_radius_km,delivery_base_fee,delivery_per_km_fee,min_order_amount,"
               "tagline,description,fb_page,instagram,setup_completed_at,delivery_fee_mode")


def _shop_id(user: TokenClaims, merchant_id: int | None) -> int:
    if user.role == Role.MERCHANT_ADMIN:
        if not user.merchant_id:
            raise ForbiddenError("Your account is not linked to a shop")
        return user.merchant_id
    if merchant_id is None:
        raise BadRequestError("merchant_id is required")
    return merchant_id


def _owner_or_platform(user: TokenClaims) -> None:
    if user.role == Role.MERCHANT_ADMIN and shop_role(user.merchant_role) != "owner":
        raise ForbiddenError("Only the shop owner can change the shop's settings")


async def _suggestions(db, shop: dict) -> list[dict]:
    """Starter categories for the shop's type and subtype, minus the ones it already has."""
    if shop.get("shop_category_id") is None:
        return []
    try:
        rows = await db.from_("category_templates").eq("shop_category_id", shop["shop_category_id"]).eq("is_active", True) \
            .order("sort_order").select("id,shop_subcategory_id,name,name_kh,icon_emoji")
    except Exception:
        return []  # before migration 041
    sub = shop.get("shop_subcategory_id")
    specific = [r for r in rows if sub is not None and r.get("shop_subcategory_id") == sub]
    picks = specific or [r for r in rows if r.get("shop_subcategory_id") is None]
    have = {c["name"].strip().lower() for c in await db.from_("categories").eq("merchant_id", shop["id"])
            .eq("is_active", True).select("name")}
    return [r for r in picks if r["name"].strip().lower() not in have]


@router.get("")
async def get_setup(merchant_id: int | None = None, user: TokenClaims = require_any_admin()):
    """The shop's setup checklist, its current settings (to fill the wizard) and starter suggestions."""
    async with SupabaseClient.service_role() as db:
        mid = _shop_id(user, merchant_id)
        try:
            shop = await db.from_("merchants").eq("id", mid).select_one(SHOP_FIELDS)
        except Exception:
            shop = await db.from_("merchants").eq("id", mid).select_one(SHOP_FIELDS.replace(",setup_completed_at,delivery_fee_mode", ""))
        if not shop:
            raise NotFoundError("Merchant", mid)
        state = await shop_setup.checklist(db, mid)
        suggestions = await _suggestions(db, shop)
    owner = user.is_super_admin or shop_role(user.merchant_role) == "owner"
    return {
        "checklist": state,
        "shop": {**shop, "telegram_group_linked": shop_setup.is_group_chat(shop.get("telegram_group_id"))},
        "suggestions": suggestions,
        "can_edit_settings": owner,
        "can_change_type": user.is_super_admin or (owner and not state.get("live")),
        "bot_username": settings.TELEGRAM_BOT_USERNAME or "byme24_bot",
    }


@router.get("/overview")
async def overview(user: TokenClaims = require_super_admin()):
    """Every shop's setup progress, for the platform's Merchants page."""
    async with SupabaseClient.service_role() as db:
        shops = await db.from_("merchants").order("id").select("id")
        out = []
        for s in shops:
            state = await shop_setup.checklist(db, s["id"])
            out.append({k: state.get(k) for k in ("merchant_id", "name", "live", "done", "total", "missing", "status")})
    return {"data": out}


@router.post("/telegram-code")
async def telegram_code(merchant_id: int | None = None, user: TokenClaims = require_any_admin()):
    """A short code to send in the shop's Telegram order group to link it."""
    _owner_or_platform(user)
    mid = _shop_id(user, merchant_id)
    bot = settings.TELEGRAM_BOT_USERNAME or "byme24_bot"
    code = shop_setup.link_code(mid)
    return {
        "code": code,
        "command": f"/link@{bot} {code}",
        "expires_in": shop_setup.link_code_expires_in(),
        "bot_username": bot,
    }


class StarterCategories(BaseModel):
    names: list[str] = Field(..., min_length=1, max_length=20)


@router.post("/categories")
async def create_starter_categories(body: StarterCategories, merchant_id: int | None = None,
                                    user: TokenClaims = require_any_admin()):
    """Create the chosen starter categories (and any typed-in names) as the shop's own categories."""
    async with SupabaseClient.service_role() as db:
        mid = _shop_id(user, merchant_id)
        templates = {}
        try:
            for t in await db.from_("category_templates").eq("is_active", True).select("name,name_kh,icon_emoji"):
                templates.setdefault(t["name"].strip().lower(), t)
        except Exception:
            pass
        existing = await db.from_("categories").eq("merchant_id", mid).eq("is_active", True).select("name,sort_order")
        have = {c["name"].strip().lower() for c in existing}
        next_sort = max([c.get("sort_order") or 0 for c in existing] + [0]) + 1
        created = []
        for raw in body.names:
            name = " ".join((raw or "").split())[:100]
            if not name or name.lower() in have:
                continue
            t = templates.get(name.lower(), {})
            row = {"name": name, "name_kh": t.get("name_kh"), "icon_emoji": t.get("icon_emoji"),
                   "merchant_id": mid, "sort_order": next_sort, "is_active": True}
            created += await db.from_("categories").insert(row)
            have.add(name.lower())
            next_sort += 1
        state = await shop_setup.refresh(db, mid) or await shop_setup.checklist(db, mid)
    return {"success": True, "created": [{"id": c["id"], "name": c["name"]} for c in created], "checklist": state}


@router.post("/{merchant_id}/publish")
async def publish(merchant_id: int, user: TokenClaims = require_super_admin()):
    """Make a shop visible to customers now, whatever its checklist says."""
    async with SupabaseClient.service_role() as db:
        done = await shop_setup.publish(db, merchant_id, user)
        state = await shop_setup.checklist(db, merchant_id)
    return {"success": True, "published": done, "checklist": state}
