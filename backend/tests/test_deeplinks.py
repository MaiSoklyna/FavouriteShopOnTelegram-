"""Product and shop deep links: t.me/<bot>?startapp=p_123 / s_45 (Mini App) and ?start= (bot chat)."""

import asyncio
from types import SimpleNamespace

import pytest

from app.services import deeplinks
from bot.handlers import start as start_handler


@pytest.mark.parametrize("param, expected", [
    ("p_123", ("product", 123)),
    ("s_45", ("shop", 45)),
    (" p_7 ", ("product", 7)),
    ("p_0", None), ("p_", None), ("p_abc", None), ("x_1", None), ("p_1_2", None),
    ("p_12345678901", None),                     # longer than any id
    ("shop_Xk2abc", None), ("dash_Xk2abc", None),   # login sessions are not deep links
    ("", None), (None, None), ("p_1; drop", None),
])
def test_parse(param, expected):
    assert deeplinks.parse(param) == expected


def test_links_and_paths(monkeypatch):
    monkeypatch.setattr(deeplinks.settings, "TELEGRAM_BOT_USERNAME", "@byme24_bot")
    assert deeplinks.link("product", 123) == "https://t.me/byme24_bot?startapp=p_123"
    assert deeplinks.link("shop", 45) == "https://t.me/byme24_bot?startapp=s_45"
    assert deeplinks.link("product", 123, chat=True) == "https://t.me/byme24_bot?start=p_123"
    assert deeplinks.shop_path("product", 123) == "/shop/product/123"
    assert deeplinks.shop_path("shop", 45) == "/shop/merchant/45"
    # every link the builder makes parses back to what it was made from
    for kind, i in (("product", 9), ("shop", 31)):
        assert deeplinks.parse(deeplinks.link(kind, i).split("=", 1)[1]) == (kind, i)


# ── The bot's answer to /start p_123 ────────────────────────────

class Message:
    def __init__(self):
        self.replies = []

    async def reply_text(self, text, **kw):
        self.replies.append((text, kw))


def fake_db(monkeypatch, rows):
    async def sb_get_one(table, query):
        target = int(query.rsplit("id=eq.", 1)[1])
        return next((r for r in rows.get(table, []) if r["id"] == target), None)
    monkeypatch.setattr(start_handler, "sb_get_one", sb_get_one)
    monkeypatch.setattr(start_handler.settings, "WEB_APP_URL", "https://shop.example")


ROWS = {
    "products": [{"id": 10, "name": "T-shirt", "is_active": True, "merchant_id": 3},
                 {"id": 20, "name": "Cheesecake", "is_active": True, "merchant_id": 2},
                 {"id": 30, "name": "Old tee", "is_active": False, "merchant_id": 3}],
    "merchants": [{"id": 3, "name": "Bloom & Co.", "status": "active", "setup_completed_at": "2026-01-01"},
                  {"id": 2, "name": "New Bakery", "status": "active", "setup_completed_at": None}],
}


def open_link(monkeypatch, kind, target):
    fake_db(monkeypatch, ROWS)
    msg = Message()
    update = SimpleNamespace(message=msg)
    asyncio.run(start_handler._open_deep_link(update, {"id": 7}, 777, kind, target))
    (text, kw), = msg.replies
    button = kw["reply_markup"].inline_keyboard[0][0] if "reply_markup" in kw else None
    return text, button


def test_product_link_opens_the_product(monkeypatch):
    text, button = open_link(monkeypatch, "product", 10)
    assert "T-shirt" in text and button.text == "Open product"
    assert button.web_app.url.startswith("https://shop.example/shop/product/10?auth=")


def test_shop_link_opens_the_shop(monkeypatch):
    text, button = open_link(monkeypatch, "shop", 3)
    assert "Bloom" in text and button.text == "Open shop"
    assert button.web_app.url.startswith("https://shop.example/shop/merchant/3?auth=")


@pytest.mark.parametrize("kind, target", [
    ("product", 20),    # its shop is not live yet
    ("product", 30),    # switched off
    ("product", 999),   # gone
    ("shop", 2),        # not live yet
    ("shop", 999),
])
def test_unavailable_targets_fall_back_to_the_shop_home(monkeypatch, kind, target):
    text, button = open_link(monkeypatch, kind, target)
    assert "no longer works" in text and button.text == "Open Shop"
    assert button.web_app.url.startswith("https://shop.example/shop?auth=")


def test_start_sends_deep_links_and_logins_to_the_right_place(monkeypatch):
    calls = []

    async def upsert(*a, **k):
        return {"id": 7}, False

    async def deep(update, db_user, tg, kind, target):
        calls.append(("deep", kind, target))

    async def login(session_id, user_id, token):
        calls.append(("login", session_id))

    monkeypatch.setattr(start_handler, "_upsert_user", upsert)
    monkeypatch.setattr(start_handler, "_open_deep_link", deep)
    monkeypatch.setattr(start_handler, "_complete_login_session", login)
    for arg in ("p_10", "s_3", "shop_AbC123"):
        msg = Message()
        update = SimpleNamespace(message=msg, effective_user=SimpleNamespace(id=777, username="ana", first_name="Ana", last_name=""))
        asyncio.run(start_handler.start_command(update, SimpleNamespace(args=[arg])))
    assert calls == [("deep", "product", 10), ("deep", "shop", 3), ("login", "shop_AbC123")]
