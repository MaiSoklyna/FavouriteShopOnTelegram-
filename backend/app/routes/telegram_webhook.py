"""Telegram webhook endpoint — runs the bot on Vercel without polling.

Telegram POSTs each update to ``/api/telegram/webhook``. We hand the JSON
straight to the python-telegram-bot Application which dispatches it to
the registered handlers (the same handlers polling would use).

Each Vercel cold start lazily builds and initializes the Application;
the warm container reuses it across updates. Because all bot state lives
in Supabase, having a fresh Application per cold start is fine.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Header
from telegram import Update
from telegram.ext import Application

from app.config import settings
from bot.bot import create_bot_app

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/telegram", tags=["Telegram Webhook"])

_bot_app: Optional[Application] = None
_bot_lock = asyncio.Lock()


async def _get_bot_app() -> Application:
    """Build + initialize the bot Application once per process."""
    global _bot_app
    if _bot_app is not None:
        return _bot_app
    async with _bot_lock:
        if _bot_app is None:
            app = create_bot_app()
            await app.initialize()
            _bot_app = app
    return _bot_app


@router.post("/webhook")
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
):
    """Receive updates from Telegram and dispatch them to bot handlers."""
    expected_secret = settings.TELEGRAM_WEBHOOK_SECRET
    if expected_secret and x_telegram_bot_api_secret_token != expected_secret:
        logger.warning("Rejected webhook with bad secret token")
        raise HTTPException(status_code=403, detail="Invalid secret token")

    try:
        body = await request.json()
    except Exception as e:
        logger.warning("Webhook body was not valid JSON: %s", e)
        raise HTTPException(status_code=400, detail="Invalid JSON")

    bot_app = await _get_bot_app()
    update = Update.de_json(body, bot_app.bot)
    if update is None:
        return {"ok": True, "skipped": "non-update payload"}

    try:
        await bot_app.process_update(update)
    except Exception:
        logger.exception("process_update failed for update_id=%s", getattr(update, "update_id", "?"))
        # Always 200 back to Telegram so it doesn't retry the same bad update
        # forever. The error is logged for investigation.
        return {"ok": True, "error": "handler exception"}

    return {"ok": True}


@router.get("/info")
async def webhook_info():
    """Return Telegram's current webhook status — useful for debugging."""
    bot_app = await _get_bot_app()
    info = await bot_app.bot.get_webhook_info()
    return {
        "url": info.url,
        "has_custom_certificate": info.has_custom_certificate,
        "pending_update_count": info.pending_update_count,
        "last_error_date": info.last_error_date.isoformat() if info.last_error_date else None,
        "last_error_message": info.last_error_message,
        "max_connections": info.max_connections,
        "allowed_updates": info.allowed_updates,
    }
