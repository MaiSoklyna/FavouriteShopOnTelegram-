"""Product and category CRUD routes.

Public browsing (any authenticated user) + management (admin/super_admin).
Image upload uses StorageClient to push to Supabase Storage.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.core.constants import DEFAULT_PAGE_SIZE, Role
from app.core.dependencies import (
    get_current_user,
    get_optional_user,
    require_any_admin,
    require_role,
)
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.permissions import Perm, denied_message, role_can
from app.core.security import TokenClaims
from app.db.client import StorageClient, SupabaseClient
from app.models.product import (
    CategoryCreate,
    CategoryUpdate,
    ProductCreate,
    ProductUpdate,
    VariantGroupCreate,
)
from pydantic import BaseModel, Field

from app.services import attributes, audit, category_bulk, order_expiry, shop_setup

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
        # Stock held by abandoned unpaid orders goes back before it is shown (at most once a minute)
        await order_expiry.sweep_if_due(db)
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
        # Customers only see products of shops that are live (active and set up)
        if not is_admin:
            q = q.in_("merchant_id", sorted(await shop_setup.visible_shop_ids(db)) or [0])
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

        columns = ("id,merchant_id,category_id,name,description,base_price,"
                   "compare_price,stock,sku,icon_emoji,rating_avg,review_count,"
                   "is_featured,is_active,primary_image,created_at")
        try:
            # Product details (migration 036) let the dashboard show how complete each product is
            products = await q.select(columns + ",attribute_template_id,attributes")
        except httpx.HTTPStatusError as exc:
            if not attributes.missing(exc):
                raise
            products = await q.select(columns)

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
async def get_product(product_id: int, user: TokenClaims | None = Depends(get_optional_user)):
    """Get a single product with images and variants."""
    async with SupabaseClient.service_role() as db:
        await order_expiry.sweep_if_due(db)
        product = await db.from_("products").eq("id", product_id).select_one()
        if not product:
            raise NotFoundError("Product", product_id)
        if not (user and user.is_admin) and product.get("merchant_id") not in await shop_setup.visible_shop_ids(db):
            raise NotFoundError("Product", product_id)  # its shop is not live

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

        # Product details: the template's name and the filled fields as label / value rows
        template = (await attributes.load_template(db, product["attribute_template_id"])
                    if product.get("attribute_template_id") else None)
        product["attribute_template"] = {"id": template["id"], "name": template["name"]} if template else None
        product["attribute_details"] = attributes.details(template, product.get("attributes"))

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

        data = body.model_dump(exclude={"variants", "slug", "attribute_template_id", "attributes"})
        data["merchant_id"] = merchant_id
        template = None
        if body.attribute_template_id or body.attributes:
            if not body.attribute_template_id:
                raise BadRequestError("Choose what kind of product this is before filling its details")
            template = await _template_for_shop(db, body.attribute_template_id, merchant_id)
            data["attribute_template_id"] = template["id"]
            data["attributes"] = attributes.validate(template, body.attributes or {})

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

        new = {k: data.get(k) for k in PRODUCT_LOG_FIELDS if data.get(k) is not None}
        if body.variants:
            new["variants"] = _variant_summary(body.variants)
        if template:
            new["Details template"] = template["name"]
            new.update(attributes.label_changes(None, template, {}, data["attributes"])[1])
        await audit.record(
            db, user, merchant_id=merchant_id, action="product.created", target_type="product",
            target_id=product.get("id"), target_label=product.get("name") or body.name, new=new,
        )
        await shop_setup.refresh(db, merchant_id)

    return product


@router.patch("/products/{product_id}")
async def update_product(
    product_id: int,
    body: ProductUpdate,
    user: TokenClaims = require_any_admin(),
):
    """Update a product (admin only). Only super_admin can move it to another shop."""
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("products").eq("id", product_id).select_one()
        if not existing:
            raise NotFoundError("Product", product_id)
        _check_merchant_ownership(user, existing["merchant_id"])

        data = body.model_dump(exclude_none=True)
        # Explicit category_id (including 0/null from the form) clears the category
        if "category_id" in body.model_fields_set:
            data["category_id"] = body.category_id
        _check_price_permission(user, existing, data)

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

        # Product details: a new template, new values, or both
        data.pop("attribute_template_id", None)
        data.pop("attributes", None)
        details_log = None
        fields_set = body.model_fields_set
        if "attribute_template_id" in fields_set or "attributes" in fields_set:
            old_tid = existing.get("attribute_template_id")
            old_values = existing.get("attributes") or {}
            new_tid = body.attribute_template_id if "attribute_template_id" in fields_set else old_tid
            old_template = await attributes.load_template(db, old_tid) if old_tid else None
            if new_tid is None:
                if body.attributes:
                    raise BadRequestError("Choose what kind of product this is before filling its details")
                new_template, new_values = None, {}
            else:
                # Keeping the same template is always allowed, even if the platform has since switched it off
                new_template = (old_template if new_tid == old_tid and old_template
                                else await _template_for_shop(db, new_tid, owner))
                new_values = (attributes.validate(new_template, body.attributes)
                              if "attributes" in fields_set and body.attributes is not None
                              else attributes.carry_over(new_template, old_values))
            data["attribute_template_id"] = new_tid
            data["attributes"] = new_values
            details_log = (old_template, new_template, old_values, new_values)

        if data:
            await db.from_("products").eq("id", product_id).update(data)
            await _log_product_update(db, user, existing, data, details_log)
        if data.get("is_active"):
            await shop_setup.refresh(db, existing.get("merchant_id"))

    return {"success": True}


async def _template_for_shop(db, template_id: int, merchant_id: int) -> dict:
    """A template the shop may use: active and made for the shop's type (any type if the shop has none yet)."""
    template = await attributes.load_template(db, template_id)
    if template is None:
        try:
            await db.from_(attributes.TEMPLATES).select_one("id")
        except Exception as exc:
            if attributes.missing(exc):
                raise BadRequestError(attributes.MIGRATION_HINT) from exc
        raise BadRequestError("That kind of product does not exist")
    if not template.get("is_active"):
        raise BadRequestError(f"'{template['name']}' is no longer offered. Choose another kind of product.")
    shop = await db.from_("merchants").eq("id", merchant_id).select_one("id,shop_category_id")
    shop_type = (shop or {}).get("shop_category_id")
    if shop_type is not None and template["shop_category_id"] != shop_type:
        raise BadRequestError(f"'{template['name']}' is for another type of shop")
    return template


# Prices get their own entry so an owner can see every price change at a glance
PRICE_FIELDS = ("base_price", "compare_price")
PRODUCT_LOG_FIELDS = (
    "name", "description", "base_price", "compare_price", "stock", "sku", "category_id",
    "is_active", "is_featured", "icon_emoji", "primary_image",
)


async def _log_product_update(db, user: TokenClaims, before: dict, data: dict, details_log=None) -> None:
    data = {k: v for k, v in data.items() if k not in ("attributes", "attribute_template_id")}
    old, new = audit.diff(before, data)
    if details_log:
        old_t, new_t, old_v, new_v = details_log
        if (old_t or {}).get("id") != (new_t or {}).get("id"):
            old["Details template"], new["Details template"] = (old_t or {}).get("name"), (new_t or {}).get("name")
        o, n = attributes.label_changes(old_t, new_t, old_v, new_v)
        old.update(o)
        new.update(n)
    if not new:
        return
    common = dict(merchant_id=before["merchant_id"], target_type="product", target_id=before["id"],
                  target_label=data.get("name") or before.get("name"))
    price = [k for k in PRICE_FIELDS if k in new]
    rest = [k for k in new if k not in PRICE_FIELDS]
    if price:
        await audit.record(db, user, action="product.price_changed",
                           old={k: old[k] for k in price}, new={k: new[k] for k in price}, **common)
    if rest:
        await audit.record(db, user, action="product.updated",
                           old={k: old[k] for k in rest}, new={k: new[k] for k in rest}, **common)


def _variant_summary(groups) -> list[dict]:
    """Variants as an owner reads them: [{"group": "Size", "options": ["S", "M"]}]."""
    out = []
    for g in groups:
        out.append({"group": g.group_name, "options": [o.label for o in g.options]})
    return out


@router.delete("/products/{product_id}")
async def delete_product(
    product_id: int,
    user: TokenClaims = require_any_admin(),
):
    """Soft-delete a product by setting is_active=False."""
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("products").eq("id", product_id).select_one("id,merchant_id,name,base_price,stock,is_active")
        if not existing:
            raise NotFoundError("Product", product_id)
        _check_merchant_ownership(user, existing["merchant_id"])

        await db.from_("products").eq("id", product_id).update({"is_active": False})
        await audit.record(
            db, user, merchant_id=existing["merchant_id"], action="product.deleted", target_type="product",
            target_id=product_id, target_label=existing.get("name"),
            old={k: existing.get(k) for k in ("name", "base_price", "stock", "is_active")}, new={"is_active": False},
        )
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
        existing = await db.from_("products").eq("id", product_id).select_one("id,merchant_id,name")
        if not existing:
            raise NotFoundError("Product", product_id)
        _check_merchant_ownership(user, existing["merchant_id"])

        # Delete existing variants and their options. Options have a FK on
        # variant_id, so delete them first by looking up the variant ids.
        old_variants = await (
            db.from_("product_variants").eq("product_id", product_id).order("sort_order").select("id,group_name")
        )
        old_summary = []
        for v in old_variants:
            opts = await db.from_("product_variant_options").eq("variant_id", v["id"]).order("sort_order").select("label")
            old_summary.append({"group": v.get("group_name"), "options": [o.get("label") for o in opts]})
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

        new_summary = _variant_summary(body.variants)
        if old_summary != new_summary:
            await audit.record(
                db, user, merchant_id=existing["merchant_id"], action="product.variants_changed",
                target_type="product", target_id=product_id, target_label=existing.get("name"),
                old={"variants": old_summary}, new={"variants": new_summary},
            )

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
        existing = await db.from_("products").eq("id", product_id).select_one("id,merchant_id,name")
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

        await audit.record(
            db, user, merchant_id=existing["merchant_id"], action="product.image_added", target_type="product",
            target_id=product_id, target_label=existing.get("name"), new={"image": public_url, "primary": is_primary},
        )

    return {"url": public_url}


@router.delete("/products/{product_id}/images/{image_id}")
async def delete_product_image(
    product_id: int,
    image_id: int,
    user: TokenClaims = require_any_admin(),
):
    """Delete a product image."""
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("products").eq("id", product_id).select_one("id,merchant_id,name")
        if not existing:
            raise NotFoundError("Product", product_id)
        _check_merchant_ownership(user, existing["merchant_id"])

        # Only an image of this product: the shop check above was for this product
        image = await db.from_("product_images").eq("id", image_id).eq("product_id", product_id).select_one("id,url")
        if not image:
            raise NotFoundError("Image", image_id)
        await db.from_("product_images").eq("id", image_id).eq("product_id", product_id).delete()
        await audit.record(
            db, user, merchant_id=existing["merchant_id"], action="product.image_removed", target_type="product",
            target_id=product_id, target_label=existing.get("name"), old={"image": image.get("url")},
        )
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
        await shop_setup.refresh(db, merchant_id)
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
async def delete_category(category_id: int, move_to: str | None = None, user: TokenClaims = require_any_admin()):
    """Delete (hide) a category. merchant_admin can only delete their own.

    If it still holds products, `move_to` says where they go first: another category's id, or
    "none" for no category. Without it the request is refused (409) with the product count, so
    no product is left in a hidden category."""
    async with SupabaseClient.service_role() as db:
        result = await category_bulk.delete_with_move(db, user, category_id, move_to)
    return {"success": True, **result}


class MoveProductsBody(BaseModel):
    to_category_id: int | None = None  # None = no category


class BulkCategoryBody(BaseModel):
    product_ids: list[int] = Field(..., min_length=1, max_length=category_bulk.MAX_BULK)
    category_id: int | None = None  # None = no category


@router.post("/categories/{category_id}/move-products")
async def move_category_products(category_id: int, body: MoveProductsBody, user: TokenClaims = require_any_admin()):
    """Move every product in this category to another one (merge two categories, or empty one)."""
    async with SupabaseClient.service_role() as db:
        return {"success": True, **await category_bulk.move_all(db, user, category_id, body.to_category_id)}


@router.post("/products/bulk/category")
async def bulk_set_category(body: BulkCategoryBody, user: TokenClaims = require_any_admin()):
    """Put several products in one category at once."""
    async with SupabaseClient.service_role() as db:
        return {"success": True, **await category_bulk.set_category(db, user, body.product_ids, body.category_id)}


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


def _check_price_permission(user: TokenClaims, existing: dict, data: dict) -> None:
    """Changing an existing product's price needs the products.price permission (Owner/Manager)."""
    if user.role != Role.MERCHANT_ADMIN or role_can(user.shop_role, Perm.PRODUCTS_PRICE):
        return
    for field in PRICE_FIELDS:
        if field in data and not audit.same_value(existing.get(field), data[field]):
            raise ForbiddenError(denied_message(user.shop_role, Perm.PRODUCTS_PRICE))


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
