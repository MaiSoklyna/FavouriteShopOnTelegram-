"""Product and category CRUD routes.

Public browsing (any authenticated user) + management (admin/super_admin).
Image upload uses StorageClient to push to Supabase Storage.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.core.constants import DEFAULT_PAGE_SIZE, Role
from app.core.dependencies import (
    get_current_user,
    get_optional_user,
    require_any_admin,
    require_role,
)
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import StorageClient, SupabaseClient
from app.models.product import (
    CategoryCreate,
    CategoryUpdate,
    ProductCreate,
    ProductUpdate,
    VariantGroupCreate,
)
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Products"])


# ═══════════════════════════════════════════════════════════════
#  PUBLIC PRODUCT BROWSING
# ═══════════════════════════════════════════════════════════════


@router.get("/products")
async def list_products(
    merchant_id: int | None = None,
    category_id: int | None = None,
    featured: bool | None = None,
    search: str | None = None,
    include_inactive: bool = False,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
    user: TokenClaims | None = Depends(get_optional_user),
):
    """Browse products.

    Scoping:
      - merchant_admin: ALWAYS scoped to their own merchant (client-passed
        merchant_id is ignored to prevent peeking at other shops).
      - super_admin: respects optional merchant_id filter.
      - public/anonymous: respects optional merchant_id filter; only active.
    """
    async with SupabaseClient.service_role() as db:
        q = db.from_("products").order("created_at", desc=True)

        # ── Scoping by caller role ──
        if user and user.role == Role.MERCHANT_ADMIN:
            # Force scope to caller's merchant; ignore client merchant_id
            q = q.eq("merchant_id", user.merchant_id or 0)
        elif merchant_id:
            q = q.eq("merchant_id", merchant_id)

        # ── Active filter ──
        # Public users always see only active. Admins can opt-in to inactive.
        is_admin = bool(user and user.is_admin)
        if not is_admin or not include_inactive:
            q = q.eq("is_active", True)

        if category_id:
            q = q.eq("category_id", category_id)
        if featured is True:
            q = q.eq("is_featured", True)
        if search:
            q = q.ilike("name", f"*{search}*")

        offset = (page - 1) * page_size
        q = q.offset(offset).limit(page_size)

        products = await q.select(
            "id,merchant_id,category_id,name,description,base_price,"
            "compare_price,stock,sku,icon_emoji,rating_avg,review_count,"
            "is_featured,is_active,primary_image,created_at"
        )

        # Enrich with shop (owner) and category names
        if products:
            merchant_ids = list({p["merchant_id"] for p in products if p.get("merchant_id")})
            m_map: dict[int, dict] = {}
            if merchant_ids:
                merchants = await db.from_("merchants").in_("id", merchant_ids).select(
                    "id,name,icon_emoji,logo_url,status"
                )
                m_map = {m["id"]: m for m in merchants}
            for p in products:
                m = m_map.get(p.get("merchant_id")) or {}
                p["merchant_name"] = m.get("name")
                p["merchant_icon"] = m.get("icon_emoji")
                p["merchant_logo_url"] = m.get("logo_url")
                p["merchant_status"] = m.get("status")

            category_ids = list({p["category_id"] for p in products if p.get("category_id")})
            c_map: dict[int, str] = {}
            if category_ids:
                cats = await db.from_("categories").in_("id", category_ids).select("id,name")
                c_map = {c["id"]: c["name"] for c in cats}
            for p in products:
                p["category_name"] = c_map.get(p.get("category_id"))

            # Images
            product_ids = [p["id"] for p in products]
            images = await db.from_("product_images").in_("product_id", product_ids).order("sort_order").select()
            img_map: dict[int, list] = {}
            for img in images:
                img_map.setdefault(img["product_id"], []).append(img)
            for p in products:
                p["images"] = img_map.get(p["id"], [])

            # Variant presence — lets listing cards send the shopper to the
            # detail page to pick size/color instead of quick-adding blindly.
            variant_rows = await (
                db.from_("product_variants").in_("product_id", product_ids).select("product_id")
            )
            with_variants = {v["product_id"] for v in variant_rows}
            for p in products:
                p["has_variants"] = p["id"] in with_variants

    return products


@router.get("/products/{product_id}")
async def get_product(product_id: int):
    """Get a single product with images and variants."""
    async with SupabaseClient.service_role() as db:
        product = await db.from_("products").eq("id", product_id).select_one()
        if not product:
            raise NotFoundError("Product", product_id)

        if product.get("merchant_id"):
            m = await db.from_("merchants").eq("id", product["merchant_id"]).select_one("name")
            product["merchant_name"] = m["name"] if m else None
        if product.get("category_id"):
            c = await db.from_("categories").eq("id", product["category_id"]).select_one("name")
            product["category_name"] = c["name"] if c else None

        images = await (
            db.from_("product_images")
            .eq("product_id", product_id)
            .order("sort_order")
            .select()
        )
        product["images"] = images

        variants = await (
            db.from_("product_variants")
            .eq("product_id", product_id)
            .order("sort_order")
            .select()
        )
        for v in variants:
            options = await (
                db.from_("product_variant_options")
                .eq("variant_id", v["id"])
                .order("sort_order")
                .select()
            )
            v["options"] = options
        product["variants"] = variants

    return product


# ═══════════════════════════════════════════════════════════════
#  ADMIN PRODUCT MANAGEMENT
# ═══════════════════════════════════════════════════════════════


@router.post("/products")
async def create_product(
    body: ProductCreate,
    user: TokenClaims = require_any_admin(),
):
    """Create a new product (admin only).

    merchant_admin: always created under their own shop (body.merchant_id is
    ignored). super_admin: must say which shop owns the product.
    """
    async with SupabaseClient.service_role() as db:
        if user.is_super_admin:
            merchant_id = body.merchant_id
            if not merchant_id:
                raise BadRequestError("Choose the shop this product belongs to")
            await _require_merchant(db, merchant_id)
        else:
            merchant_id = _own_merchant_id(user)
        await _check_category(db, body.category_id, merchant_id)

        data = body.model_dump(exclude={"variants", "slug"})
        data["merchant_id"] = merchant_id

        rows = await db.from_("products").insert(data)
        product = rows[0] if rows else data

        # Create variants if provided
        if body.variants:
            for vg in body.variants:
                vg_rows = await db.from_("product_variants").insert({
                    "product_id": product["id"],
                    "group_name": vg.group_name,
                    "type": vg.type,
                    "sort_order": vg.sort_order,
                })
                if vg_rows and vg.options:
                    variant_id = vg_rows[0]["id"]
                    for opt in vg.options:
                        await db.from_("product_variant_options").insert({
                            "variant_id": variant_id,
                            **opt.model_dump(),
                        })

    return product


@router.patch("/products/{product_id}")
async def update_product(
    product_id: int,
    body: ProductUpdate,
    user: TokenClaims = require_any_admin(),
):
    """Update a product (admin only). Only super_admin can move it to another shop."""
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("products").eq("id", product_id).select_one(
            "id,merchant_id,category_id"
        )
        if not existing:
            raise NotFoundError("Product", product_id)
        _check_merchant_ownership(user, existing["merchant_id"])

        data = body.model_dump(exclude_none=True)
        # Explicit category_id (including 0/null from the form) clears the category
        if "category_id" in body.model_fields_set:
            data["category_id"] = body.category_id

        new_merchant = data.get("merchant_id")
        if new_merchant is not None and new_merchant != existing["merchant_id"]:
            if not user.is_super_admin:
                raise ForbiddenError("Only a super admin can move a product to another shop")
            await _require_merchant(db, new_merchant)
        else:
            data.pop("merchant_id", None)
        owner = data.get("merchant_id", existing["merchant_id"])

        # Category must be global or belong to the (possibly new) owning shop
        if "category_id" in data:
            await _check_category(db, data["category_id"], owner)
        elif owner != existing["merchant_id"]:
            await _check_category(
                db, existing.get("category_id"), owner,
                hint="Pick a category that belongs to the new shop",
            )

        if data:
            await db.from_("products").eq("id", product_id).update(data)

    return {"success": True}


@router.delete("/products/{product_id}")
async def delete_product(
    product_id: int,
    user: TokenClaims = require_any_admin(),
):
    """Soft-delete a product by setting is_active=False."""
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("products").eq("id", product_id).select_one("id,merchant_id")
        if not existing:
            raise NotFoundError("Product", product_id)
        _check_merchant_ownership(user, existing["merchant_id"])

        await db.from_("products").eq("id", product_id).update({"is_active": False})
    return {"success": True}


class ReplaceVariantsRequest(BaseModel):
    variants: list[VariantGroupCreate]


@router.put("/products/{product_id}/variants")
async def replace_product_variants(
    product_id: int,
    body: ReplaceVariantsRequest,
    user: TokenClaims = require_any_admin(),
):
    """Replace ALL variant groups + options for a product.

    Used by the edit flow when a seller adds/removes sizes or colors. Wipes
    existing rows and re-inserts from `body.variants`. Pass an empty list to
    clear all variants.
    """
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("products").eq("id", product_id).select_one("id,merchant_id")
        if not existing:
            raise NotFoundError("Product", product_id)
        _check_merchant_ownership(user, existing["merchant_id"])

        # Delete existing variants and their options. Options have a FK on
        # variant_id, so delete them first by looking up the variant ids.
        old_variants = await (
            db.from_("product_variants").eq("product_id", product_id).select("id")
        )
        for v in old_variants:
            await db.from_("product_variant_options").eq("variant_id", v["id"]).delete()
        await db.from_("product_variants").eq("product_id", product_id).delete()

        # Insert fresh
        for vg in body.variants:
            vg_rows = await db.from_("product_variants").insert({
                "product_id": product_id,
                "group_name": vg.group_name,
                "type": vg.type,
                "sort_order": vg.sort_order,
            })
            if vg_rows and vg.options:
                variant_id = vg_rows[0]["id"]
                for opt in vg.options:
                    await db.from_("product_variant_options").insert({
                        "variant_id": variant_id,
                        **opt.model_dump(),
                    })

    return {"success": True, "groups": len(body.variants)}


# ═══════════════════════════════════════════════════════════════
#  IMAGE UPLOAD
# ═══════════════════════════════════════════════════════════════


@router.post("/products/{product_id}/images")
async def upload_product_image(
    product_id: int,
    file: UploadFile = File(...),
    is_primary: bool = Form(False),
    user: TokenClaims = require_any_admin(),
):
    """Upload a product image to Supabase Storage."""
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("products").eq("id", product_id).select_one("id,merchant_id")
        if not existing:
            raise NotFoundError("Product", product_id)
        _check_merchant_ownership(user, existing["merchant_id"])

        # Upload file
        ext = file.filename.rsplit(".", 1)[-1] if file.filename else "jpg"
        file_name = f"{product_id}/{int(time.time() * 1000)}.{ext}"
        content = await file.read()

        storage = StorageClient()
        public_url = await storage.upload(
            bucket="product-images",
            path=file_name,
            content=content,
            content_type=file.content_type or "application/octet-stream",
        )

        # Determine sort order
        last_img = await (
            db.from_("product_images")
            .eq("product_id", product_id)
            .order("sort_order", desc=True)
            .select_one("sort_order")
        )
        next_order = (last_img["sort_order"] + 1) if last_img else 0

        await db.from_("product_images").insert({
            "product_id": product_id,
            "url": public_url,
            "sort_order": next_order,
        })

        if is_primary:
            await db.from_("products").eq("id", product_id).update({"primary_image": public_url})

    return {"url": public_url}


@router.delete("/products/{product_id}/images/{image_id}")
async def delete_product_image(
    product_id: int,
    image_id: int,
    user: TokenClaims = require_any_admin(),
):
    """Delete a product image."""
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("products").eq("id", product_id).select_one("id,merchant_id")
        if not existing:
            raise NotFoundError("Product", product_id)
        _check_merchant_ownership(user, existing["merchant_id"])

        await db.from_("product_images").eq("id", image_id).delete()
    return {"success": True}


# ═══════════════════════════════════════════════════════════════
#  CATEGORIES
# ═══════════════════════════════════════════════════════════════


@router.get("/categories")
async def list_categories(
    merchant_id: int | None = None,
    user: TokenClaims | None = Depends(get_optional_user),
):
    """List categories. Enriched with active product_count.

    Scoping:
      - merchant_admin: sees super_admin's GLOBAL categories (merchant_id IS NULL)
        plus their own merchant's categories. Client-passed merchant_id is ignored.
      - super_admin: respects optional merchant_id filter; otherwise sees all.
      - public/anonymous: respects optional merchant_id filter (used by shop pages
        to load a specific merchant's categories alongside the globals).
    """
    async with SupabaseClient.service_role() as db:
        q = db.from_("categories").eq("is_active", True).order("sort_order")

        if user and user.role == Role.MERCHANT_ADMIN:
            own = user.merchant_id or 0
            # globals (merchant_id IS NULL) OR own merchant
            q = q.or_(f"merchant_id.is.null", f"merchant_id.eq.{own}")
        elif merchant_id:
            # Public viewing a merchant's storefront: include globals too
            q = q.or_(f"merchant_id.is.null", f"merchant_id.eq.{merchant_id}")
        # else super_admin / anonymous-with-no-filter: return everything

        categories = await q.select()

        # One query for all counts instead of one per category
        counts: dict[int, int] = {}
        cat_ids = [c["id"] for c in categories]
        if cat_ids:
            prods = await (
                db.from_("products")
                .in_("category_id", cat_ids)
                .eq("is_active", True)
                .select("category_id")
            )
            for p in prods:
                counts[p["category_id"]] = counts.get(p["category_id"], 0) + 1
        for c in categories:
            c["product_count"] = counts.get(c["id"], 0)

        merchant_ids = list({c["merchant_id"] for c in categories if c.get("merchant_id")})
        if merchant_ids:
            merch_rows = await db.from_("merchants").in_("id", merchant_ids).select("id,name")
            m_map = {m["id"]: m["name"] for m in merch_rows}
            for c in categories:
                c["merchant_name"] = m_map.get(c.get("merchant_id")) if c.get("merchant_id") else None
        else:
            for c in categories:
                c["merchant_name"] = None

        return categories


@router.post("/categories")
async def create_category(body: CategoryCreate, user: TokenClaims = require_any_admin()):
    """Create a category. super_admin → global (merchant_id NULL); merchant_admin → own."""
    async with SupabaseClient.service_role() as db:
        merchant_id = _resolve_merchant_id(user)
        data = body.model_dump()
        data["merchant_id"] = merchant_id
        rows = await db.from_("categories").insert(data)
    return rows[0] if rows else data


@router.patch("/categories/{category_id}")
async def update_category(
    category_id: int,
    body: CategoryUpdate,
    user: TokenClaims = require_any_admin(),
):
    """Update a category. merchant_admin can only edit their own."""
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("categories").eq("id", category_id).select_one("id,merchant_id")
        if not existing:
            raise NotFoundError("Category", category_id)
        if user.role == Role.MERCHANT_ADMIN:
            if existing.get("merchant_id") != user.merchant_id:
                raise ForbiddenError("You can only edit your own merchant's categories")

        data = body.model_dump(exclude_none=True)
        if data:
            await db.from_("categories").eq("id", category_id).update(data)
    return {"success": True}


@router.delete("/categories/{category_id}")
async def delete_category(category_id: int, user: TokenClaims = require_any_admin()):
    """Soft-delete a category. merchant_admin can only delete their own."""
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("categories").eq("id", category_id).select_one("id,merchant_id")
        if not existing:
            raise NotFoundError("Category", category_id)
        if user.role == Role.MERCHANT_ADMIN:
            if existing.get("merchant_id") != user.merchant_id:
                raise ForbiddenError("You can only delete your own merchant's categories")

        await db.from_("categories").eq("id", category_id).update({"is_active": False})
    return {"success": True}


@router.post("/categories/{category_id}/image")
async def upload_category_image(
    category_id: int,
    file: UploadFile = File(...),
    user: TokenClaims = require_any_admin(),
):
    """Upload a category image to Supabase Storage and store the URL."""
    allowed = {"image/png", "image/jpeg", "image/webp", "image/gif"}
    if file.content_type not in allowed:
        raise BadRequestError("Image must be PNG, JPEG, WebP, or GIF")

    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise BadRequestError("Image too large (max 2 MB)")

    ext = file.filename.rsplit(".", 1)[-1] if file.filename else "jpg"
    file_name = f"categories/{category_id}/{int(time.time() * 1000)}.{ext}"

    storage = StorageClient()
    public_url = await storage.upload(
        bucket="product-images",
        path=file_name,
        content=content,
        content_type=file.content_type or "application/octet-stream",
    )

    async with SupabaseClient.service_role() as db:
        await db.from_("categories").eq("id", category_id).update({"image_url": public_url})

    return {"url": public_url}


# ═══════════════════════════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════════════════════════


def _resolve_merchant_id(user: TokenClaims) -> int | None:
    """Get the merchant_id for the current admin, or None for super_admin."""
    if user.is_super_admin:
        return None  # Super admin can create for any merchant (set explicitly)
    return user.merchant_id


def _own_merchant_id(user: TokenClaims) -> int:
    """The shop a merchant_admin acts for; refuse tokens that carry none."""
    if not user.merchant_id:
        raise ForbiddenError("Your account is not linked to a shop")
    return user.merchant_id


def _check_merchant_ownership(user: TokenClaims, resource_merchant_id: int | None) -> None:
    """Ensure merchant admin can only modify their own merchant's resources."""
    if user.is_super_admin:
        return
    # A token without a merchant must never match an unowned row (None == None)
    if _own_merchant_id(user) != resource_merchant_id:
        raise ForbiddenError("You can only modify your own merchant's resources")


async def _require_merchant(db: SupabaseClient, merchant_id: int) -> None:
    if not await db.from_("merchants").eq("id", merchant_id).select_one("id"):
        raise BadRequestError("That shop does not exist")


async def _check_category(
    db: SupabaseClient,
    category_id: int | None,
    merchant_id: int | None,
    hint: str = "That category belongs to a different shop",
) -> None:
    """A product's category must be global (no merchant) or owned by the same shop."""
    if not category_id:
        return
    cat = await db.from_("categories").eq("id", category_id).select_one("id,merchant_id")
    if not cat:
        raise BadRequestError("That category does not exist")
    if cat.get("merchant_id") not in (None, merchant_id):
        raise BadRequestError(hint)


def _slugify(name: str) -> str:
    """Simple slug generation from a product name."""
    import re
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "product"
