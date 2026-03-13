from telegram import Update
from telegram.ext import ContextTypes
from bot.supabase_helpers import sb_get, sb_get_one
from bot.keyboards.inline import (
    merchant_list_keyboard, category_keyboard, product_list_keyboard,
    product_detail_keyboard, back_to_menu_keyboard
)
import logging

logger = logging.getLogger(__name__)


async def browse_shops(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show list of active merchants."""
    query = update.callback_query
    await query.answer()

    merchants = await sb_get("merchants", "select=*&status=eq.active&order=name")

    # Enrich with product counts
    for m in merchants:
        products = await sb_get("products", f"select=id&merchant_id=eq.{m['id']}&is_active=eq.true")
        m["product_count"] = len(products)

    if not merchants:
        await query.edit_message_text(
            "No shops available right now. Check back later!",
            reply_markup=back_to_menu_keyboard()
        )
        return

    await query.edit_message_text(
        "**Available Shops**\nSelect a shop to browse products:",
        parse_mode="Markdown",
        reply_markup=merchant_list_keyboard(merchants)
    )


async def view_shop(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show categories for a specific merchant."""
    query = update.callback_query
    await query.answer()

    merchant_id = int(query.data.split("_")[1])

    merchant = await sb_get_one("merchants", f"select=*&id=eq.{merchant_id}")
    if not merchant:
        await query.edit_message_text("Shop not found.", reply_markup=back_to_menu_keyboard())
        return

    # Get products for this merchant to find categories with products
    products = await sb_get("products", f"select=category_id&merchant_id=eq.{merchant_id}&is_active=eq.true")
    cat_ids = list(set(p["category_id"] for p in products if p.get("category_id")))

    categories = []
    if cat_ids:
        ids_str = ",".join(str(c) for c in cat_ids)
        categories = await sb_get("categories", f"select=id,name,icon_emoji&id=in.({ids_str})&order=name")

    text = f"**{merchant['name']}**\n"
    if merchant.get("description"):
        text += f"_{merchant['description']}_\n"
    text += "\nSelect a category or view all products:"

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=category_keyboard(categories, merchant_id)
    )


async def view_category_products(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show products in a category for a merchant."""
    query = update.callback_query
    await query.answer()

    parts = query.data.split("_")
    merchant_id = int(parts[1])
    category_id = int(parts[2])

    products = await sb_get(
        "products",
        f"select=*&merchant_id=eq.{merchant_id}&category_id=eq.{category_id}&is_active=eq.true&order=name"
    )

    if not products:
        await query.edit_message_text(
            "No products in this category.",
            reply_markup=back_to_menu_keyboard()
        )
        return

    category = await sb_get_one("categories", f"select=name&id=eq.{category_id}")
    cat_name = category["name"] if category else "Products"

    await query.edit_message_text(
        f"**{cat_name}**\nSelect a product for details:",
        parse_mode="Markdown",
        reply_markup=product_list_keyboard(products, merchant_id)
    )


async def view_all_products(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show all products for a merchant."""
    query = update.callback_query
    await query.answer()

    merchant_id = int(query.data.split("_")[1])

    products = await sb_get(
        "products",
        f"select=*&merchant_id=eq.{merchant_id}&is_active=eq.true&order=name"
    )

    if not products:
        await query.edit_message_text(
            "No products available in this shop.",
            reply_markup=back_to_menu_keyboard()
        )
        return

    await query.edit_message_text(
        "**All Products**\nSelect a product for details:",
        parse_mode="Markdown",
        reply_markup=product_list_keyboard(products, merchant_id)
    )


async def view_product(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show product details with add to cart option."""
    query = update.callback_query
    await query.answer()

    product_id = int(query.data.split("_")[1])

    product = await sb_get_one("products", f"select=*&id=eq.{product_id}")
    if not product:
        await query.edit_message_text("Product not found.", reply_markup=back_to_menu_keyboard())
        return

    merchant = await sb_get_one("merchants", f"select=name&id=eq.{product['merchant_id']}")
    merchant_name = merchant["name"] if merchant else "Unknown"

    context.user_data[f"qty_{product_id}"] = 1

    stock_text = f"In Stock ({product['stock']})" if product["stock"] > 0 else "Out of Stock"
    rating_avg = product.get("rating_avg") or 0
    review_count = product.get("review_count") or 0
    rating_text = f"{rating_avg:.1f}/5 ({review_count} reviews)" if review_count > 0 else "No reviews yet"

    text = (
        f"**{product['name']}**\n"
        f"{merchant_name}\n\n"
        f"**${float(product['base_price']):.2f}**\n"
        f"{stock_text}\n"
        f"Delivery: ~{product.get('delivery_days', 'N/A')} days\n"
        f"{rating_text}\n"
    )
    if product.get("description"):
        text += f"\n{product['description']}"

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=product_detail_keyboard(product_id, product["merchant_id"])
    )
