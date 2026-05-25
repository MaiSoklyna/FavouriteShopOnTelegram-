"""Product review routes."""

from __future__ import annotations

from fastapi import APIRouter

from app.core.constants import Role
from app.core.dependencies import require_any_admin, require_role
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.models.review import ReviewCreate

router = APIRouter(prefix="/reviews", tags=["Reviews"])


@router.post("")
async def create_review(body: ReviewCreate, user: TokenClaims = require_role(Role.USER)):
    """Create a product review."""
    async with SupabaseClient.service_role() as db:
        # Resolve user
        db_user = None
        if user.telegram_id:
            db_user = await db.from_("users").eq("telegram_id", user.telegram_id).select_one("id,first_name,last_name,username")
        if not db_user:
            raise NotFoundError("User")

        # Insert review
        review_data = {
            "product_id": body.product_id,
            "user_id": db_user["id"],
            "rating": body.rating,
            "comment": body.comment,
        }
        if body.order_id:
            review_data["order_id"] = body.order_id

        rows = await db.from_("reviews").insert(review_data)

        # Attach user name for response
        name = db_user.get("first_name", "")
        if db_user.get("last_name"):
            name += f" {db_user['last_name']}"
        user_name = name.strip() or db_user.get("username") or "Anonymous"
        if rows and isinstance(rows, list):
            rows[0]["user_name"] = user_name

        # Recalculate product rating
        all_reviews = await db.from_("reviews").eq("product_id", body.product_id).select("rating")
        if all_reviews:
            avg = sum(r["rating"] for r in all_reviews) / len(all_reviews)
            await db.from_("products").eq("id", body.product_id).update({
                "rating_avg": round(avg, 2),
                "review_count": len(all_reviews),
            })

    return {"success": True, "data": rows[0] if rows else review_data}


@router.get("")
async def list_reviews(
    product_id: int | None = None,
    merchant_id: int | None = None,
    page: int = 1,
    page_size: int = 25,
):
    """List reviews for a product or merchant (public)."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("reviews").order("created_at", desc=True)
        if product_id:
            q = q.eq("product_id", product_id)
        q = q.offset((page - 1) * page_size).limit(page_size)
        reviews = await q.select("*,users!inner(first_name,last_name,username)")

        for r in reviews:
            u = r.pop("users", None) or {}
            name = u.get("first_name", "")
            if u.get("last_name"):
                name += f" {u['last_name']}"
            r["user_name"] = name.strip() or u.get("username") or "Anonymous"

        return reviews


@router.delete("/{review_id}")
async def delete_review(review_id: int, user: TokenClaims = require_any_admin()):
    """Delete a review (admin only)."""
    async with SupabaseClient.service_role() as db:
        await db.from_("reviews").eq("id", review_id).delete()
    return {"success": True}
