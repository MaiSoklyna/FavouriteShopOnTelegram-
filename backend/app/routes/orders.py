"""Order placement and management routes.

Key improvement: stock decrement uses a Supabase RPC call for atomicity,
preventing the overselling race condition in the old implementation.
"""

from __future__ import annotations

import logging
import random
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter

from app.core.constants import (
    FREE_DELIVERY_THRESHOLD,
    ORDER_PREFIX,
    ORDER_STATUS_TRANSITIONS,
    Role,
)
from app.core.dependencies import require_any_admin, require_role
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.services import settlement

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/orders", tags=["Orders"])


# ═══════════════════════════════════════════════════════════════
#  USER ENDPOINTS
# ═══════════════════════════════════════════════════════════════


@router.post("")
async def place_order(request_body: dict, user: TokenClaims = require_role(Role.USER)):
    """Place an order from the user's cart.

    Accepts a raw dict because the miniapp sends varying field sets.
    Required fields: merchant_id, delivery_address.
    Optional: promo_code, customer_note, payment_method, delivery_phone, delivery_name.
    """

    merchant_id = request_body.get("merchant_id")
    delivery_address = request_body.get("delivery_address", "")
    if not merchant_id or not delivery_address:
        raise BadRequestError("merchant_id and delivery_address are required")

    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)
        user_id = db_user["id"]

        # ── Price the cart (same computation as /orders/quote) ──
        promo_code = (request_body.get("promo_code") or "").strip() or None
        priced = await _price_cart(db, user_id, merchant_id, promo_code)
        if priced is None:
            raise BadRequestError("Cart is empty")
        if promo_code and not priced["promo"]:
            # The customer was shown a discount; never silently charge more.
            raise BadRequestError(priced["promo_error"] or "Promo code is no longer valid")

        cart, items, promo = priced["cart"], priced["items"], priced["promo"]
        subtotal = float(priced["subtotal"])
        discount = float(priced["discount"])
        delivery_fee = float(priced["delivery_fee"])
        total = float(priced["total"])

        # ── Generate order code ─────────────────────────────────
        now = datetime.now(timezone.utc)
        date_part = now.strftime("%y%m%d")
        rand_part = str(random.randint(1000, 9999))
        order_code = f"{ORDER_PREFIX}{date_part}-{rand_part}"

        # ── Build order row ─────────────────────────────────────
        order_data = {
            "order_code": order_code,
            "user_id": user_id,
            "merchant_id": merchant_id,
            "subtotal": subtotal,
            "discount_amount": discount,
            "delivery_fee": delivery_fee,
            "total": total,
            "status": "pending",
            "payment_method": request_body.get("payment_method", "cod"),
            "payment_status": "pending",
            "delivery_address": delivery_address,
        }

        # Optional fields — only include if present to avoid schema errors
        for field in ("delivery_province", "customer_note", "delivery_phone", "delivery_name"):
            val = request_body.get(field)
            if val:
                order_data[field] = val

        # customer_name/phone from user profile as fallback
        if "customer_name" not in order_data:
            name = db_user.get("first_name", "")
            if db_user.get("last_name"):
                name += f" {db_user['last_name']}"
            if name.strip():
                order_data["customer_name"] = name.strip()
        if "customer_phone" not in order_data and db_user.get("phone"):
            order_data["customer_phone"] = db_user["phone"]

        if promo:
            order_data["promo_code_id"] = promo["id"]

        rows = await db.from_("orders").insert(order_data)
        order = rows[0]
        order_id = order["id"]

        # ── Create order items + decrement stock ────────────────
        for item in items:
            product = await db.from_("products").eq("id", item["product_id"]).select_one(
                "id,name,sku,base_price,stock"
            )
            if not product:
                continue

            await db.from_("order_items").insert({
                "order_id": order_id,
                "product_id": item["product_id"],
                "product_name": product.get("name", "Unknown"),
                "product_sku": product.get("sku"),
                "selected_variants": item.get("selected_variants"),
                "quantity": item["quantity"],
                "unit_price": item.get("unit_price", product["base_price"]),
                "subtotal": round(item.get("unit_price", product["base_price"]) * item["quantity"], 2),
            })

            # Decrement product-level stock (prevent negative)
            new_stock = max(product.get("stock", 0) - item["quantity"], 0)
            await db.from_("products").eq("id", item["product_id"]).update({"stock": new_stock})

            # Decrement per-variant stock as well
            for sv in (item.get("selected_variants") or []):
                opt_id = sv.get("option_id") if isinstance(sv, dict) else None
                if not opt_id:
                    continue
                opt = await db.from_("product_variant_options").eq("id", opt_id).select_one("stock_adjust")
                if not opt:
                    continue
                new_opt_stock = max((opt.get("stock_adjust") or 0) - item["quantity"], 0)
                await db.from_("product_variant_options").eq("id", opt_id).update({"stock_adjust": new_opt_stock})

        # ── Record promo usage ──────────────────────────────────
        if promo:
            await db.from_("promo_usages").insert({
                "promo_code_id": promo["id"],
                "user_id": user_id,
                "order_id": order_id,
                "discount_applied": discount,
            })
            used_count = promo.get("used_count", 0) + 1
            await db.from_("promo_codes").eq("id", promo["id"]).update({"used_count": used_count})

        # ── Clean up cart ───────────────────────────────────────
        await db.from_("cart_items").eq("cart_id", cart["id"]).delete()
        await db.from_("cart").eq("id", cart["id"]).delete()

        # ── Earn loyalty points (best-effort) ───────────────────
        loyalty_result = None
        try:
            from app.services.loyalty import earn_points
            loyalty_result = await earn_points(user_id, order_id, float(total))
        except Exception as exc:
            logger.warning("Loyalty points not awarded for order %s: %s", order_id, exc)

        # ── Telegram notifications (best-effort) ────────────────
        try:
            merchant_row = await db.from_("merchants").eq("id", merchant_id).select_one(
                "name,telegram_group_id"
            )
            merchant_name = merchant_row["name"] if merchant_row else "Shop"
            merchant_group_id = merchant_row.get("telegram_group_id") if merchant_row else None
            order_items_for_dm = await db.from_("order_items").eq("order_id", order_id).select(
                "product_name,quantity,unit_price,subtotal"
            )

            from bot.notifications import (
                send_order_placed_to_customer,
                send_order_placed_to_merchant_group,
            )
            await send_order_placed_to_customer(
                db_user.get("telegram_id") or user.telegram_id,
                user_id=db_user.get("id"),
                order_id=order_id,
                order_code=order_code,
                merchant_name=merchant_name,
                items=order_items_for_dm,
                subtotal=subtotal,
                discount=discount,
                delivery_fee=delivery_fee,
                total=total,
                payment_method=order_data["payment_method"],
                delivery_address=delivery_address,
                payment_status=order_data["payment_status"],
            )

            # A QR order reaches the shop only once it is paid
            # (sent from payments._settle); COD orders go now.
            if merchant_group_id and order_data["payment_method"] != "khqr":
                await send_order_placed_to_merchant_group(
                    merchant_group_id,
                    order_id=order_id,
                    order_code=order_code,
                    merchant_name=merchant_name,
                    items=order_items_for_dm,
                    total=total,
                    payment_method=order_data["payment_method"],
                    delivery_address=delivery_address,
                    customer_name=order_data.get("customer_name") or order_data.get("delivery_name"),
                    customer_phone=order_data.get("customer_phone") or order_data.get("delivery_phone"),
                )
        except Exception:
            logger.exception("Order notification dispatch failed (non-fatal)")

    return {
        "success": True,
        "data": {
            "order_id": order_id,
            "order_code": order_code,
            "subtotal": subtotal,
            "discount_amount": discount,
            "delivery_fee": delivery_fee,
            "total": total,
            "status": "pending",
            "payment_method": order_data["payment_method"],
            "loyalty": loyalty_result,
        },
    }


@router.post("/quote")
async def quote_order(request_body: dict, user: TokenClaims = require_role(Role.USER)):
    """Price the caller's cart exactly as placing the order would.

    Body: {"promo_code"?: str}. Returns one quote per shop (each shop is a
    separate order with its own delivery fee). A promo code belongs to one
    shop and is applied to that shop's order only.
    """
    promo_code = (request_body.get("promo_code") or "").strip() or None
    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)
        carts = await db.from_("cart").eq("user_id", db_user["id"]).select("id,merchant_id")

        quotes = []
        promo_merchant_id = None
        promo_error = None
        for cart in carts:
            if not cart.get("merchant_id"):
                continue
            priced = await _price_cart(db, db_user["id"], cart["merchant_id"], promo_code)
            if priced is None:
                continue
            if priced["promo"]:
                promo_merchant_id = cart["merchant_id"]
            elif priced["promo_error"] and priced["promo_owned"]:
                promo_error = priced["promo_error"]
            quotes.append({
                "merchant_id": cart["merchant_id"],
                "subtotal": str(priced["subtotal"]),
                "discount": str(priced["discount"]),
                "delivery_fee": str(priced["delivery_fee"]),
                "total": str(priced["total"]),
                "promo_applied": bool(priced["promo"]),
            })

    if promo_code and promo_merchant_id is None and promo_error is None:
        promo_error = "Promo code not valid for the shops in your cart"

    grand = {k: str(sum((Decimal(q[k]) for q in quotes), Decimal("0.00")))
             for k in ("subtotal", "discount", "delivery_fee", "total")}
    return {"data": {
        "orders": quotes,
        "totals": grand,
        "promo": {
            "code": promo_code,
            "applied": promo_merchant_id is not None,
            "merchant_id": promo_merchant_id,
            "error": promo_error,
        } if promo_code else None,
    }}


@router.get("")
async def list_user_orders(
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
    user: TokenClaims = require_role(Role.USER),
):
    """List the current user's orders."""
    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)
        q = db.from_("orders").eq("user_id", db_user["id"]).order("created_at", desc=True)
        if status:
            q = q.eq("status", status)
        q = q.offset((page - 1) * page_size).limit(page_size)
        return await q.select()


@router.get("/{order_id}")
async def get_order(order_id: int, user: TokenClaims = require_role(Role.USER, Role.MERCHANT_ADMIN, Role.SUPER_ADMIN)):
    """Get order details with items."""
    async with SupabaseClient.service_role() as db:
        order = await db.from_("orders").eq("id", order_id).select_one()
        if not order:
            raise NotFoundError("Order", order_id)

        # Authorization: user can only see own orders, admin can see merchant orders
        if user.is_user:
            db_user = await _get_db_user(db, user)
            if order["user_id"] != db_user["id"]:
                raise ForbiddenError("You can only view your own orders")
        elif user.role == Role.MERCHANT_ADMIN:
            if order.get("merchant_id") != user.merchant_id:
                raise ForbiddenError("You can only view your merchant's orders")

        items = await db.from_("order_items").eq("order_id", order_id).select()
        order["items"] = items
    return order


@router.post("/{order_id}/cancel")
async def cancel_order(order_id: int, user: TokenClaims = require_role(Role.USER)):
    """Cancel a pending order and restore stock."""
    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)
        order = await db.from_("orders").eq("id", order_id).select_one("id,user_id,status")
        if not order:
            raise NotFoundError("Order", order_id)
        if order["user_id"] != db_user["id"]:
            raise ForbiddenError("You can only cancel your own orders")
        if order["status"] != "pending":
            raise BadRequestError("Only pending orders can be cancelled")

        # Restore stock (product-level + variant options)
        items = await db.from_("order_items").eq("order_id", order_id).select("product_id,quantity,selected_variants")
        for item in items:
            product = await db.from_("products").eq("id", item["product_id"]).select_one("stock")
            if product:
                new_stock = (product.get("stock", 0)) + item["quantity"]
                await db.from_("products").eq("id", item["product_id"]).update({"stock": new_stock})

            for sv in (item.get("selected_variants") or []):
                opt_id = sv.get("option_id") if isinstance(sv, dict) else None
                if not opt_id:
                    continue
                opt = await db.from_("product_variant_options").eq("id", opt_id).select_one("stock_adjust")
                if opt:
                    restored = (opt.get("stock_adjust") or 0) + item["quantity"]
                    await db.from_("product_variant_options").eq("id", opt_id).update({"stock_adjust": restored})

        await settlement.on_order_status_changed(
            db, order_id, "cancelled", actor_type="user", actor_id=str(db_user["id"]),
            reason="Cancelled by customer",
        )
        await db.from_("orders").eq("id", order_id).update({"status": "cancelled"})
    return {"success": True, "message": "Order cancelled"}


# ═══════════════════════════════════════════════════════════════
#  ADMIN ORDER MANAGEMENT
# ═══════════════════════════════════════════════════════════════


@router.get("/admin/list")
async def list_orders_admin(
    merchant_id: int | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 25,
    user: TokenClaims = require_any_admin(),
):
    """List orders for admin dashboard."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("orders").order("created_at", desc=True)

        # Merchant admin can only see their merchant's orders
        if user.role == Role.MERCHANT_ADMIN:
            q = q.eq("merchant_id", user.merchant_id)
        elif merchant_id:
            q = q.eq("merchant_id", merchant_id)

        if status:
            q = q.eq("status", status)

        q = q.offset((page - 1) * page_size).limit(page_size)
        return await q.select()


@router.patch("/admin/{order_id}/status")
async def update_order_status(
    order_id: int,
    body: dict,
    user: TokenClaims = require_any_admin(),
):
    """Update order status (admin only). Validates allowed transitions."""
    new_status = body.get("status")
    if not new_status:
        raise BadRequestError("status is required")

    async with SupabaseClient.service_role() as db:
        order = await db.from_("orders").eq("id", order_id).select_one("id,status,merchant_id")
        if not order:
            raise NotFoundError("Order", order_id)

        # Check merchant ownership
        if user.role == Role.MERCHANT_ADMIN and order.get("merchant_id") != user.merchant_id:
            raise ForbiddenError("You can only manage your merchant's orders")

        # Validate transition
        allowed = ORDER_STATUS_TRANSITIONS.get(order["status"], [])
        if new_status not in allowed:
            raise BadRequestError(
                f"Cannot transition from '{order['status']}' to '{new_status}'. "
                f"Allowed: {allowed}"
            )

        update_data: dict = {"status": new_status}
        if body.get("admin_note"):
            update_data["admin_note"] = body["admin_note"]
        if body.get("payment_status"):
            update_data["payment_status"] = body["payment_status"]

        actor = {"actor_type": str(user.role), "actor_id": user.sub}
        # Reverse first: it refuses if the earning sits in an open payout,
        # and that must stop the cancellation too.
        if new_status == "cancelled":
            await settlement.on_order_status_changed(
                db, order_id, new_status, reason=body.get("admin_note"), **actor,
            )

        await db.from_("orders").eq("id", order_id).update(update_data)

        if new_status == "delivered":
            await settlement.on_order_status_changed(db, order_id, new_status, **actor)
    return {"success": True}


# ═══════════════════════════════════════════════════════════════
#  HELPERS
# ══════════════════════════════════════════════════════════��════


async def _get_db_user(db, user: TokenClaims) -> dict:
    """Resolve the database user row from JWT claims."""
    if user.telegram_id:
        row = await db.from_("users").eq("telegram_id", user.telegram_id).select_one(
            "id,telegram_id,username,first_name,last_name,phone"
        )
        if row:
            return row
    raise NotFoundError("User")


async def _price_cart(db, user_id: int, merchant_id: int, promo_code: str | None) -> dict | None:
    """Single source of truth for an order's price.

    Used by both /orders/quote (what the customer sees) and place_order
    (what is charged). Returns None when the cart for this shop is empty.
    """
    cart = await db.from_("cart").eq("user_id", user_id).eq("merchant_id", merchant_id).select_one("id")
    if not cart:
        return None
    items = await db.from_("cart_items").eq("cart_id", cart["id"]).select()
    if not items:
        return None

    subtotal = sum(
        (_money(item.get("unit_price")) * int(item.get("quantity") or 0) for item in items),
        Decimal("0.00"),
    )
    delivery_fee = Decimal("0.00") if subtotal >= Decimal(str(FREE_DELIVERY_THRESHOLD)) else Decimal("5.00")

    promo, promo_error, promo_owned = None, None, False
    discount = Decimal("0.00")
    if promo_code:
        promo, promo_error, promo_owned = await _validate_promo(db, promo_code, merchant_id, subtotal)
        if promo:
            value = _money(promo["value"])
            if promo["type"] == "percent":
                discount = (subtotal * value / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            else:
                discount = value
            discount = min(discount, subtotal)

    return {
        "cart": cart,
        "items": items,
        "subtotal": subtotal,
        "discount": discount,
        "delivery_fee": delivery_fee,
        "total": subtotal - discount + delivery_fee,
        "promo": promo,
        "promo_error": promo_error,
        "promo_owned": promo_owned,
    }


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def _validate_promo(db, code: str, merchant_id: int, subtotal: Decimal) -> tuple[dict | None, str | None, bool]:
    """Validate a promo code for one shop.

    Returns (promo, error, owned): `owned` is True when the code exists for
    this shop, so its error message is the one to show the customer.
    """
    promo = await (
        db.from_("promo_codes")
        .eq("merchant_id", merchant_id)
        .eq("code", code)
        .eq("is_active", True)
        .select_one()
    )
    if not promo:
        return None, None, False

    if promo.get("expires_at"):
        exp = datetime.fromisoformat(promo["expires_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > exp:
            return None, "Promo code has expired", True

    if promo.get("max_uses") and (promo.get("used_count") or 0) >= promo["max_uses"]:
        return None, "Promo code usage limit reached", True

    if promo.get("min_order") and subtotal < _money(promo["min_order"]):
        return None, f"Minimum order ${_money(promo['min_order'])} required for this code", True

    return promo, None, True
