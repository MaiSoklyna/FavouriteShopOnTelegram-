"""Shop review routes: customers rate a delivered order, everyone sees a shop's rating, shops see their
summary, and the platform can hide an abusive review."""

from __future__ import annotations

import httpx
from fastapi import APIRouter

from app.core.constants import Role
from app.core.dependencies import require_role, require_super_admin
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.models.shop_review import ShopReviewCreate, VisibilityUpdate
from app.services import shop_reviews, shop_setup

router = APIRouter(prefix="/shop-reviews", tags=["Shop Reviews"])

EMPTY_SUMMARY = {"rating": None, "count": 0, "distribution": {str(n): 0 for n in range(5, 0, -1)}}


async def _tolerant(call, empty):
    """Before migration 029 there is no shop_reviews table: show "no reviews yet" instead of an error."""
    try:
        return await call
    except httpx.HTTPStatusError as exc:
        if shop_reviews._not_set_up(exc):
            return empty
        raise


async def _own_shop(user: TokenClaims) -> int:
    if user.merchant_id is None:
        raise ForbiddenError("This account is not linked to a shop")
    return user.merchant_id


# ── Customers ───────────────────────────────────────────────────


@router.post("")
async def create_shop_review(body: ShopReviewCreate, user: TokenClaims = require_role(Role.USER)):
    """Rate the shop for a delivered order (one review per order)."""
    async with SupabaseClient.service_role() as db:
        person = None
        if user.telegram_id:
            person = await db.from_("users").eq("telegram_id", user.telegram_id).select_one("id,first_name,last_name")
        if not person:
            raise NotFoundError("User")
        review = await shop_reviews.submit(db, person, body.order_id, body.rating, body.comment)
    return {"success": True, "data": {k: review.get(k) for k in ("id", "rating", "comment", "created_at")}}


# ── Everyone: a shop's rating and what people said ──────────────


@router.get("/shops/{merchant_id}")
async def shop_reviews_public(merchant_id: int, limit: int = 10, before: int | None = None):
    async with SupabaseClient.service_role() as db:
        shop = await db.from_("merchants").eq("id", merchant_id).select_one()
        if not shop_setup.is_visible(shop):
            shop = None
        if not shop:
            raise NotFoundError("Merchant", merchant_id)
        summary = await _tolerant(shop_reviews.summary(db, merchant_id), EMPTY_SUMMARY)
        reviews = await _tolerant(shop_reviews.listing(db, merchant_id, limit=limit, before=before), [])
    return {"summary": summary, "reviews": [{k: v for k, v in r.items() if k != "is_visible"} for r in reviews]}


# ── A shop's own dashboard ──────────────────────────────────────


@router.get("/merchant/summary")
async def my_shop_summary(user: TokenClaims = require_role(Role.MERCHANT_ADMIN)):
    """The shop's rating, the spread of stars and its latest reviews."""
    shop_id = await _own_shop(user)
    async with SupabaseClient.service_role() as db:
        summary = await _tolerant(shop_reviews.summary(db, shop_id), EMPTY_SUMMARY)
        latest = await _tolerant(shop_reviews.listing(db, shop_id, limit=5, before=None), [])
    return {"summary": summary, "latest": [{k: v for k, v in r.items() if k != "is_visible"} for r in latest]}


@router.get("/merchant/list")
async def my_shop_reviews(limit: int = 20, before: int | None = None, user: TokenClaims = require_role(Role.MERCHANT_ADMIN)):
    shop_id = await _own_shop(user)
    async with SupabaseClient.service_role() as db:
        reviews = await _tolerant(shop_reviews.listing(db, shop_id, limit=limit, before=before), [])
    return {"data": [{k: v for k, v in r.items() if k != "is_visible"} for r in reviews]}


# ── The platform: moderation ────────────────────────────────────


@router.get("/admin/list")
async def admin_list(merchant_id: int | None = None, limit: int = 30, before: int | None = None,
                     user: TokenClaims = require_super_admin()):
    """Every review including hidden ones, with the shop's name."""
    limit = max(1, min(limit, 100))
    async with SupabaseClient.service_role() as db:
        async def load():
            q = db.from_("shop_reviews")
            if merchant_id is not None:
                q = q.eq("merchant_id", merchant_id)
            if before is not None:
                q = q.lt("id", before)
            rows = await q.order("id", desc=True).limit(limit).select("id,order_id,user_id,merchant_id,rating,comment,is_visible,created_at")
            if not rows:
                return []
            people = {p["id"]: p for p in await db.from_("users").in_("id", list({r["user_id"] for r in rows})).select("id,first_name,last_name")}
            shops = {m["id"]: m["name"] for m in await db.from_("merchants").in_("id", list({r["merchant_id"] for r in rows})).select("id,name")}
            return [{**r, "reviewer": shop_reviews.reviewer_name(people.get(r["user_id"])), "shop_name": shops.get(r["merchant_id"])} for r in rows]

        return {"data": await _tolerant(load(), [])}


@router.patch("/admin/{review_id}/visibility")
async def set_visibility(review_id: int, body: VisibilityUpdate, user: TokenClaims = require_super_admin()):
    """Hide an abusive review (or show it again). Hidden reviews leave the shop's average."""
    async with SupabaseClient.service_role() as db:
        try:
            rows = await db.from_("shop_reviews").eq("id", review_id).update({"is_visible": body.is_visible})
        except httpx.HTTPStatusError as exc:
            if shop_reviews._not_set_up(exc):
                raise BadRequestError("Reviews are not set up on the server yet.")
            raise
        if not rows:
            raise NotFoundError("Review", review_id)
        await shop_reviews.recalc(db, rows[0]["merchant_id"])
    return {"success": True}
