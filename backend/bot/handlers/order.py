from telegram import Update
from telegram.ext import ContextTypes
from bot.supabase_helpers import sb_get, sb_get_one, sb_patch
from bot.keyboards.inline import order_list_keyboard, order_detail_keyboard, back_to_menu_keyboard
import logging

logger = logging.getLogger(__name__)


async def my_orders(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show user's order history."""
    query = update.callback_query
    await query.answer()

    telegram_id = update.effective_user.id
    user = await sb_get_one("users", f"select=id&telegram_id=eq.{telegram_id}")
    if not user:
        await query.edit_message_text("Please /start first.", reply_markup=back_to_menu_keyboard())
        return

    orders = await sb_get(
        "orders",
        f"select=id,order_code,status,total,created_at,merchant_id&user_id=eq.{user['id']}&order=created_at.desc&limit=20"
    )

    if not orders:
        await query.edit_message_text(
            "No orders yet!\n\nStart shopping to see your orders here.",
            reply_markup=back_to_menu_keyboard()
        )
        return

    # Enrich with merchant names
    merchant_ids = list(set(o["merchant_id"] for o in orders))
    merchants_str = ",".join(str(m) for m in merchant_ids)
    merchants = await sb_get("merchants", f"select=id,name&id=in.({merchants_str})")
    merchant_map = {m["id"]: m["name"] for m in merchants}

    for o in orders:
        o["merchant_name"] = merchant_map.get(o["merchant_id"], "Unknown")
        o["total"] = float(o["total"])

    await query.edit_message_text(
        "**Your Orders**\nTap an order to see details:",
        parse_mode="Markdown",
        reply_markup=order_list_keyboard(orders)
    )


async def view_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show order details."""
    query = update.callback_query
    await query.answer()

    order_id = int(query.data.split("_")[1])

    order = await sb_get_one(
        "orders",
        f"select=id,order_code,status,payment_method,payment_status,delivery_address,total,created_at,merchant_id&id=eq.{order_id}"
    )
    if not order:
        await query.edit_message_text("Order not found.", reply_markup=back_to_menu_keyboard())
        return

    merchant = await sb_get_one("merchants", f"select=name&id=eq.{order['merchant_id']}")
    merchant_name = merchant["name"] if merchant else "Unknown"

    items = await sb_get("order_items", f"select=product_name,quantity,subtotal&order_id=eq.{order_id}")

    status_emoji = {
        "pending": "Pending",
        "confirmed": "Confirmed",
        "preparing": "Preparing",
        "shipped": "Shipped",
        "delivered": "Delivered",
        "cancelled": "Cancelled"
    }.get(order["status"], order["status"])

    text = f"**Order {order['order_code']}**\n\n"
    text += f"{merchant_name}\n"
    text += f"Status: {status_emoji}\n"
    text += f"Payment: {order['payment_method'].upper()} ({order['payment_status']})\n"
    text += f"Delivery: {order.get('delivery_address', 'N/A')}\n\n"

    text += "**Items:**\n"
    for item in items:
        text += f"- {item['product_name']} x{item['quantity']} -- ${float(item['subtotal']):.2f}\n"

    text += f"\n**Total: ${float(order['total']):.2f}**\n"

    created = order.get("created_at", "N/A")
    if isinstance(created, str) and len(created) >= 16:
        created = created[:16].replace("T", " ")
    text += f"Ordered: {created}"

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=order_detail_keyboard(order_id, order["status"])
    )


async def cancel_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Cancel a pending order."""
    query = update.callback_query
    await query.answer()

    order_id = int(query.data.split("_")[2])

    order = await sb_get_one("orders", f"select=id,order_code,status&id=eq.{order_id}")
    if not order:
        await query.answer("Order not found!", show_alert=True)
        return
    if order["status"] != "pending":
        await query.answer("Can only cancel pending orders!", show_alert=True)
        return

    # Restore stock
    items = await sb_get("order_items", f"select=product_id,quantity&order_id=eq.{order_id}")
    for item in items:
        product = await sb_get_one("products", f"select=stock&id=eq.{item['product_id']}")
        if product:
            new_stock = product["stock"] + item["quantity"]
            await sb_patch("products", f"id=eq.{item['product_id']}", {"stock": new_stock})

    await sb_patch("orders", f"id=eq.{order_id}", {"status": "cancelled", "payment_status": "refunded"})

    await query.edit_message_text(
        f"**Order {order['order_code']} Cancelled**\n\nStock has been restored.",
        parse_mode="Markdown",
        reply_markup=back_to_menu_keyboard()
    )
