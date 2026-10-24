"""Merchant management routes.

Public: browse merchants.
Admin: CRUD operations (super_admin for all, merchant_admin for own).
"""

from __future__ import annotations

import math
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, UploadFile

from app.core.constants import Role
from app.core.dependencies import get_optional_user, require_any_admin, require_role
from app.core.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError, RateLimitError
from app.core.security import TokenClaims
from app.db.client import StorageClient, SupabaseClient
from app.models.merchant import MerchantCreate, MerchantUpdate
from app.services.delivery import SHOP_TZ, is_open, quote_delivery, valid_point

router = APIRouter(prefix="/merchants", tags=["Merchants"])

# Per-shop delivery settings (migration 017); null means "use the platform default"
DELIVERY_SETTING_FIELDS = ("opening_hours", "delivery_base_fee", "delivery_per_km_fee", "min_order_amount")

# Fields the public "nearby" list may expose — merchants rows also hold owner contact details
NEARBY_PUBLIC_FIELDS = (
    "id", "name", "slug", "tagline", "icon_emoji", "accent_color", "logo_url",
    "is_featured", "address", "latitude", "longitude", "delivery_radius_km",
    "min_order_amount", "rating",
)
# Fields any visitor may see on a shop. The rest of the row (owner_name, email,
# telegram_token, telegram_group_id, plan, logo_update_history) is admin-only.
# phone stays public: the shop page shows it as the shop's contact number.
PUBLIC_FIELDS = (
    "id", "name", "slug", "tagline", "description", "icon_emoji", "accent_color", "logo_url",
    "is_featured", "status", "phone", "fb_page", "instagram", "deep_link_code", "created_at",
    "address", "latitude", "longitude", "delivery_radius_km", "rating",
    *DELIVERY_SETTING_FIELDS,
)
# ~1° of latitude in km; used to turn the search radius into a bounding box
KM_PER_DEGREE = 111.0


def public_view(merchant: dict) -> dict:
    return {k: merchant[k] for k in PUBLIC_FIELDS if k in merchant}


def sees_private_fields(user: TokenClaims | None, merchant_id: int) -> bool:
    """Super admin sees every shop's full row; a merchant admin only their own."""
    if not user:
        return False
    return user.is_super_admin or (user.role == Role.MERCHANT_ADMIN and user.merchant_id == merchant_id)


# Logo update policy for merchant_admin role: max N updates per rolling window
LOGO_UPDATE_MAX_PER_WINDOW = 2
LOGO_UPDATE_WINDOW = timedelta(days=7)
ALLOWED_LOGO_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MAX_LOGO_BYTES = 2 * 1024 * 1024  # 2 MB

# Hero carousel limits
MAX_HERO_IMAGES_ACTIVE = 6
MAX_HERO_BYTES = 4 * 1024 * 1024  # 4 MB
ALLOWED_HERO_MIME = ALLOWED_LOGO_MIME


@router.get("")
async def list_merchants(
    status: str | None = None,
    search: str | None = None,
    user: TokenClaims | None = Depends(get_optional_user),
):
    """List merchants. Public for active merchants, admin sees all."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("merchants").order("created_at", desc=True)

        is_admin = user and user.is_admin
        if not is_admin:
            q = q.eq("status", "active")
        elif status:
            q = q.eq("status", status)

        if search:
            q = q.ilike("name", f"*{search}*")

        merchants = await q.select()

        # Enrich with counts
        for m in merchants:
            products = await db.from_("products").eq("merchant_id", m["id"]).eq("is_active", True).select("id")
            m["product_count"] = len(products)
            orders = await db.from_("orders").eq("merchant_id", m["id"]).select("id")
            m["order_count"] = len(orders)

    return [
        m if sees_private_fields(user, m["id"])
        else {**public_view(m), "product_count": m["product_count"], "order_count": m["order_count"]}
        for m in merchants
    ]


@router.get("/nearby")
async def nearby_merchants(
    lat: float,
    lng: float,
    radius_km: float = 10,
    limit: int = 20,
    offset: int = 0,
):
    """Active shops with a map location near (lat, lng), best first.

    Everything the card shows is computed here — never by the client:
    `distance_m`/`distance_km`, `delivery_fee`, `eta_minutes`..`eta_max_minutes`,
    `is_open` and `can_deliver`. Order: open shops nearest-first, then closed
    shops (also nearest-first). A shop past its own delivery radius is still
    listed (`can_deliver: false`) so the customer can pick up instead.
    """
    if not valid_point(lat, lng):
        raise BadRequestError("Invalid location")
    radius_km = max(0.5, min(radius_km, 25))
    limit, offset = max(1, min(limit, 50)), max(0, offset)

    # Cheap bounding-box prefilter in the database (uses idx_merchants_location),
    # then exact great-circle distances on the few rows that remain.
    dlat = radius_km / KM_PER_DEGREE
    dlng = radius_km / (KM_PER_DEGREE * max(math.cos(math.radians(lat)), 0.01))
    async with SupabaseClient.service_role() as db:
        rows = await (
            db.from_("merchants").eq("status", "active")
            .gte("latitude", lat - dlat).lte("latitude", lat + dlat)
            .gte("longitude", lng - dlng).lte("longitude", lng + dlng)
            .select()
        )

    now = datetime.now(SHOP_TZ)
    shops = []
    for m in rows:
        q = quote_delivery(m, (lat, lng))
        if q is None or float(q.distance_km) > radius_km:
            continue
        shop = {k: m.get(k) for k in NEARBY_PUBLIC_FIELDS if k in m}
        shop.update({
            "distance_km": float(q.distance_km),
            "distance_m": q.distance_m,
            "can_deliver": q.can_deliver,
            "delivery_fee": str(q.fee) if q.fee is not None else None,
            "delivery_unavailable_reason": q.reason,
            "eta_minutes": q.eta_minutes,
            "eta_max_minutes": q.eta_max_minutes,
            "is_open": is_open(m.get("opening_hours"), now),
        })
        shops.append(shop)

    shops.sort(key=lambda s: (not s["is_open"], s["distance_m"]))
    return shops[offset: offset + limit]


@router.get("/{merchant_id}")
async def get_merchant(merchant_id: int, user: TokenClaims | None = Depends(get_optional_user)):
    """Get merchant details. Public visitors see active shops and public fields only."""
    async with SupabaseClient.service_role() as db:
        merchant = await db.from_("merchants").eq("id", merchant_id).select_one()
        if not merchant or (not (user and user.is_admin) and merchant.get("status") != "active"):
            raise NotFoundError("Merchant", merchant_id)
        if not sees_private_fields(user, merchant_id):
            merchant = public_view(merchant)
        products = await db.from_("products").eq("merchant_id", merchant_id).eq("is_active", True).select("id")
        merchant["product_count"] = len(products)
        orders = await db.from_("orders").eq("merchant_id", merchant_id).select("id")
        merchant["order_count"] = len(orders)
    return merchant


@router.post("")
async def create_merchant(body: MerchantCreate, user: TokenClaims = require_role(Role.SUPER_ADMIN)):
    """Create a new merchant (super_admin only)."""
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("merchants").eq("slug", body.slug).select_one("id")
        if existing:
            raise ConflictError(f"Merchant slug '{body.slug}' already exists")

        data = body.model_dump()
        # Columns from migrations 016/017 — don't send them unless set
        for k in ("address", "latitude", "longitude", "delivery_radius_km", *DELIVERY_SETTING_FIELDS):
            if data.get(k) is None:
                data.pop(k, None)
        data["status"] = "active"
        rows = await db.from_("merchants").insert(data)
    return rows[0] if rows else data


@router.patch("/{merchant_id}")
async def update_merchant(
    merchant_id: int,
    body: MerchantUpdate,
    user: TokenClaims = require_any_admin(),
):
    """Update a merchant."""
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("merchants").eq("id", merchant_id).select_one("id")
        if not existing:
            raise NotFoundError("Merchant", merchant_id)

        if user.role == Role.MERCHANT_ADMIN and user.merchant_id != merchant_id:
            raise ForbiddenError("You can only update your own merchant")

        data = body.model_dump(exclude_none=True)
        # Delivery settings can be cleared back to "platform default" by sending null
        for k in DELIVERY_SETTING_FIELDS:
            if k in body.model_fields_set:
                data[k] = getattr(body, k)
        # Merchant admins must use the rate-limited logo upload endpoint
        if user.role == Role.MERCHANT_ADMIN:
            data.pop("logo_url", None)
            data.pop("status", None)
            data.pop("is_featured", None)  # super-admin-only flag
        if data:
            await db.from_("merchants").eq("id", merchant_id).update(data)
    return {"success": True}


@router.delete("/{merchant_id}")
async def delete_merchant(merchant_id: int, user: TokenClaims = require_role(Role.SUPER_ADMIN)):
    """Suspend a merchant (super_admin only). Does not hard-delete."""
    async with SupabaseClient.service_role() as db:
        await db.from_("merchants").eq("id", merchant_id).update({"status": "suspended"})
    return {"success": True}


# ═══════════════════════════════════════════════════════════════
#  LOGO UPLOAD (rate-limited for merchant_admin)
# ═══════════════════════════════════════════════════════════════


@router.post("/{merchant_id}/logo")
async def upload_merchant_logo(
    merchant_id: int,
    file: UploadFile = File(...),
    user: TokenClaims = require_any_admin(),
):
    """Upload a merchant logo.

    Super admin: unlimited.
    Merchant admin: max LOGO_UPDATE_MAX_PER_WINDOW per LOGO_UPDATE_WINDOW (rolling),
    and only for their own merchant.
    """
    if user.role == Role.MERCHANT_ADMIN and user.merchant_id != merchant_id:
        raise ForbiddenError("You can only update your own merchant's logo")

    if file.content_type not in ALLOWED_LOGO_MIME:
        raise BadRequestError("Logo must be PNG, JPEG, WebP, or GIF")

    content = await file.read()
    if len(content) > MAX_LOGO_BYTES:
        raise BadRequestError(f"Logo file too large (max {MAX_LOGO_BYTES // 1024 // 1024} MB)")
    if not content:
        raise BadRequestError("Empty file")

    async with SupabaseClient.service_role() as db:
        merchant = await (
            db.from_("merchants")
            .eq("id", merchant_id)
            .select_one("id,logo_update_history")
        )
        if not merchant:
            raise NotFoundError("Merchant", merchant_id)

        # Enforce rate limit for merchant_admin only
        history: list[str] = merchant.get("logo_update_history") or []
        if user.role == Role.MERCHANT_ADMIN:
            now = datetime.now(timezone.utc)
            window_start = now - LOGO_UPDATE_WINDOW
            recent: list[str] = []
            for ts in history:
                try:
                    dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                    if dt >= window_start:
                        recent.append(dt.isoformat())
                except (TypeError, ValueError):
                    continue
            if len(recent) >= LOGO_UPDATE_MAX_PER_WINDOW:
                raise RateLimitError(
                    f"Logo can only be updated {LOGO_UPDATE_MAX_PER_WINDOW} times per "
                    f"{LOGO_UPDATE_WINDOW.days} days"
                )
            new_history = recent + [now.isoformat()]
        else:
            new_history = history  # super admin updates do not consume the quota

        # Upload to storage
        ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "png").lower()
        if ext not in {"png", "jpg", "jpeg", "webp", "gif"}:
            ext = "png"
        path = f"merchant-logos/{merchant_id}/{int(time.time() * 1000)}.{ext}"
        storage = StorageClient()
        public_url = await storage.upload(
            bucket="product-images",
            path=path,
            content=content,
            content_type=file.content_type or "image/png",
        )

        await db.from_("merchants").eq("id", merchant_id).update({
            "logo_url": public_url,
            "logo_update_history": new_history,
        })

    return {"logo_url": public_url}


# ═══════════════════════════════════════════════════════════════
#  HERO CAROUSEL IMAGES
# ═══════════════════════════════════════════════════════════════


def _check_hero_access(user: TokenClaims, merchant_id: int) -> None:
    """Merchant admins can only manage their own merchant's hero images."""
    if user.role == Role.MERCHANT_ADMIN and user.merchant_id != merchant_id:
        raise ForbiddenError("You can only manage your own merchant's hero images")


@router.get("/{merchant_id}/hero-images")
async def list_hero_images(merchant_id: int):
    """Public — list active hero images for a merchant in display order."""
    async with SupabaseClient.service_role() as db:
        rows = await (
            db.from_("merchant_hero_images")
            .eq("merchant_id", merchant_id)
            .eq("is_active", True)
            .order("sort_order")
            .select("id,merchant_id,url,sort_order,is_active,created_at")
        )
    return rows


@router.get("/{merchant_id}/hero-images/all")
async def list_all_hero_images(
    merchant_id: int,
    user: TokenClaims = require_any_admin(),
):
    """Admin — list ALL hero images (active + inactive) for management UI."""
    _check_hero_access(user, merchant_id)
    async with SupabaseClient.service_role() as db:
        rows = await (
            db.from_("merchant_hero_images")
            .eq("merchant_id", merchant_id)
            .order("sort_order")
            .select("id,merchant_id,url,sort_order,is_active,created_at")
        )
    return rows


@router.post("/{merchant_id}/hero-images")
async def upload_hero_image(
    merchant_id: int,
    file: UploadFile = File(...),
    user: TokenClaims = require_any_admin(),
):
    """Upload a new hero image. Caps at MAX_HERO_IMAGES_ACTIVE active images."""
    _check_hero_access(user, merchant_id)

    if file.content_type not in ALLOWED_HERO_MIME:
        raise BadRequestError("Image must be PNG, JPEG, WebP, or GIF")

    content = await file.read()
    if len(content) > MAX_HERO_BYTES:
        raise BadRequestError(f"Image too large (max {MAX_HERO_BYTES // 1024 // 1024} MB)")
    if not content:
        raise BadRequestError("Empty file")

    async with SupabaseClient.service_role() as db:
        # Verify merchant exists
        m = await db.from_("merchants").eq("id", merchant_id).select_one("id")
        if not m:
            raise NotFoundError("Merchant", merchant_id)

        # Cap active hero images
        active = await (
            db.from_("merchant_hero_images")
            .eq("merchant_id", merchant_id)
            .eq("is_active", True)
            .select("id")
        )
        if len(active) >= MAX_HERO_IMAGES_ACTIVE:
            raise BadRequestError(
                f"Maximum {MAX_HERO_IMAGES_ACTIVE} active hero images. Delete or hide one first."
            )

        # Upload to storage
        ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "png").lower()
        if ext not in {"png", "jpg", "jpeg", "webp", "gif"}:
            ext = "png"
        path = f"merchant-hero/{merchant_id}/{int(time.time() * 1000)}.{ext}"
        storage = StorageClient()
        public_url = await storage.upload(
            bucket="product-images",
            path=path,
            content=content,
            content_type=file.content_type or "image/png",
        )

        # Determine sort_order — append to the end
        last = await (
            db.from_("merchant_hero_images")
            .eq("merchant_id", merchant_id)
            .order("sort_order", desc=True)
            .select_one("sort_order")
        )
        next_order = (last["sort_order"] + 1) if last else 0

        rows = await db.from_("merchant_hero_images").insert({
            "merchant_id": merchant_id,
            "url": public_url,
            "sort_order": next_order,
            "is_active": True,
        })

    return rows[0] if rows else {"url": public_url}


@router.patch("/{merchant_id}/hero-images/{image_id}")
async def update_hero_image(
    merchant_id: int,
    image_id: int,
    body: dict,
    user: TokenClaims = require_any_admin(),
):
    """Update sort_order or is_active for a hero image."""
    _check_hero_access(user, merchant_id)

    data: dict = {}
    if "sort_order" in body and isinstance(body["sort_order"], int):
        data["sort_order"] = body["sort_order"]
    if "is_active" in body and isinstance(body["is_active"], bool):
        data["is_active"] = body["is_active"]
    if not data:
        raise BadRequestError("Provide sort_order or is_active")

    async with SupabaseClient.service_role() as db:
        # Verify the image belongs to this merchant
        existing = await (
            db.from_("merchant_hero_images")
            .eq("id", image_id)
            .eq("merchant_id", merchant_id)
            .select_one("id")
        )
        if not existing:
            raise NotFoundError("Hero image", image_id)

        # If activating, enforce the cap
        if data.get("is_active") is True:
            active = await (
                db.from_("merchant_hero_images")
                .eq("merchant_id", merchant_id)
                .eq("is_active", True)
                .neq("id", image_id)
                .select("id")
            )
            if len(active) >= MAX_HERO_IMAGES_ACTIVE:
                raise BadRequestError(
                    f"Maximum {MAX_HERO_IMAGES_ACTIVE} active hero images."
                )

        await db.from_("merchant_hero_images").eq("id", image_id).update(data)
    return {"success": True}


@router.delete("/{merchant_id}/hero-images/{image_id}")
async def delete_hero_image(
    merchant_id: int,
    image_id: int,
    user: TokenClaims = require_any_admin(),
):
    """Permanently delete a hero image row (storage object stays for now)."""
    _check_hero_access(user, merchant_id)
    async with SupabaseClient.service_role() as db:
        existing = await (
            db.from_("merchant_hero_images")
            .eq("id", image_id)
            .eq("merchant_id", merchant_id)
            .select_one("id")
        )
        if not existing:
            raise NotFoundError("Hero image", image_id)
        await db.from_("merchant_hero_images").eq("id", image_id).delete()
    return {"success": True}
