"""A webhook cold start must not call Telegram (no getMe), so it cannot renew a rate limit."""

import asyncio
import json

from fastapi.testclient import TestClient
from telegram.request import HTTPXRequest

from app.config import settings
from app.main import app
from app.routes import telegram_webhook
from bot.bot import bot_identity_from_settings

BOT_ID = 123456789


def _record_telegram_calls(monkeypatch):
    """Replace the bot's HTTP layer: record each Bot API method, never touch the network."""
    calls: list[str] = []

    async def fake_do_request(self, url, method, request_data=None, *args, **kwargs):
        name = url.rsplit("/", 1)[-1]
        calls.append(name)
        if name == "sendMessage":
            result = {"message_id": 1, "date": 0, "chat": {"id": 42, "type": "private"}, "text": "hi"}
            return 200, json.dumps({"ok": True, "result": result}).encode()
        return 429, json.dumps({"ok": False, "error_code": 429, "description": "Too Many Requests: retry after 32",
                                "parameters": {"retry_after": 32}}).encode()

    monkeypatch.setattr(HTTPXRequest, "do_request", fake_do_request)
    return calls


def _configure(monkeypatch, username="FavouriteShopBot"):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", f"{BOT_ID}:test-token")
    monkeypatch.setattr(settings, "TELEGRAM_BOT_USERNAME", username)
    monkeypatch.setattr(telegram_webhook, "_bot_app", None)


def test_cold_start_processes_update_without_get_me(monkeypatch):
    _configure(monkeypatch)
    calls = _record_telegram_calls(monkeypatch)

    # A callback no handler matches: it goes through process_update without touching the DB.
    update = {"update_id": 7, "callback_query": {
        "id": "1", "chat_instance": "c", "data": "unmatched",
        "from": {"id": 42, "is_bot": False, "first_name": "A"}}}
    headers = {"X-Telegram-Bot-Api-Secret-Token": settings.TELEGRAM_WEBHOOK_SECRET or ""}
    r = TestClient(app).post("/api/telegram/webhook", json=update, headers=headers)

    assert r.status_code == 200 and r.json() == {"ok": True}
    assert calls == [], f"cold start called Telegram: {calls}"
    bot = telegram_webhook._bot_app.bot
    assert bot.id == BOT_ID and bot.username == "FavouriteShopBot"

    # Replies still go out normally once the bot is up.
    asyncio.run(bot.send_message(chat_id=42, text="hi"))
    assert calls == ["sendMessage"]


def test_identity_needs_username():
    original = settings.TELEGRAM_BOT_USERNAME
    try:
        settings.TELEGRAM_BOT_USERNAME = ""
        assert bot_identity_from_settings() is None
        settings.TELEGRAM_BOT_USERNAME = "@SomeBot"
        assert bot_identity_from_settings().username == "SomeBot"
    finally:
        settings.TELEGRAM_BOT_USERNAME = original
