from telegram import Update
from telegram.ext import ContextTypes
from bot.supabase_helpers import sb_get, sb_get_one
from bot.keyboards.inline import back_to_menu_keyboard
from bot.handlers._shared import ack_if_callback, send_or_edit
import logging

logger = logging.getLogger(__name__)


async def my_profile(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show user profile."""
    await ack_if_callback(update)

    telegram_id = update.effective_user.id
    user = await sb_get_one(
        "users",
        f"select=id,telegram_id,username,first_name,last_name,phone,address,created_at&telegram_id=eq.{telegram_id}"
    )
    if not user:
        await send_or_edit(update, "Please /start first.", reply_markup=back_to_menu_keyboard())
        return

    orders = await sb_get("orders", f"select=id&user_id=eq.{user['id']}")
    order_count = len(orders)

    text = f"**Your Profile**\n\n"
    text += f"Username: @{user.get('username', 'N/A')}\n"
    text += f"Telegram ID: `{user['telegram_id']}`\n"

    name = f"{user.get('first_name', '')} {user.get('last_name', '')}".strip()
    if name:
        text += f"Name: {name}\n"
    if user.get("phone"):
        text += f"Phone: {user['phone']}\n"
    if user.get("address"):
        text += f"Address: {user['address']}\n"

    text += f"\nTotal Orders: {order_count}\n"

    created = user.get("created_at", "N/A")
    if isinstance(created, str) and len(created) >= 10:
        created = created[:10]
    text += f"Joined: {created}"

    await send_or_edit(update, text, parse_mode="Markdown", reply_markup=back_to_menu_keyboard())


async def support(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show support info."""
    await ack_if_callback(update)

    text = (
        "**Customer Support**\n\n"
        "Need help? Here's how to reach us:\n\n"
        "Send your question directly in this chat\n"
        "Or contact us at support@favouriteofshop.com\n\n"
        "Our team will respond as soon as possible!"
    )

    await send_or_edit(update, text, parse_mode="Markdown", reply_markup=back_to_menu_keyboard())
