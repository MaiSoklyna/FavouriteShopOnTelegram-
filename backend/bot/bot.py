import logging
from telegram import BotCommand
from telegram.ext import ApplicationBuilder, CommandHandler, CallbackQueryHandler, MessageHandler, filters
from app.config import settings

from bot.handlers.start import start_command, help_command, main_menu_callback, dash_role_callback
from bot.handlers.browse import browse_shops, view_shop, view_category_products, view_all_products, view_product
from bot.handlers.cart import (
    add_to_cart, view_cart, remove_from_cart, clear_cart,
    checkout_start, handle_checkout_text, confirm_address, new_address, confirm_order_cod
)
from bot.handlers.order import my_orders, view_order, cancel_order
from bot.handlers.support import my_profile, support

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)


_BOT_COMMANDS = [
    BotCommand("start", "Open the main menu"),
    BotCommand("orders", "View your orders"),
    BotCommand("cart", "View your cart"),
    BotCommand("profile", "Your account & addresses"),
    BotCommand("support", "Contact support"),
    BotCommand("help", "How to use this bot"),
]


async def _post_init(app):
    """Register the command menu so commands show in Telegram's '/' list."""
    try:
        await app.bot.set_my_commands(_BOT_COMMANDS)
    except Exception as e:
        logger.warning("set_my_commands failed: %s", e)


def create_bot_app():
    """Create and configure the Telegram bot application."""
    app = ApplicationBuilder().token(settings.TELEGRAM_BOT_TOKEN).post_init(_post_init).build()

    # === Command Handlers ===
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("orders", my_orders))
    app.add_handler(CommandHandler("cart", view_cart))
    app.add_handler(CommandHandler("profile", my_profile))
    app.add_handler(CommandHandler("support", support))

    # === Callback Query Handlers (order matters for pattern matching!) ===

    # Dashboard role selection (must be before main_menu)
    app.add_handler(CallbackQueryHandler(dash_role_callback, pattern=r"^dash_role_"))

    # Main Menu
    app.add_handler(CallbackQueryHandler(main_menu_callback, pattern="^main_menu$"))

    # Browse / Shopping
    app.add_handler(CallbackQueryHandler(browse_shops, pattern="^browse_shops$"))
    app.add_handler(CallbackQueryHandler(view_shop, pattern=r"^shop_\d+$"))
    app.add_handler(CallbackQueryHandler(view_category_products, pattern=r"^cat_\d+_\d+$"))
    app.add_handler(CallbackQueryHandler(view_all_products, pattern=r"^allprod_\d+$"))
    app.add_handler(CallbackQueryHandler(view_product, pattern=r"^prod_\d+$"))

    # Cart
    app.add_handler(CallbackQueryHandler(add_to_cart, pattern=r"^addcart_\d+"))
    app.add_handler(CallbackQueryHandler(view_cart, pattern="^view_cart$"))
    app.add_handler(CallbackQueryHandler(remove_from_cart, pattern=r"^rmcart_\d+$"))
    app.add_handler(CallbackQueryHandler(clear_cart, pattern="^clear_cart$"))

    # Checkout
    app.add_handler(CallbackQueryHandler(checkout_start, pattern="^checkout_start$"))
    app.add_handler(CallbackQueryHandler(confirm_address, pattern="^confirm_address$"))
    app.add_handler(CallbackQueryHandler(new_address, pattern="^new_address$"))
    app.add_handler(CallbackQueryHandler(confirm_order_cod, pattern="^confirm_cod$"))

    # Orders
    app.add_handler(CallbackQueryHandler(my_orders, pattern="^my_orders$"))
    app.add_handler(CallbackQueryHandler(view_order, pattern=r"^order_\d+$"))
    app.add_handler(CallbackQueryHandler(cancel_order, pattern=r"^cancel_order_\d+$"))

    # Profile & Support
    app.add_handler(CallbackQueryHandler(my_profile, pattern="^my_profile$"))
    app.add_handler(CallbackQueryHandler(support, pattern="^support$"))

    # === Text Message Handler (for checkout address input) ===
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_checkout_text))

    return app


def run_bot():
    """Run the bot with polling (for development)."""
    logger.info("Starting Favourite of Shop Bot...")
    app = create_bot_app()
    logger.info("Bot is running! Press Ctrl+C to stop.")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    run_bot()
