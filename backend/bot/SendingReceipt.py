"""
Telegram Receipt Sender
Sends formatted order receipts to customers via Telegram when orders are delivered.
"""

import logging
from datetime import datetime
from telegram import InlineKeyboardButton, InlineKeyboardMarkup
from bot.supabase_helpers import sb_get, sb_get_one, sb_patch
from app.config import settings

logger = logging.getLogger(__name__)


async def send_receipt_to_customer(bot, order_id: int):
    """
    Fetch order details and send formatted receipt via Telegram.
    Called after order status changes to 'delivered'.
    """
    try:
        order = await sb_get_one(
            "orders",
            f"select=id,order_code,subtotal,discount_amount,delivery_fee,total,"
            f"payment_method,payment_status,delivery_address,delivery_name,delivery_phone,"
            f"delivery_province,created_at,updated_at,user_id,merchant_id"
            f"&id=eq.{order_id}"
        )
        if not order:
            logger.error(f"Order {order_id} not found for receipt")
            return False

        user = await sb_get_one("users", f"select=telegram_id,first_name,last_name,username&id=eq.{order['user_id']}")
        if not user or not user.get("telegram_id"):
            logger.warning(f"Order {order_id} has no Telegram ID for customer")
            return False

        merchant = await sb_get_one("merchants", f"select=name,phone&id=eq.{order['merchant_id']}")
        merchant_name = merchant["name"] if merchant else "Unknown"

        items = await sb_get("order_items", f"select=quantity,unit_price,subtotal,product_name,selected_variants&order_id=eq.{order_id}&order=id")

        if not items:
            logger.warning(f"Order {order_id} has no items")
            return False

        # Build items text
        items_text = []
        for item in items:
            variant_text = ""
            if item.get("selected_variants"):
                try:
                    import json
                    variants = json.loads(item["selected_variants"]) if isinstance(item["selected_variants"], str) else item["selected_variants"]
                    if variants:
                        variant_text = f" ({', '.join([f'{k}: {v}' for k, v in variants.items()])})"
                except Exception:
                    pass

            items_text.append(
                f"  - {item['product_name']}{variant_text}\n"
                f"    {item['quantity']} x ${float(item['unit_price']):.2f} = ${float(item['subtotal']):.2f}"
            )

        items_section = "\n".join(items_text)

        # Format dates
        order_date = order["created_at"]
        if isinstance(order_date, str):
            order_date = datetime.fromisoformat(order_date.replace("Z", "+00:00"))
        date_str = order_date.strftime("%b %d, %Y at %I:%M %p") if isinstance(order_date, datetime) else str(order_date)

        customer_name = f"{user.get('first_name', '')} {user.get('last_name', '')}".strip() or user.get("username", "Customer")

        receipt = f"""
**DELIVERY RECEIPT**

**Order:** {order.get('order_code') or f"#{order['id']:04d}"}
**Shop:** {merchant_name}
**Date:** {date_str}

**Items:**
{items_section}

**Order Summary:**
  Subtotal: ${float(order['subtotal']):.2f}
"""

        if order.get("discount_amount") and float(order["discount_amount"]) > 0:
            receipt += f"  Discount: -${float(order['discount_amount']):.2f}\n"

        if order.get("delivery_fee") and float(order["delivery_fee"]) > 0:
            receipt += f"  Delivery: ${float(order['delivery_fee']):.2f}\n"
        else:
            receipt += "  Delivery: FREE\n"

        receipt += f"""
**TOTAL: ${float(order['total']):.2f}**
Payment: {order['payment_method'].upper()}
Status: {order['payment_status'].upper()}

**Delivered to:**
{order.get('delivery_name', customer_name)}
{order.get('delivery_phone', 'N/A')}
{order.get('delivery_address', 'N/A')}
{order.get('delivery_province', '')}

**Order Delivered Successfully!**

Thank you for shopping with us!
"""

        base = settings.web_app_base
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("Write a Review", url=f"{base}/shop/order/{order['id']}")],
            [InlineKeyboardButton("Shop Again", url=f"{base}/shop")],
            [InlineKeyboardButton("Contact Support", callback_data="support")],
        ])

        await bot.send_message(
            chat_id=user["telegram_id"],
            text=receipt,
            parse_mode="Markdown",
            reply_markup=keyboard,
        )

        logger.info(f"Receipt sent successfully for order {order_id} to user {user['telegram_id']}")

        await sb_patch("orders", f"id=eq.{order_id}", {"receipt_sent_at": datetime.utcnow().isoformat()})

        return True

    except Exception as e:
        logger.error(f"Failed to send receipt for order {order_id}: {str(e)}", exc_info=True)
        return False


async def send_receipt_for_multiple_orders(bot, order_ids: list):
    """Send receipts for multiple orders (batch processing)."""
    results = {"success": 0, "failed": 0, "errors": []}

    for order_id in order_ids:
        try:
            success = await send_receipt_to_customer(bot, order_id)
            if success:
                results["success"] += 1
            else:
                results["failed"] += 1
                results["errors"].append(f"Order {order_id}: Receipt sending failed")
        except Exception as e:
            results["failed"] += 1
            results["errors"].append(f"Order {order_id}: {str(e)}")

    return results
