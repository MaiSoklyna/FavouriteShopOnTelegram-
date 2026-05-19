"""Best-effort Telegram notifications callable from the API process.

The API runs on Vercel (serverless) and the bot polling loop runs elsewhere
(Railway). When the API needs to push a Telegram message — e.g. confirming
a freshly placed order — it constructs an ad-hoc Bot client using the same
token and sends directly via the Telegram HTTP API.

All helpers swallow exceptions: a failed notification must never roll back
the order it's confirming.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Iterable

from telegram import Bot, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.constants import ParseMode

from app.config import settings

logger = logging.getLogger(__name__)


def _format_items(items: Iterable[dict]) -> str:
    lines = []
    for item in items:
        qty = item.get("quantity", 0)
        unit = float(item.get("unit_price", 0))
        sub = float(item.get("subtotal", qty * unit))
        name = item.get("product_name") or "Item"
        lines.append(f"  • {name} × {qty} — ${sub:.2f}")
    return "\n".join(lines) if lines else "  (no items)"


async def send_order_placed_to_customer(
    telegram_id: int,
    *,
    order_id: int,
    order_code: str,
    merchant_name: str,
    items: list[dict],
    subtotal: float,
    discount: float,
    delivery_fee: float,
    total: float,
    payment_method: str,
    delivery_address: str,
) -> bool:
    """DM the customer after their order is created.

    Returns True if the message was sent, False otherwise. Never raises.
    """
    if not telegram_id:
        return False

    text = (
        f"<b>Order placed</b> — {order_code}\n"
        f"<b>Shop:</b> {merchant_name}\n\n"
        f"<b>Items</b>\n{_format_items(items)}\n\n"
        f"Subtotal: ${subtotal:.2f}\n"
    )
    if discount > 0:
        text += f"Discount: −${discount:.2f}\n"
    text += f"Delivery: {'FREE' if delivery_fee == 0 else f'${delivery_fee:.2f}'}\n"
    text += f"<b>Total: ${total:.2f}</b>\n\n"
    text += f"Payment: {payment_method.upper()}\n"
    text += f"Delivery to: {delivery_address}\n"

    review_url = f"{settings.WEB_APP_URL}/shop/order/{order_id}"
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("View Order", url=review_url)],
        [InlineKeyboardButton("Shop Again", url=f"{settings.WEB_APP_URL}/shop")],
    ])

    try:
        async with Bot(token=settings.TELEGRAM_BOT_TOKEN) as bot:
            await bot.send_message(
                chat_id=telegram_id,
                text=text,
                parse_mode=ParseMode.HTML,
                reply_markup=keyboard,
                disable_web_page_preview=True,
            )
        logger.info("Order DM sent to telegram_id=%s for order=%s", telegram_id, order_code)
        return True
    except Exception as e:
        logger.warning("Order DM failed for telegram_id=%s order=%s: %s", telegram_id, order_code, e)
        return False


async def send_order_placed_to_merchant_group(
    chat_id: int,
    *,
    order_id: int,
    order_code: str,
    merchant_name: str,
    items: list[dict],
    total: float,
    payment_method: str,
    delivery_address: str,
    customer_name: str | None,
    customer_phone: str | None,
) -> bool:
    """Post a new-order summary to the merchant's configured Telegram group.

    Returns True if the message was sent, False otherwise. Never raises.
    """
    if not chat_id:
        return False

    text = (
        f"<b>🛒 New order</b> — {order_code}\n"
        f"<b>Shop:</b> {merchant_name}\n\n"
        f"<b>Items</b>\n{_format_items(items)}\n\n"
        f"<b>Total: ${total:.2f}</b>\n"
        f"Payment: {payment_method.upper()}\n\n"
        f"<b>Deliver to</b>\n"
    )
    if customer_name:
        text += f"  {customer_name}\n"
    if customer_phone:
        text += f"  {customer_phone}\n"
    text += f"  {delivery_address}\n\n"
    text += f"<a href=\"{settings.ADMIN_PANEL_URL}/orders\">Open in dashboard</a>"

    try:
        async with Bot(token=settings.TELEGRAM_BOT_TOKEN) as bot:
            await bot.send_message(
                chat_id=chat_id,
                text=text,
                parse_mode=ParseMode.HTML,
                disable_web_page_preview=True,
            )
        logger.info("Order group notification sent chat_id=%s order=%s", chat_id, order_code)
        return True
    except Exception as e:
        logger.warning("Order group notification failed chat_id=%s order=%s: %s", chat_id, order_code, e)
        return False
