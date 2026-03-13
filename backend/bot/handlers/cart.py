from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes
from bot.supabase_helpers import sb_get, sb_get_one, sb_post, sb_patch, sb_delete
from bot.keyboards.inline import cart_keyboard, back_to_menu_keyboard, checkout_confirm_keyboard
import logging
import uuid

logger = logging.getLogger(__name__)

# Conversation states for checkout
CHECKOUT_ADDRESS, CHECKOUT_CITY, CHECKOUT_CONFIRM = range(3)


async def add_to_cart(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Add product to cart."""
    query = update.callback_query
    await query.answer()

    parts = query.data.split("_")
    product_id = int(parts[1])
    quantity = int(parts[2]) if len(parts) > 2 else 1

    telegram_id = update.effective_user.id

    user = await sb_get_one("users", f"select=id&telegram_id=eq.{telegram_id}")
    if not user:
        await query.edit_message_text("Please /start first to register.", reply_markup=back_to_menu_keyboard())
        return

    product = await sb_get_one("products", f"select=id,merchant_id,name,base_price,stock,is_active&id=eq.{product_id}&is_active=eq.true")
    if not product:
        await query.edit_message_text("Product not found.", reply_markup=back_to_menu_keyboard())
        return

    if quantity > product["stock"]:
        await query.answer(f"Only {product['stock']} in stock!", show_alert=True)
        return

    unit_price = float(product["base_price"])
    user_id = user["id"]

    # Find or create cart for user+merchant
    cart = await sb_get_one("cart", f"select=id&user_id=eq.{user_id}&merchant_id=eq.{product['merchant_id']}")
    if cart:
        cart_id = cart["id"]
    else:
        new_cart = await sb_post("cart", {"user_id": user_id, "merchant_id": product["merchant_id"]})
        cart_id = new_cart[0]["id"]

    # Check if product already in cart_items
    existing = await sb_get_one("cart_items", f"select=id,quantity&cart_id=eq.{cart_id}&product_id=eq.{product_id}")

    if existing:
        new_qty = existing["quantity"] + quantity
        await sb_patch("cart_items", f"id=eq.{existing['id']}", {"quantity": new_qty, "unit_price": unit_price})
    else:
        await sb_post("cart_items", {
            "cart_id": cart_id,
            "product_id": product_id,
            "quantity": quantity,
            "unit_price": unit_price,
        })

    await query.answer(f"Added {quantity}x {product['name']} to cart!", show_alert=True)
    await query.edit_message_text(
        f"**Added to Cart!**\n\n"
        f"{product['name']} x{quantity}\n"
        f"${unit_price * quantity:.2f}\n\n"
        f"What would you like to do next?",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("View Cart", callback_data="view_cart")],
            [InlineKeyboardButton("Continue Shopping", callback_data="browse_shops")],
            [InlineKeyboardButton("Main Menu", callback_data="main_menu")],
        ])
    )


async def view_cart(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show cart contents."""
    query = update.callback_query
    await query.answer()

    telegram_id = update.effective_user.id
    user = await sb_get_one("users", f"select=id&telegram_id=eq.{telegram_id}")
    if not user:
        await query.edit_message_text("Please /start first.", reply_markup=back_to_menu_keyboard())
        return

    # Get all carts for user
    carts = await sb_get("cart", f"select=id,merchant_id&user_id=eq.{user['id']}")
    if not carts:
        await query.edit_message_text(
            "Your cart is empty!\n\nBrowse shops to add products.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("Browse Shops", callback_data="browse_shops")],
                [InlineKeyboardButton("Main Menu", callback_data="main_menu")],
            ])
        )
        return

    cart_ids = [c["id"] for c in carts]
    cart_ids_str = ",".join(str(c) for c in cart_ids)
    cart_items = await sb_get("cart_items", f"select=id,cart_id,product_id,quantity,unit_price&cart_id=in.({cart_ids_str})&order=created_at.desc")

    if not cart_items:
        await query.edit_message_text(
            "Your cart is empty!\n\nBrowse shops to add products.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("Browse Shops", callback_data="browse_shops")],
                [InlineKeyboardButton("Main Menu", callback_data="main_menu")],
            ])
        )
        return

    # Enrich with product names and merchant names
    cart_map = {c["id"]: c["merchant_id"] for c in carts}
    product_ids = list(set(ci["product_id"] for ci in cart_items))
    products_str = ",".join(str(p) for p in product_ids)
    products = await sb_get("products", f"select=id,name&id=in.({products_str})")
    product_map = {p["id"]: p["name"] for p in products}

    merchant_ids = list(set(c["merchant_id"] for c in carts))
    merchants_str = ",".join(str(m) for m in merchant_ids)
    merchants = await sb_get("merchants", f"select=id,name&id=in.({merchants_str})")
    merchant_map = {m["id"]: m["name"] for m in merchants}

    items = []
    total = 0
    for ci in cart_items:
        line_total = float(ci["unit_price"]) * ci["quantity"]
        total += line_total
        items.append({
            "id": ci["id"],
            "name": product_map.get(ci["product_id"], "Unknown"),
            "quantity": ci["quantity"],
            "line_total": line_total,
            "merchant_name": merchant_map.get(cart_map.get(ci["cart_id"]), "Unknown"),
        })

    text = "**Your Shopping Cart**\n\n"
    for item in items:
        text += f"- {item['name']} x{item['quantity']} -- ${item['line_total']:.2f}\n"
        text += f"  _from {item['merchant_name']}_\n"
    text += f"\n**Total: ${total:.2f}**"

    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=cart_keyboard(items))


async def remove_from_cart(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Remove item from cart."""
    query = update.callback_query
    item_id = int(query.data.split("_")[1])

    await sb_delete("cart_items", f"id=eq.{item_id}")
    await query.answer("Removed from cart!")
    await view_cart(update, context)


async def clear_cart(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Clear entire cart."""
    query = update.callback_query
    await query.answer()

    telegram_id = update.effective_user.id
    user = await sb_get_one("users", f"select=id&telegram_id=eq.{telegram_id}")
    if user:
        carts = await sb_get("cart", f"select=id&user_id=eq.{user['id']}")
        for c in carts:
            await sb_delete("cart_items", f"cart_id=eq.{c['id']}")

    await query.edit_message_text(
        "Cart cleared!",
        reply_markup=back_to_menu_keyboard()
    )


async def checkout_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start checkout - ask for delivery address."""
    query = update.callback_query
    await query.answer()

    telegram_id = update.effective_user.id
    user = await sb_get_one("users", f"select=id,address&telegram_id=eq.{telegram_id}")

    if user and user.get("address"):
        context.user_data["checkout_address"] = user["address"]
        await query.edit_message_text(
            f"**Delivery Address:**\n"
            f"{user['address']}\n\n"
            f"Use this address?",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("Use This Address", callback_data="confirm_address")],
                [InlineKeyboardButton("New Address", callback_data="new_address")],
                [InlineKeyboardButton("Cancel", callback_data="view_cart")],
            ])
        )
    else:
        await query.edit_message_text(
            "**Checkout**\n\nPlease type your **delivery address**:",
            parse_mode="Markdown"
        )
        context.user_data["checkout_state"] = "waiting_address"


async def handle_checkout_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle text input during checkout."""
    state = context.user_data.get("checkout_state")

    if state == "waiting_address":
        context.user_data["checkout_address"] = update.message.text
        context.user_data["checkout_state"] = None

        telegram_id = update.effective_user.id
        user = await sb_get_one("users", f"select=id&telegram_id=eq.{telegram_id}")
        if user:
            await sb_patch("users", f"id=eq.{user['id']}", {"address": context.user_data["checkout_address"]})

        await update.message.reply_text(
            f"**Delivery to:**\n"
            f"{context.user_data['checkout_address']}\n\n"
            f"Payment: **Cash on Delivery**\n\n"
            f"Confirm your order?",
            parse_mode="Markdown",
            reply_markup=checkout_confirm_keyboard()
        )


async def confirm_address(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Confirm saved address for checkout."""
    query = update.callback_query
    await query.answer()

    await query.edit_message_text(
        f"**Delivery to:**\n"
        f"{context.user_data.get('checkout_address', 'N/A')}\n\n"
        f"Payment: **Cash on Delivery**\n\n"
        f"Confirm your order?",
        parse_mode="Markdown",
        reply_markup=checkout_confirm_keyboard()
    )


async def new_address(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Ask for new delivery address."""
    query = update.callback_query
    await query.answer()

    context.user_data["checkout_state"] = "waiting_address"
    await query.edit_message_text(
        "Please type your **delivery address**:",
        parse_mode="Markdown"
    )


async def confirm_order_cod(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Confirm and place order with Cash on Delivery."""
    query = update.callback_query
    await query.answer()

    telegram_id = update.effective_user.id
    user = await sb_get_one("users", f"select=id&telegram_id=eq.{telegram_id}")
    if not user:
        await query.edit_message_text("Error: User not found.", reply_markup=back_to_menu_keyboard())
        return

    user_id = user["id"]
    address = context.user_data.get("checkout_address", "")

    # Get all carts + items
    carts = await sb_get("cart", f"select=id,merchant_id&user_id=eq.{user_id}")
    if not carts:
        await query.edit_message_text("Cart is empty!", reply_markup=back_to_menu_keyboard())
        return

    cart_ids = [c["id"] for c in carts]
    cart_ids_str = ",".join(str(c) for c in cart_ids)
    cart_items = await sb_get("cart_items", f"select=id,cart_id,product_id,quantity,unit_price&cart_id=in.({cart_ids_str})")

    if not cart_items:
        await query.edit_message_text("Cart is empty!", reply_markup=back_to_menu_keyboard())
        return

    # Enrich with product info
    product_ids = list(set(ci["product_id"] for ci in cart_items))
    products_str = ",".join(str(p) for p in product_ids)
    products = await sb_get("products", f"select=id,name,sku,stock&id=in.({products_str})")
    product_map = {p["id"]: p for p in products}

    # Group by merchant
    cart_map = {c["id"]: c["merchant_id"] for c in carts}
    merchant_groups = {}
    for ci in cart_items:
        mid = cart_map[ci["cart_id"]]
        if mid not in merchant_groups:
            merchant_groups[mid] = []
        prod = product_map.get(ci["product_id"], {})
        merchant_groups[mid].append({
            **ci,
            "product_name": prod.get("name", "Unknown"),
            "sku": prod.get("sku"),
            "line_total": float(ci["unit_price"]) * ci["quantity"],
        })

    created_orders = []
    for merchant_id, items in merchant_groups.items():
        subtotal = sum(item["line_total"] for item in items)
        order_code = f"ORD-{uuid.uuid4().hex[:8].upper()}"

        new_order = await sb_post("orders", {
            "order_code": order_code,
            "merchant_id": merchant_id,
            "user_id": user_id,
            "subtotal": subtotal,
            "discount_amount": 0,
            "total": subtotal,
            "delivery_address": address,
            "payment_method": "cod",
            "payment_status": "unpaid",
            "status": "pending",
        })
        order_id = new_order[0]["id"]

        for item in items:
            await sb_post("order_items", {
                "order_id": order_id,
                "product_id": item["product_id"],
                "product_name": item["product_name"],
                "product_sku": item.get("sku"),
                "quantity": item["quantity"],
                "unit_price": float(item["unit_price"]),
                "subtotal": item["line_total"],
            })
            # Decrease stock
            prod = product_map.get(item["product_id"])
            if prod:
                new_stock = max(0, prod["stock"] - item["quantity"])
                await sb_patch("products", f"id=eq.{item['product_id']}", {"stock": new_stock})

        created_orders.append({"order_code": order_code, "total": subtotal})

    # Clear cart items
    for c in carts:
        await sb_delete("cart_items", f"cart_id=eq.{c['id']}")

    # Build confirmation message
    text = "**Order Placed Successfully!**\n\n"
    for o in created_orders:
        text += f"Order: `{o['order_code']}`\n"
        text += f"Total: ${o['total']:.2f}\n\n"
    text += f"Delivery: {address}\n"
    text += f"Payment: Cash on Delivery\n\n"
    text += "You can track your orders anytime!"

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("My Orders", callback_data="my_orders")],
            [InlineKeyboardButton("Main Menu", callback_data="main_menu")],
        ])
    )
