"""Telegram deep links to a product or a shop.

    https://t.me/<bot>?startapp=p_123   opens the Mini App straight on product 123
    https://t.me/<bot>?startapp=s_45    opens the Mini App on shop 45
    https://t.me/<bot>?start=p_123      (chat link) the bot answers with an "Open product" button

`startapp` is handled by the Mini App itself (Telegram passes the value as start_param, see
frontend/src/lib/deeplink.ts); `start` arrives here, in the bot's /start command. Both use the same
parameter format. Telegram allows [A-Za-z0-9_-], up to 64 characters for `start`.

The prefixes never collide with the login-session ids that /start also receives: those start with
"dash_" (dashboard) or "shop_" (customer web login).
"""

from __future__ import annotations

import re

from app.config import settings

_PATTERN = re.compile(r"^(p|s)_([1-9]\d{0,9})$")
KINDS = {"p": "product", "s": "shop"}


def parse(param: str | None) -> tuple[str, int] | None:
    """("product", 123) / ("shop", 45), or None if `param` is not a deep link."""
    m = _PATTERN.match((param or "").strip())
    return (KINDS[m.group(1)], int(m.group(2))) if m else None


def shop_path(kind: str, target_id: int) -> str:
    """Where a deep link lands in the shop app."""
    return f"/shop/product/{target_id}" if kind == "product" else f"/shop/merchant/{target_id}"


def bot_username() -> str:
    return (settings.TELEGRAM_BOT_USERNAME or "byme24_bot").lstrip("@")


def link(kind: str, target_id: int, *, chat: bool = False) -> str:
    """The t.me link for a product or shop. `chat=True` gives the ?start= variant (opens the bot chat)."""
    prefix = "p" if kind == "product" else "s"
    return f"https://t.me/{bot_username()}?{'start' if chat else 'startapp'}={prefix}_{int(target_id)}"
