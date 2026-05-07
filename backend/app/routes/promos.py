"""Promo code routes."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.core.constants import Role
from app.core.dependencies import require_any_admin, require_role
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.models.order import PromoValidateRequest

router = APIRouter(prefix="/promos", tags=["Promos"])


@router.post("/validate")
async def validate_promo(body: PromoValidateRequest, user: TokenClaims = require_role(Role.USER)):
    """Validate a promo code and return the discount amount."""
    async with SupabaseClient.service_role() as db:
        promo = await (
            db.from_("promo_codes")
            .eq("merchant_id", body.merchant_id)
            .eq("code", body.code)
            .eq("is_active", True)
            .select_one()
        )
        if not promo:
            raise NotFoundError("Promo code")

        if promo.get("expires_at"):
            exp = datetime.fromisoformat(promo["expires_at"].replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > exp:
                raise BadRequestError("Promo code has expired")

        if promo.get("max_uses") and promo.get("used_count", 0) >= promo["max_uses"]:
            raise BadRequestError("Promo code usage limit reached")

        if promo.get("min_order") and body.cart_total < promo["min_order"]:
            raise BadRequestError(f"Minimum order ${promo['min_order']} required")

        if promo["type"] == "percent":
            discount = round(body.cart_total * float(promo["value"]) / 100, 2)
        else:
            discount = min(float(promo["value"]), body.cart_total)

    return {
        "data": {
            "promo_id": promo["id"],
            "code": promo["code"],
            "type": promo["type"],
            "value": promo["value"],
            "discount_amount": discount,
        }
    }


# ── Public active promos (for shop users) ──────────────────────


@router.get("/active")
async def list_active_promos(merchant_id: int | None = None):
    """List active, non-expired promo codes (public — no auth required)."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("promo_codes").eq("is_active", True).order("created_at", desc=True)
        if merchant_id:
            q = q.eq("merchant_id", merchant_id)
        promos = await q.select()

    # Filter out expired promos server-side
    now = datetime.now(timezone.utc)
    result = []
    for p in promos:
        if p.get("expires_at"):
            try:
                exp = datetime.fromisoformat(p["expires_at"].replace("Z", "+00:00"))
                if now > exp:
                    continue
            except Exception:
                pass
        if p.get("max_uses") and p.get("used_count", 0) >= p["max_uses"]:
            continue
        result.append(p)
    return result


# ── Admin CRUD ──────────────────────────────────────────────────


_PROMO_WRITABLE_FIELDS = (
    "code", "type", "value", "min_order", "max_uses",
    "expires_at", "is_active",
)


@router.get("")
async def list_promos(merchant_id: int | None = None, user: TokenClaims = require_any_admin()):
    """List promo codes (admin only)."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("promo_codes").order("created_at", desc=True)
        if user.role == Role.MERCHANT_ADMIN:
            if user.merchant_id is None:
                return []
            q = q.eq("merchant_id", user.merchant_id)
        elif merchant_id:
            q = q.eq("merchant_id", merchant_id)
        return await q.select()


@router.post("")
async def create_promo(body: dict, user: TokenClaims = require_any_admin()):
    """Create a promo code (admin only)."""
    async with SupabaseClient.service_role() as db:
        data = {k: body[k] for k in body if k in _PROMO_WRITABLE_FIELDS}
        target_merchant_id = (
            user.merchant_id if user.role == Role.MERCHANT_ADMIN else body.get("merchant_id")
        )
        if target_merchant_id is None:
            raise BadRequestError("merchant_id is required")
        data["merchant_id"] = target_merchant_id
        rows = await db.from_("promo_codes").insert(data)
    return rows[0] if rows else data


@router.patch("/{promo_id}")
async def update_promo(promo_id: int, body: dict, user: TokenClaims = require_any_admin()):
    """Update a promo code (admin only)."""
    async with SupabaseClient.service_role() as db:
        data = {k: body[k] for k in body if k in _PROMO_WRITABLE_FIELDS}
        if data:
            await db.from_("promo_codes").eq("id", promo_id).update(data)
    return {"success": True}


@router.delete("/{promo_id}")
async def delete_promo(promo_id: int, user: TokenClaims = require_any_admin()):
    """Delete a promo code (admin only)."""
    async with SupabaseClient.service_role() as db:
        await db.from_("promo_codes").eq("id", promo_id).delete()
    return {"success": True}
