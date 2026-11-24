"""POST /api/telegram/webhook: a bot that cannot start must not make Telegram resend updates."""

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.routes import telegram_webhook


def test_bot_start_failure_still_answers_ok(monkeypatch):
    async def failing_start():
        raise RuntimeError("Too Many Requests: retry after 32")

    monkeypatch.setattr(telegram_webhook, "_get_bot_app", failing_start)
    headers = {"X-Telegram-Bot-Api-Secret-Token": settings.TELEGRAM_WEBHOOK_SECRET or ""}
    r = TestClient(app).post("/api/telegram/webhook", json={"update_id": 1}, headers=headers)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "skipped": "bot unavailable"}


def test_wrong_secret_is_rejected_before_the_bot_starts(monkeypatch):
    if not settings.TELEGRAM_WEBHOOK_SECRET:
        return
    started = []

    async def start():
        started.append(1)

    monkeypatch.setattr(telegram_webhook, "_get_bot_app", start)
    r = TestClient(app).post("/api/telegram/webhook", json={"update_id": 1},
                             headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"})
    assert r.status_code == 403 and not started
