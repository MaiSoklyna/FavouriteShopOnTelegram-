"""Merchant management routes.

Public: browse merchants.
Admin: CRUD operations (super_admin for all, merchant_admin for own).
"""

from __future__ import annotations

import asyncio

import math
import re
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, UploadFile

from app.core.constants import DEFAULT_DELIVERY_RADIUS_KM, MAX_DELIVERY_KM, PLATFORM_FEE_MAX_KM, Role
from app.core.dependencies import get_optional_user, require_any_admin, require_role, require_shop_owner
from app.core.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError, RateLimitError
from app.core.security import TokenClaims
from app.db.client import StorageClient, SupabaseClient
from app.models.merchant import MerchantCreate, MerchantUpdate
from app.services import audit, shop_setup
from app.services.delivery import SHOP_TZ, is_open, quote_delivery, valid_point

router = APIRouter(prefix="/merchants", tags=["Merchants"])

# Per-shop delivery settings (migration 017); null means "use the platform default"
DELIVERY_SETTING_FIELDS = ("opening_hours", "delivery_base_fee", "delivery_per_km_fee", "min_order_amount", "delivery_fee_mode")

# Fields the public "nearby" list may expose — merchants rows also hold owner contact details
NEARBY_PUBLIC_FIELDS = (
    "id", "name", "slug", "tagline", "icon_emoji", "accent_color", "logo_url",
    "is_featured", "address", "latitude", "longitude", "delivery_radius_km",
    "min_order_amount", "rating", "rating_count", "shop_category_id", "shop_subcategory_id",
)
# Fields any visitor may see on a shop (an allow-list: new columns stay private by default).
# Everything else is owner/super-admin only: owner_name, email, phone, telegram_token,
# telegram_group_id, plan, logo_update_history, the ABA payout account and its verification,
# commission_rate, loyalty_enabled. phone is the owner's number from registration; no
# customer page shows it (drivers get it through their own authenticated job endpoint).
PUBLIC_FIELDS = (
    "id", "name", "slug", "tagline", "description", "icon_emoji", "accent_color", "logo_url",
    "is_featured", "status", "fb_page", "instagram", "deep_link_code", "created_at",
    "address", "latitude", "longitude", "delivery_radius_km", "rating", "rating_count",
    "shop_category_id", "shop_subcategory_id",
    *DELIVERY_SETTING_FIELDS,
)
# ~1° of latitude in km; used to turn the search radius into a bounding box
KM_PER_DEGREE = 111.0


def public_view(merchant: dict) -> dict:
    return {k: merchant[k] for k in PUBLIC_FIELDS if k in merchant}


async def shop_category_names(db) -> tuple[dict[int, str], dict[int, str]]:
    """id -> name for shop categories and subcategories (two tiny tables, read once per request)."""
    cats, subs = await asyncio.gather(
        db.from_("shop_categories").select("id,name"),
        db.from_("shop_subcategories").select("id,name"),
    )
    return {c["id"]: c["name"] for c in cats}, {s["id"]: s["name"] for s in subs}


def with_category_names(shop: dict, cats: dict[int, str], subs: dict[int, str]) -> dict:
    """Add the readable `shop_category` / `shop_subcategory` next to the ids (null = not categorised yet)."""
    shop["shop_category"] = cats.get(shop.get("shop_category_id"))
    shop["shop_subcategory"] = subs.get(shop.get("shop_subcategory_id"))
    return shop


async def validate_shop_category(db, category_id: int | None, subcategory_id: int | None) -> None:
    """A shop's subcategory must belong to its category, and neither may be made up."""
    if subcategory_id is not None and category_id is None:
        raise BadRequestError("Choose a shop category before a subcategory")
    if category_id is not None:
        if not await db.from_("shop_categories").eq("id", category_id).select_one("id"):
            raise BadRequestError("Unknown shop category")
    if subcategory_id is not None:
        sub = await db.from_("shop_subcategories").eq("id", subcategory_id).select_one("id,category_id")
        if not sub or sub["category_id"] != category_id:
            raise BadRequestError("That subcategory does not belong to the chosen category")


def sees_private_fields(user: TokenClaims | None, merchant_id: int) -> bool:
    """Super admin sees every shop's full row; a shop owner only their own. Staff get the public view."""
    if not user:
        return False
    if user.is_super_admin:
        return True
    return user.role == Role.MERCHANT_ADMIN and not user.is_shop_staff and user.merchant_id == merchant_id


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
    shop_category_id: int | None = None,
    shop_subcategory_id: int | None = None,
    user: TokenClaims | None = Depends(get_optional_user),
):
    """List merchants. Public for active merchants, admin sees all.

    `shop_category_id` / `shop_subcategory_id` narrow the list to one kind of shop.
    """
    async with SupabaseClient.service_role() as db:
        q = db.from_("merchants").order("created_at", desc=True)

        is_admin = user and user.is_admin
        if not is_admin:
            q = q.eq("status", "active")
        elif status:
            q = q.eq("status", status)

        if search:
            q = q.ilike("name", f"*{search}*")
        if shop_category_id is not None:
            q = q.eq("shop_category_id", shop_category_id)
        if shop_subcategory_id is not None:
            q = q.eq("shop_subcategory_id", shop_subcategory_id)

        merchants = await q.select()
        if not is_admin:  # customers only see shops that finished setting up
            merchants = [m for m in merchants if shop_setup.is_visible(m)]

        ids = [m["id"] for m in merchants]

        async def rows(table: str, columns: str, **eq) -> list[dict]:
            if not ids:
                return []
            q = db.from_(table).in_("merchant_id", ids)
            for col, val in eq.items():
                q = q.eq(col, val)
            return await q.select(columns)

        # Three requests for the whole list, whatever the number of shops
        (cats, subs), products, orders = await asyncio.gather(
            shop_category_names(db),
            rows("products", "merchant_id,rating_avg,review_count", is_active=True),
            rows("orders", "merchant_id"),
        )
        for m in merchants:
            m.update(shop_stats(m["id"], products, orders))

    return [
        with_category_names(
            m if sees_private_fields(user, m["id"]) else {**public_view(m), **{k: m[k] for k in STAT_FIELDS}},
            cats, subs,
        )
        for m in merchants
    ]


STAT_FIELDS = ("product_count", "order_count", "product_rating", "product_review_count")


def shop_stats(merchant_id: int, products: list[dict], orders: list[dict]) -> dict:
    """Counts for a shop card, and the average of its products' reviews. Shop cards show the shop's own
    rating once it has shop reviews and this product average until then, so they no longer need to
    download every shop's products to work it out."""
    mine = [p for p in products if p.get("merchant_id") == merchant_id]
    total, reviews = 0.0, 0
    for p in mine:
        n = int(p.get("review_count") or 0)
        if n > 0:
            total += float(p.get("rating_avg") or 0) * n
            reviews += n
    return {
        "product_count": len(mine),
        "order_count": sum(1 for o in orders if o.get("merchant_id") == merchant_id),
        "product_rating": round(total / reviews, 2) if reviews else None,
        "product_review_count": reviews,
    }


@router.get("/nearby")
async def nearby_merchants(
    lat: float,
    lng: float,
    radius_km: float = 10,
    limit: int = 20,
    offset: int = 0,
    shop_category_id: int | None = None,
    shop_subcategory_id: int | None = None,
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
    radius_km = max(0.5, min(radius_km, MAX_DELIVERY_KM))
    limit, offset = max(1, min(limit, 50)), max(0, offset)

    # Cheap bounding-box prefilter in the database (uses idx_merchants_location),
    # then exact great-circle distances on the few rows that remain.
    dlat = radius_km / KM_PER_DEGREE
    dlng = radius_km / (KM_PER_DEGREE * max(math.cos(math.radians(lat)), 0.01))
    async with SupabaseClient.service_role() as db:
        query = (
            db.from_("merchants").eq("status", "active")
            .gte("latitude", lat - dlat).lte("latitude", lat + dlat)
            .gte("longitude", lng - dlng).lte("longitude", lng + dlng)
        )
        if shop_category_id is not None:
            query = query.eq("shop_category_id", shop_category_id)
        if shop_subcategory_id is not None:
            query = query.eq("shop_subcategory_id", shop_subcategory_id)
        rows = [m for m in await query.select() if shop_setup.is_visible(m)]
        ids = [m["id"] for m in rows]
        (cats, subs), products = await asyncio.gather(
            shop_category_names(db),
            db.from_("products").in_("merchant_id", ids).eq("is_active", True).select("merchant_id,rating_avg,review_count")
            if ids else asyncio.sleep(0, result=[]),
        )

    now = datetime.now(SHOP_TZ)
    shops = []
    for m in rows:
        q = quote_delivery(m, (lat, lng))
        if q is None or float(q.distance_km) > radius_km:
            continue
        shop = with_category_names({k: m.get(k) for k in NEARBY_PUBLIC_FIELDS if k in m}, cats, subs)
        stats = shop_stats(m["id"], products, [])
        shop.update({
            "product_rating": stats["product_rating"],
            "product_review_count": stats["product_review_count"],
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


@router.get("/{merchant_id}/delivery-check")
async def delivery_check(merchant_id: int, lat: float, lng: float,
                         user: TokenClaims | None = Depends(get_optional_user)):
    """Can this shop deliver to (lat, lng)? For the shop and product pages, at any distance.

    The nearby search only lists shops within the search radius, so a customer further away would get no
    answer there; this checks one shop directly. Customers outside the area can still browse and order
    for pickup; only delivery is refused (at checkout)."""
    if not valid_point(lat, lng):
        raise BadRequestError("Invalid location")
    async with SupabaseClient.service_role() as db:
        m = await db.from_("merchants").eq("id", merchant_id).select_one()
    if not m or (not (user and user.is_admin) and not shop_setup.is_visible(m)):
        raise NotFoundError("Merchant", merchant_id)
    radius = float(m.get("delivery_radius_km") or DEFAULT_DELIVERY_RADIUS_KM)
    q = quote_delivery(m, (lat, lng))
    if q is None:   # the shop has no map location yet
        return {"located": False, "can_deliver": False, "pickup": True, "radius_km": radius,
                "reason": "This shop hasn't set its location yet", "is_open": is_open(m.get("opening_hours"))}
    return {
        "located": True,
        "distance_km": float(q.distance_km),
        "radius_km": radius,
        "can_deliver": q.can_deliver,
        "delivery_fee": str(q.fee) if q.fee is not None else None,
        "reason": q.reason,
        "eta_minutes": q.eta_minutes,
        "eta_max_minutes": q.eta_max_minutes,
        "is_open": is_open(m.get("opening_hours")),
        "pickup": True,   # every shop takes pickup orders
    }


@router.get("/{merchant_id}")
async def get_merchant(merchant_id: int, user: TokenClaims | None = Depends(get_optional_user)):
    """Get merchant details. Public visitors see active shops and public fields only."""
    async with SupabaseClient.service_role() as db:
        merchant = await db.from_("merchants").eq("id", merchant_id).select_one()
        if not merchant or (not (user and user.is_admin) and not shop_setup.is_visible(merchant)):
            raise NotFoundError("Merchant", merchant_id)
        if not sees_private_fields(user, merchant_id):
            merchant = public_view(merchant)
        with_category_names(merchant, *await shop_category_names(db))
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

        await validate_shop_category(db, body.shop_category_id, body.shop_subcategory_id)
        data = body.model_dump()
        # Columns from migrations 016/017/024 — don't send them unless set
        for k in ("address", "latitude", "longitude", "delivery_radius_km", "shop_category_id",
                  "shop_subcategory_id", *DELIVERY_SETTING_FIELDS):
            if data.get(k) is None:
                data.pop(k, None)
        data["status"] = "active"
        rows = await db.from_("merchants").insert(data)
    return rows[0] if rows else data


@router.patch("/{merchant_id}")
async def update_merchant(
    merchant_id: int,
    body: MerchantUpdate,
    user: TokenClaims = require_shop_owner(),
):
    """Update a merchant (super admin, or the shop's owner: staff cannot change shop settings)."""
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("merchants").eq("id", merchant_id).select_one()
        if not existing:
            raise NotFoundError("Merchant", merchant_id)

        if user.role == Role.MERCHANT_ADMIN and user.merchant_id != merchant_id:
            raise ForbiddenError("You can only update your own merchant")

        data = body.model_dump(exclude_none=True)
        data.pop("shop_category_id", None)
        data.pop("shop_subcategory_id", None)
        # The shop's category decides where customers find it: the platform sets it, and the owner may
        # choose it while setting up, before the shop is live (decision 2026-11-25).
        # Sending null clears it; changing the category without a subcategory clears the subcategory.
        owner_may_choose = user.role == Role.MERCHANT_ADMIN and existing.get("setup_completed_at") is None             and "setup_completed_at" in existing
        # Otherwise a type sent by the owner is ignored (forms send it back unchanged), as before.
        if (user.role == Role.SUPER_ADMIN or owner_may_choose) and {"shop_category_id", "shop_subcategory_id"} & body.model_fields_set:
            category = body.shop_category_id if "shop_category_id" in body.model_fields_set else existing.get("shop_category_id")
            if "shop_subcategory_id" in body.model_fields_set:
                subcategory = body.shop_subcategory_id
            elif category == existing.get("shop_category_id"):
                subcategory = existing.get("shop_subcategory_id")
            else:
                subcategory = None
            await validate_shop_category(db, category, subcategory)
            data["shop_category_id"], data["shop_subcategory_id"] = category, subcategory
        # Delivery settings can be cleared back to "platform default" by sending null
        for k in DELIVERY_SETTING_FIELDS:
            if k in body.model_fields_set:
                data[k] = getattr(body, k)
        # Merchant admins must use the rate-limited logo upload endpoint
        if user.role == Role.MERCHANT_ADMIN:
            data.pop("logo_url", None)
            data.pop("status", None)
            data.pop("is_featured", None)  # super-admin-only flag
        if "opening_hours" in data and data["opening_hours"] is not None:
            _check_hours(data["opening_hours"])
        _check_long_distance(existing, data)
        if data:
            await db.from_("merchants").eq("id", merchant_id).update(data)
            await _log_shop_change(db, user, existing, data)
        await shop_setup.refresh(db, merchant_id)
    return {"success": True}


def _check_long_distance(existing: dict, data: dict) -> None:
    """Platform standard fees stop at 10 km: a radius beyond that needs the shop's own fees."""
    radius = data.get("delivery_radius_km", existing.get("delivery_radius_km"))
    mode = data.get("delivery_fee_mode", existing.get("delivery_fee_mode"))
    if radius is not None and float(radius) > PLATFORM_FEE_MAX_KM and mode == "platform":
        raise BadRequestError(f"Platform delivery fees only cover up to {PLATFORM_FEE_MAX_KM:g} km. "
                              f"To deliver further, choose your own delivery fees (base + per km).")


_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _check_hours(hours: dict) -> None:
    """Weekly hours: {"mon": [["08:00","20:00"]], ...}; 24/7 is every day ["00:00","00:00"]."""
    for day, windows in hours.items():
        if day not in shop_setup.DAYS:
            raise BadRequestError(f"Unknown day '{day}' in opening hours")
        for w in windows:
            if len(w) != 2 or not all(_HHMM.match(str(t)) for t in w):
                raise BadRequestError(f"Opening hours for {day} must be like 08:00-20:00")


SECRET_SHOP_FIELDS = {"telegram_token"}

# Which shop fields count as the public profile; everything else is a setting
SHOP_PROFILE_FIELDS = (
    "name", "owner_name", "email", "phone", "tagline", "description", "icon_emoji",
    "fb_page", "instagram", "logo_url", "address",
)


async def _log_shop_change(db, user: TokenClaims, before: dict, data: dict) -> None:
    old, new = audit.diff(before, data)
    if not new:
        return
    for secret in SECRET_SHOP_FIELDS & set(new):  # record that it changed, never the value
        old[secret], new[secret] = "(hidden)", "(changed)"
    label = (data.get("name") or before.get("name") or "").strip()
    profile = {k for k in new if k in SHOP_PROFILE_FIELDS}
    for action, keys in (("shop.profile_updated", profile), ("shop.settings_updated", set(new) - profile)):
        if keys:
            await audit.record(
                db, user, merchant_id=before["id"], action=action, target_type="shop",
                target_id=before["id"], target_label=label,
                old={k: old[k] for k in keys}, new={k: new[k] for k in keys},
            )


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
    user: TokenClaims = require_shop_owner(),
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
            .select_one("id,name,logo_url,logo_update_history")
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
        await audit.record(
            db, user, merchant_id=merchant_id, action="shop.profile_updated", target_type="shop",
            target_id=merchant_id, target_label=merchant.get("name"),
            old={"logo_url": merchant.get("logo_url")}, new={"logo_url": public_url},
        )
        await shop_setup.refresh(db, merchant_id)

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
    user: TokenClaims = require_shop_owner(),
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
        await audit.record(
            db, user, merchant_id=merchant_id, action="shop.settings_updated", target_type="shop",
            target_id=merchant_id, target_label="Hero image added", new={"hero_image": public_url},
        )

    return rows[0] if rows else {"url": public_url}


@router.patch("/{merchant_id}/hero-images/{image_id}")
async def update_hero_image(
    merchant_id: int,
    image_id: int,
    body: dict,
    user: TokenClaims = require_shop_owner(),
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
            .select_one("id,url,sort_order,is_active")
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
        old, new = audit.diff(existing, data)
        if new:
            await audit.record(
                db, user, merchant_id=merchant_id, action="shop.settings_updated", target_type="shop",
                target_id=merchant_id, target_label="Hero image changed",
                old={"hero_image": existing.get("url"), **old}, new={"hero_image": existing.get("url"), **new},
            )
    return {"success": True}


@router.delete("/{merchant_id}/hero-images/{image_id}")
async def delete_hero_image(
    merchant_id: int,
    image_id: int,
    user: TokenClaims = require_shop_owner(),
):
    """Permanently delete a hero image row (storage object stays for now)."""
    _check_hero_access(user, merchant_id)
    async with SupabaseClient.service_role() as db:
        existing = await (
            db.from_("merchant_hero_images")
            .eq("id", image_id)
            .eq("merchant_id", merchant_id)
            .select_one("id,url")
        )
        if not existing:
            raise NotFoundError("Hero image", image_id)
        await db.from_("merchant_hero_images").eq("id", image_id).delete()
        await audit.record(
            db, user, merchant_id=merchant_id, action="shop.settings_updated", target_type="shop",
            target_id=merchant_id, target_label="Hero image removed", old={"hero_image": existing.get("url")},
        )
    return {"success": True}
