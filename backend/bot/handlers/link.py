"""/link CODE — connect a Telegram group to a shop as its order-notification group.

The shop owner gets the code in Shop setup → Telegram, adds the bot to the group and sends
`/link@<bot> CODE` there (bots in privacy mode receive commands addressed to them in groups).
The code is checked by app.services.shop_setup.link_group, which saves the group on the shop.
"""

from __future__ import annotations

import logging

from telegram import Update
from telegram.ext import ContextTypes

from app.db.client import SupabaseClient
from app.services import shop_setup

logger = logging.getLogger(__name__)


async def link_group_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat = update.effective_chat
    message = update.effective_message
    if not chat or not message:
        return
    code = (context.args[0] if context.args else "").strip()
    if not code:
        await message.reply_text("Send /link followed by the code from Shop setup → Telegram, e.g. /link 4F7K2Q")
        return
    if chat.type not in ("group", "supergroup"):
        await message.reply_text("Send this in your shop's order group (add me to the group first), not in a private chat.")
        return
    try:
        async with SupabaseClient.service_role() as db:
            result = await shop_setup.link_group(db, code, chat.id, chat.title)
    except Exception:
        logger.exception("Group link failed for chat %s", chat.id)
        await message.reply_text("Something went wrong. Please try again in a minute.")
        return
    await message.reply_text(result["message"])
