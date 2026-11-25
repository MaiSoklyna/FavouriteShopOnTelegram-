"""Accept / Reject taps on new-order messages in a shop's Telegram order group.

All the rules live in app.services.order_group; this only passes the tap on and answers it.
"""

from __future__ import annotations

import logging

from telegram import Update
from telegram.ext import ContextTypes

from app.db.client import SupabaseClient
from app.services import order_group

logger = logging.getLogger(__name__)


async def order_action_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if not query or not query.message:
        return
    try:
        async with SupabaseClient.service_role() as db:
            result = await order_group.apply_tap(
                db, chat_id=query.message.chat.id, message_id=query.message.message_id,
                telegram_id=query.from_user.id, data=query.data,
            )
        await query.answer((result.get("answer") or "")[:200], show_alert=bool(result.get("alert")))
    except Exception:
        logger.exception("Order action tap failed: %s", query.data)
        try:
            await query.answer("Something went wrong. Please use the dashboard for this order.", show_alert=True)
        except Exception:
            pass
