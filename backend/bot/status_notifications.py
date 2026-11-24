"""Telegram push for order status changes (shipped, delivered, cancelled).

Best-effort like the rest of bot/notifications.py: it never raises, because a failed message must
not undo the status change it is announcing.
"""

from __future__ import annotations

import html
import logging

from telegram import Bot, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.constants import ParseMode

from app.config import settings
from bot.notifications import _order_keyboard

logger = logging.getLogger(__name__)


async def send_order_status_to_customer(
    telegram_id: int | None,
    *,
    order_id: int,
    order_code: str,
    title: str,
    body: str,
    user_id: int | None = None,
    button: str = "View Order",
) -> bool:
    """DM the customer a one-line order update with a button to the order. Never raises."""
    if not telegram_id:
        return False
    text = f"<b>{html.escape(title)}</b> — {html.escape(order_code)}\n{html.escape(body)}"
    try:
        keyboard = _order_keyboard(telegram_id, order_id, user_id, button)
        async with Bot(token=settings.TELEGRAM_BOT_TOKEN) as bot:
            await bot.send_message(
                chat_id=telegram_id, text=text, parse_mode=ParseMode.HTML,
                reply_markup=keyboard, disable_web_page_preview=True,
            )
        logger.info("Status DM sent to telegram_id=%s for order=%s", telegram_id, order_code)
        return True
    except Exception as exc:
        logger.warning("Status DM failed for telegram_id=%s order=%s: %s", telegram_id, order_code, exc)
        return False


async def send_driver_message(telegram_id: int | None, *, title: str, body: str) -> bool:
    """DM a driver with a button that opens their delivery list. Never raises."""
    if not telegram_id:
        return False
    text = f"<b>{html.escape(title)}</b>\n{html.escape(body)}"
    url = f"{settings.web_app_base}/shop/driver"
    # Telegram only accepts Web App buttons over https; plain URL button in local dev
    button = (InlineKeyboardButton("Open deliveries", web_app=WebAppInfo(url=url)) if url.startswith("https://")
              else InlineKeyboardButton("Open deliveries", url=url))
    try:
        async with Bot(token=settings.TELEGRAM_BOT_TOKEN) as bot:
            await bot.send_message(chat_id=telegram_id, text=text, parse_mode=ParseMode.HTML,
                                   reply_markup=InlineKeyboardMarkup([[button]]), disable_web_page_preview=True)
        return True
    except Exception as exc:
        logger.warning("Driver DM failed for telegram_id=%s: %s", telegram_id, exc)
        return False
