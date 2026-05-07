"""Shopping cart routes."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from app.core.constants import MAX_CART_ITEMS, Role
from app.core.dependencies import require_role
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.models.cart import CartItemAdd, CartItemUpdate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cart", tags=["Cart"])


@router.get("")
async def get_cart(user: TokenClaims = require_role(Role.USER)):
    """Get the current user's cart with items."""

    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)

        carts = await db.from_("cart").eq("user_id", db_user["id"]).select("id,merchant_id")
        if not carts:
            return {"items": [], "item_count": 0, "subtotal": 0}

        all_items = []
        for cart in carts:
            items = await (
                db.from_("cart_items")
                .eq("cart_id", cart["id"])
                .select("id,cart_id,product_id,quantity,selected_variants,unit_price")
            )
            # Enrich with product + merchant info
            for item in items:
                product = await db.from_("products").eq("id", item["product_id"]).select_one(
                    "name,icon_emoji,primary_image,merchant_id"
                )
                if product:
                    item["product_name"] = product.get("name")
                    item["icon_emoji"] = product.get("icon_emoji")
                    item["primary_image"] = product.get("primary_image")
                    item["merchant_id"] = product.get("merchant_id")
                    if product.get("merchant_id"):
                        m = await db.from_("merchants").eq("id", product["merchant_id"]).select_one("name")
                        item["merchant_name"] = m["name"] if m else None
                item["line_total"] = round(item.get("unit_price", 0) * item["quantity"], 2)
            all_items.extend(items)

        subtotal = sum(i.get("line_total", 0) for i in all_items)
        return {"items": all_items, "item_count": len(all_items), "subtotal": round(subtotal, 2)}


@router.post("/add")
async def add_to_cart(body: CartItemAdd, user: TokenClaims = require_role(Role.USER)):
    """Add a product to cart. Creates cart if needed.

    With variants:
      - Each option's `stock_adjust` (interpreted as per-option absolute stock)
        must be >= requested quantity.
      - Items with different variant selections are separate cart rows.
    """

    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)

        # Validate product
        product = await db.from_("products").eq("id", body.product_id).eq("is_active", True).select_one(
            "id,merchant_id,base_price,stock,name"
        )
        if not product:
            raise NotFoundError("Product", body.product_id)

        # ── Resolve variant options & validate stock + compute price ──
        unit_price = float(product["base_price"])
        variants_json = [v.model_dump() for v in body.selected_variants]
        for sv in body.selected_variants:
            opt = await db.from_("product_variant_options").eq("id", sv.option_id).select_one(
                "id,label,price_adjust,stock_adjust"
            )
            if not opt:
                raise BadRequestError(f"Variant option {sv.option_id} not found")
            unit_price += float(opt.get("price_adjust") or 0)
            stock_for_option = opt.get("stock_adjust") or 0
            if stock_for_option < body.quantity:
                raise BadRequestError(
                    f"Only {stock_for_option} of {opt.get('label', sv.label)} in stock"
                )

        # Fall back to product-level stock when no variants are selected
        if not body.selected_variants and product["stock"] < body.quantity:
            raise BadRequestError(f"Only {product['stock']} items in stock")

        # Get or create cart for this user+merchant
        cart = await (
            db.from_("cart")
            .eq("user_id", db_user["id"])
            .eq("merchant_id", product["merchant_id"])
            .select_one("id")
        )
        if not cart:
            carts = await db.from_("cart").insert({
                "user_id": db_user["id"],
                "merchant_id": product["merchant_id"],
            })
            cart = carts[0]

        # ── Find existing line: same product AND same variant signature ──
        existing_items = await (
            db.from_("cart_items")
            .eq("cart_id", cart["id"])
            .eq("product_id", body.product_id)
            .select("id,quantity,selected_variants")
        )
        new_signature = _variant_signature(variants_json)
        existing = next(
            (it for it in existing_items if _variant_signature(it.get("selected_variants")) == new_signature),
            None,
        )

        if existing:
            new_qty = existing["quantity"] + body.quantity
            # Re-validate combined qty against variant stock
            for sv in body.selected_variants:
                opt = await db.from_("product_variant_options").eq("id", sv.option_id).select_one("stock_adjust,label")
                if opt and (opt.get("stock_adjust") or 0) < new_qty:
                    raise BadRequestError(
                        f"Only {opt.get('stock_adjust') or 0} of {opt.get('label')} in stock"
                    )
            await db.from_("cart_items").eq("id", existing["id"]).update({
                "quantity": new_qty,
                "unit_price": unit_price,
            })
        else:
            await db.from_("cart_items").insert({
                "cart_id": cart["id"],
                "product_id": body.product_id,
                "quantity": body.quantity,
                "unit_price": unit_price,
                "selected_variants": variants_json or None,
            })

    return {"success": True}


def _variant_signature(variants: list | None) -> str:
    """Stable signature of a selected_variants list for grouping comparisons."""
    if not variants:
        return ""
    parts = []
    for v in variants:
        if isinstance(v, dict):
            parts.append(str(v.get("option_id")))
    return ",".join(sorted(parts))


@router.patch("/items/{item_id}")
async def update_cart_item(
    item_id: int,
    body: CartItemUpdate,
    user: TokenClaims = require_role(Role.USER),
):
    """Update cart item quantity. Set to 0 to remove."""
    async with SupabaseClient.service_role() as db:
        if body.quantity == 0:
            await db.from_("cart_items").eq("id", item_id).delete()
        else:
            await db.from_("cart_items").eq("id", item_id).update({"quantity": body.quantity})
    return {"success": True}


@router.delete("/items/{item_id}")
async def remove_cart_item(item_id: int, user: TokenClaims = require_role(Role.USER)):
    """Remove an item from cart."""
    async with SupabaseClient.service_role() as db:
        await db.from_("cart_items").eq("id", item_id).delete()
    return {"success": True}


@router.delete("")
async def clear_cart(user: TokenClaims = require_role(Role.USER)):
    """Clear all items from user's carts."""
    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)
        carts = await db.from_("cart").eq("user_id", db_user["id"]).select("id")
        for cart in carts:
            await db.from_("cart_items").eq("cart_id", cart["id"]).delete()
            await db.from_("cart").eq("id", cart["id"]).delete()
    return {"success": True}


# ── Helpers ─────────────────────────────────────────────────────


async def _get_db_user(db, user: TokenClaims) -> dict:
    """Resolve the database user row from JWT claims."""
    if user.telegram_id:
        row = await db.from_("users").eq("telegram_id", user.telegram_id).select_one("id,telegram_id,username,first_name")
        if row:
            return row
    # Fallback: try sub as UUID-based lookup
    row = await db.from_("users").eq("id", user.sub).select_one("id,telegram_id,username,first_name")
    if row:
        return row
    raise NotFoundError("User")
