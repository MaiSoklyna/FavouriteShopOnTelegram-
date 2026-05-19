"""Register the Telegram webhook URL with Telegram.

Run this ONCE after you deploy the backend. Re-run any time the backend URL
changes or you rotate ``TELEGRAM_WEBHOOK_SECRET``.

Usage:
    python set_webhook.py https://your-backend.vercel.app
    python set_webhook.py https://your-backend.vercel.app --secret mysecret

The endpoint registered is always ``<base>/api/telegram/webhook``.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from telegram import Bot

from app.config import settings


async def main(base_url: str, secret: str | None) -> None:
    base = base_url.rstrip("/")
    if not base.startswith("https://"):
        print("ERROR: Telegram only accepts HTTPS webhook URLs.")
        sys.exit(2)

    webhook_url = f"{base}/api/telegram/webhook"

    async with Bot(token=settings.TELEGRAM_BOT_TOKEN) as bot:
        ok = await bot.set_webhook(
            url=webhook_url,
            secret_token=secret or None,
            drop_pending_updates=True,
            allowed_updates=["message", "callback_query"],
        )
        info = await bot.get_webhook_info()

    print(f"set_webhook returned: {ok}")
    print(f"Webhook URL:          {info.url}")
    print(f"Pending updates:      {info.pending_update_count}")
    if info.last_error_message:
        print(f"Last error:           {info.last_error_message}")
    else:
        print("No prior errors. Bot is ready to receive updates.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_url", help="Backend base URL, e.g. https://my-backend.vercel.app")
    parser.add_argument(
        "--secret",
        default=settings.TELEGRAM_WEBHOOK_SECRET or None,
        help="Optional secret token. Defaults to TELEGRAM_WEBHOOK_SECRET from .env.",
    )
    args = parser.parse_args()
    asyncio.run(main(args.base_url, args.secret))
