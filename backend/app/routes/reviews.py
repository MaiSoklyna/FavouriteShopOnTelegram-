"""Product review routes.

Reviews require admin approval before they appear publicly.
Customers submit → admin approves/rejects → only approved reviews show.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.constants import Role
from app.core.dependencies import require_any_admin, require_role
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.models.review import ReviewCreate

router = APIRouter(prefix="/reviews", tags=["Reviews"])


async def _recalculate_rating(db, product_id: int):
    """Recalculate product rating from approved reviews only."""
    approved = await db.from_("reviews").eq("product_id", product_id).eq("is_approved", True).select("rating")
    if approved:
        avg = sum(r["rating"] for r in approved) / len(approved)
        await db.from_("products").eq("id", product_id).update({
            "rating_avg": round(avg, 2),
            "review_count": len(approved),
        })
    else:
        await db.from_("products").eq("id", product_id).update({
            "rating_avg": 0,
            "review_count": 0,
        })


@router.post("")
async def create_review(body: ReviewCreate, user: TokenClaims = require_role(Role.USER)):
    """Create a product review (pending admin approval)."""
    async with SupabaseClient.service_role() as db:
        db_user = None
        if user.telegram_id:
            db_user = await db.from_("users").eq("telegram_id", user.telegram_id).select_one("id,first_name,last_name,username")
        if not db_user:
            raise NotFoundError("User")

        existing = await db.from_("reviews").eq("product_id", body.product_id).eq("user_id", db_user["id"]).select("id")
        if existing:
            raise BadRequestError("You have already reviewed this product")

        review_data = {
            "product_id": body.product_id,
            "user_id": db_user["id"],
            "rating": body.rating,
            "comment": body.comment,
            "is_approved": False,
        }
        if body.order_id:
            review_data["order_id"] = body.order_id

        rows = await db.from_("reviews").insert(review_data)

        name = db_user.get("first_name", "")
        if db_user.get("last_name"):
            name += f" {db_user['last_name']}"
        user_name = name.strip() or db_user.get("username") or "Anonymous"
        if rows and isinstance(rows, list):
            rows[0]["user_name"] = user_name

    return {"success": True, "message": "Review submitted! It will appear after admin approval.", "data": rows[0] if rows else review_data}


@router.get("")
async def list_reviews(
    product_id: int | None = None,
    merchant_id: int | None = None,
    page: int = 1,
    page_size: int = 25,
):
    """List approved reviews for a product (public)."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("reviews").eq("is_approved", True).order("created_at", desc=True)
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


# ═══════════════════════════════════════════════════════════════
#  ADMIN ENDPOINTS
# ═══════════════════════════════════════════════════════════════


@router.get("/admin/list")
async def list_all_reviews(
    status: str | None = None,
    product_id: int | None = None,
    page: int = 1,
    page_size: int = 25,
    user: TokenClaims = require_any_admin(),
):
    """List all reviews for admin (including pending)."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("reviews").order("created_at", desc=True)

        if status == "pending":
            q = q.eq("is_approved", False)
        elif status == "approved":
            q = q.eq("is_approved", True)

        if product_id:
            q = q.eq("product_id", product_id)

        q = q.offset((page - 1) * page_size).limit(page_size)
        reviews = await q.select("*,users!inner(first_name,last_name,username),products!inner(name)")

        for r in reviews:
            u = r.pop("users", None) or {}
            name = u.get("first_name", "")
            if u.get("last_name"):
                name += f" {u['last_name']}"
            r["user_name"] = name.strip() or u.get("username") or "Anonymous"

            p = r.pop("products", None) or {}
            r["product_name"] = p.get("name", "Unknown")

        return reviews


@router.patch("/admin/{review_id}/approve")
async def approve_review(review_id: int, user: TokenClaims = require_any_admin()):
    """Approve a pending review."""
    async with SupabaseClient.service_role() as db:
        rows = await db.from_("reviews").eq("id", review_id).select("id,product_id,is_approved")
        if not rows:
            raise NotFoundError("Review")

        review = rows[0]
        if review.get("is_approved"):
            return {"success": True, "message": "Already approved"}

        await db.from_("reviews").eq("id", review_id).update({"is_approved": True})
        await _recalculate_rating(db, review["product_id"])

    return {"success": True}


@router.patch("/admin/{review_id}/reject")
async def reject_review(review_id: int, user: TokenClaims = require_any_admin()):
    """Reject (unapprove) a review."""
    async with SupabaseClient.service_role() as db:
        rows = await db.from_("reviews").eq("id", review_id).select("id,product_id,is_approved")
        if not rows:
            raise NotFoundError("Review")

        review = rows[0]
        await db.from_("reviews").eq("id", review_id).update({"is_approved": False})
        await _recalculate_rating(db, review["product_id"])

    return {"success": True}


@router.delete("/{review_id}")
async def delete_review(review_id: int, user: TokenClaims = require_any_admin()):
    """Delete a review (admin only)."""
    async with SupabaseClient.service_role() as db:
        rows = await db.from_("reviews").eq("id", review_id).select("id,product_id")
        if not rows:
            raise NotFoundError("Review")

        product_id = rows[0]["product_id"]
        await db.from_("reviews").eq("id", review_id).delete()
        await _recalculate_rating(db, product_id)

    return {"success": True}
