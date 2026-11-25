from telegram import InlineKeyboardButton, InlineKeyboardMarkup


def main_menu_keyboard():
    """Main menu after /start."""
    keyboard = [
        [InlineKeyboardButton("🛍️ Browse Shops", callback_data="browse_shops")],
        [InlineKeyboardButton("📦 My Orders", callback_data="my_orders"),
         InlineKeyboardButton("🛒 My Cart", callback_data="view_cart")],
        [InlineKeyboardButton("👤 My Profile", callback_data="my_profile"),
         InlineKeyboardButton("📞 Support", callback_data="support")],
    ]
    return InlineKeyboardMarkup(keyboard)


def back_to_menu_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")]
    ])


def merchant_list_keyboard(merchants: list):
    """List of merchant shops."""
    keyboard = []
    for m in merchants:
        keyboard.append([InlineKeyboardButton(
            f"🏪 {m['name']} ({m.get('product_count', 0)} items)",
            callback_data=f"shop_{m['id']}"
        )])
    keyboard.append([InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")])
    return InlineKeyboardMarkup(keyboard)


def category_keyboard(categories: list, merchant_id: int):
    """Category list for a merchant."""
    keyboard = []
    for cat in categories:
        keyboard.append([InlineKeyboardButton(
            f"📂 {cat['name']}",
            callback_data=f"cat_{merchant_id}_{cat['id']}"
        )])
    keyboard.append([InlineKeyboardButton("📋 All Products", callback_data=f"allprod_{merchant_id}")])
    keyboard.append([InlineKeyboardButton("◀️ Back to Shops", callback_data="browse_shops")])
    return InlineKeyboardMarkup(keyboard)


def product_list_keyboard(products: list, merchant_id: int):
    """List of products."""
    keyboard = []
    for p in products:
        price = f"${p['base_price']:.2f}"
        stock = "✅" if p["stock"] > 0 else "❌"
        keyboard.append([InlineKeyboardButton(
            f"{stock} {p['name']} - {price}",
            callback_data=f"prod_{p['id']}"
        )])
    keyboard.append([InlineKeyboardButton("◀️ Back to Shop", callback_data=f"shop_{merchant_id}")])
    return InlineKeyboardMarkup(keyboard)


def product_detail_keyboard(product_id: int, merchant_id: int):
    """Product detail with add to cart."""
    keyboard = [
        [InlineKeyboardButton("🛒 Add to Cart", callback_data=f"addcart_{product_id}_1")],
        [
            InlineKeyboardButton("➖", callback_data=f"qty_minus_{product_id}"),
            InlineKeyboardButton("1", callback_data="qty_display"),
            InlineKeyboardButton("➕", callback_data=f"qty_plus_{product_id}"),
        ],
        [InlineKeyboardButton("◀️ Back", callback_data=f"allprod_{merchant_id}")],
    ]
    return InlineKeyboardMarkup(keyboard)


def cart_keyboard(cart_items: list):
    """Cart with remove buttons."""
    keyboard = []
    for item in cart_items:
        keyboard.append([InlineKeyboardButton(
            f"❌ {item['name']} x{item['quantity']}",
            callback_data=f"rmcart_{item['id']}"
        )])
    if cart_items:
        keyboard.append([InlineKeyboardButton("🗑 Clear Cart", callback_data="clear_cart")])
        keyboard.append([InlineKeyboardButton("✅ Checkout", callback_data="checkout_start")])
    keyboard.append([InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")])
    return InlineKeyboardMarkup(keyboard)


def order_list_keyboard(orders: list):
    """List of user orders."""
    keyboard = []
    for o in orders:
        status_emoji = {
            "pending": "⏳", "confirmed": "✅", "preparing": "👨‍🍳",
            "shipped": "🚚", "delivered": "📦", "cancelled": "❌", "expired": "⌛"
        }.get(o["status"], "❓")
        keyboard.append([InlineKeyboardButton(
            f"{status_emoji} {o['order_code']} - ${o['total']:.2f}",
            callback_data=f"order_{o['id']}"
        )])
    keyboard.append([InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")])
    return InlineKeyboardMarkup(keyboard)


def order_detail_keyboard(order_id: int, status: str):
    """Order detail with cancel option if pending."""
    keyboard = []
    if status == "pending":
        keyboard.append([InlineKeyboardButton("❌ Cancel Order", callback_data=f"cancel_order_{order_id}")])
    keyboard.append([InlineKeyboardButton("◀️ Back to Orders", callback_data="my_orders")])
    keyboard.append([InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")])
    return InlineKeyboardMarkup(keyboard)


def checkout_confirm_keyboard():
    """Confirm checkout."""
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ Confirm Order (COD)", callback_data="confirm_cod")],
        [InlineKeyboardButton("❌ Cancel", callback_data="view_cart")],
    ])