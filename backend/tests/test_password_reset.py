"""Forgot password: a one-time, 30-minute reset link sent to the account's Telegram.

Covers: who gets a link (active accounts with Telegram), the reply never revealing whether an email
exists, the link working exactly once, expiry, tampering, a reset token never passing as a login
token (and the other way round), and the activity-log entry.
"""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest

from app.core.constants import Role
from app.core.exceptions import BadRequestError
from app.core.security import InvalidTokenError, hash_password, mint_jwt, verify_jwt, verify_password
from app.routes import auth as auth_route
from app.services import audit, password_reset

OLD = hash_password("old-password-1")


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.tests = db, table, []

    def eq(self, col, val):
        self.tests.append(lambda r: r.get(col) == val)
        return self

    def ilike(self, col, pattern):
        self.tests.append(lambda r: (r.get(col) or "").lower() == pattern.lower())
        return self

    def _rows(self):
        return [r for r in self.db.tables.get(self.table, []) if all(t(r) for t in self.tests)]

    async def select(self, *_):
        await asyncio.sleep(0)
        return [dict(r) for r in self._rows()]

    async def select_one(self, *_):
        rows = await self.select()
        return rows[0] if rows else None

    async def update(self, data):
        await asyncio.sleep(0)
        rows = self._rows()
        for r in rows:
            r.update(data)
        return [dict(r) for r in rows]


class FakeDB:
    def __init__(self):
        self.tables = {
            "merchant_admins": [
                {"id": 3, "merchant_id": 3, "full_name": "Justin", "email": "justin@bloom.test", "role": "owner",
                 "password_hash": OLD, "telegram_id": 376388098, "is_active": True},
                {"id": 6, "merchant_id": 5, "full_name": "Demo Staff", "email": "staff@ite.test", "role": "staff",
                 "password_hash": OLD, "telegram_id": None, "is_active": True},
                {"id": 8, "merchant_id": 5, "full_name": "Gone", "email": "gone@ite.test", "role": "staff",
                 "password_hash": OLD, "telegram_id": 111, "is_active": False},
            ],
            "super_admins": [
                {"id": 1, "full_name": "Nadra", "email": "nadra@byme24.test", "password_hash": OLD,
                 "telegram_id": 5847427348, "is_active": True},
            ],
        }

    def from_(self, table):
        return Query(self, table)

    def row(self, table, id_):
        return next(r for r in self.tables[table] if r["id"] == id_)


def sender():
    sent = []

    async def send(telegram_id, text):
        sent.append((telegram_id, text))
        return True
    return sent, send


def token_in(text):
    return text.split("token=")[1].split('"')[0]


# ── Asking for a link ───────────────────────────────────────────

def test_link_goes_to_the_accounts_telegram():
    db, (sent, send) = FakeDB(), sender()
    assert asyncio.run(password_reset.request_reset(db, "  Justin@Bloom.test ", send)) == 1
    (tg, text), = sent
    assert tg == 376388098 and "/reset-password?token=" in text and "30 minutes" in text


def test_platform_admins_can_reset_too():
    db, (sent, send) = FakeDB(), sender()
    assert asyncio.run(password_reset.request_reset(db, "nadra@byme24.test", send)) == 1
    assert sent[0][0] == 5847427348


@pytest.mark.parametrize("email", ["staff@ite.test", "gone@ite.test", "nobody@nowhere.test", ""])
def test_no_link_without_telegram_for_inactive_or_unknown_accounts(email):
    db, (sent, send) = FakeDB(), sender()
    assert asyncio.run(password_reset.request_reset(db, email, send)) == 0
    assert sent == []


def test_the_reply_is_the_same_whether_or_not_the_email_exists(monkeypatch):
    db = FakeDB()

    @asynccontextmanager
    async def service_role():
        yield db

    async def send(tg, text):
        return True

    monkeypatch.setattr(auth_route.SupabaseClient, "service_role", service_role)
    monkeypatch.setattr(auth_route, "_telegram_send", send)
    call = auth_route.forgot_password.__wrapped__
    known = asyncio.run(call(None, auth_route.ForgotPasswordRequest(email="justin@bloom.test")))
    unknown = asyncio.run(call(None, auth_route.ForgotPasswordRequest(email="nobody@nowhere.test")))
    assert known == unknown


# ── Using the link ──────────────────────────────────────────────

def _link_for(db, email="justin@bloom.test"):
    sent, send = sender()
    asyncio.run(password_reset.request_reset(db, email, send))
    return token_in(sent[0][1])


def test_the_link_sets_a_new_password_once():
    db = FakeDB()
    token = _link_for(db)
    done = asyncio.run(password_reset.reset_password(db, token, "new-password-2"))
    assert done["kind"] == "merchant_admin" and done["account"]["id"] == 3
    assert verify_password("new-password-2", db.row("merchant_admins", 3)["password_hash"])

    with pytest.raises(BadRequestError):  # used once: the password it was made for is gone
        asyncio.run(password_reset.reset_password(db, token, "another-password-3"))
    assert verify_password("new-password-2", db.row("merchant_admins", 3)["password_hash"])


def test_an_older_link_dies_when_a_newer_one_is_used():
    db = FakeDB()
    first, second = _link_for(db), _link_for(db)
    asyncio.run(password_reset.reset_password(db, second, "new-password-2"))
    with pytest.raises(BadRequestError):
        asyncio.run(password_reset.reset_password(db, first, "new-password-3"))


def test_two_tabs_cannot_both_use_one_link():
    db = FakeDB()
    token = _link_for(db)

    async def both():
        return await asyncio.gather(password_reset.reset_password(db, token, "tab-one-pass"),
                                    password_reset.reset_password(db, token, "tab-two-pass"),
                                    return_exceptions=True)

    results = asyncio.run(both())
    assert sum(isinstance(r, BadRequestError) for r in results) == 1


def test_expired_link():
    db = FakeDB()
    account = db.row("merchant_admins", 3)
    old = password_reset.make_token("merchant_admin", account, now=datetime.now(timezone.utc) - timedelta(minutes=31))
    with pytest.raises(BadRequestError):
        asyncio.run(password_reset.reset_password(db, old, "new-password-2"))


def test_tampered_link():
    db = FakeDB()
    token = _link_for(db)
    with pytest.raises(BadRequestError):
        asyncio.run(password_reset.reset_password(db, token[:-3] + ("AAA" if token[-3:] != "AAA" else "BBB"), "new-password-2"))


def test_deactivated_account_cannot_reset():
    db = FakeDB()
    token = _link_for(db)
    db.row("merchant_admins", 3)["is_active"] = False
    with pytest.raises(BadRequestError):
        asyncio.run(password_reset.reset_password(db, token, "new-password-2"))


def test_a_reset_token_is_not_a_login_token_and_the_other_way_round():
    db = FakeDB()
    token = _link_for(db)
    with pytest.raises(InvalidTokenError):
        verify_jwt(token)
    login = mint_jwt(sub="3", role=Role.MERCHANT_ADMIN, merchant_id=3)
    with pytest.raises(BadRequestError):
        password_reset.read_token(login)


def test_the_reset_is_logged_and_announced(monkeypatch):
    db = FakeDB()
    token = _link_for(db)
    logged, sent = [], []

    @asynccontextmanager
    async def service_role():
        yield db

    async def record(db_, user, **kw):
        logged.append({"user": user, **kw})

    async def send(tg, text):
        sent.append(tg)
        return True

    monkeypatch.setattr(auth_route.SupabaseClient, "service_role", service_role)
    monkeypatch.setattr(audit, "record", record)
    monkeypatch.setattr(auth_route, "_telegram_send", send)
    out = asyncio.run(auth_route.reset_password.__wrapped__(None, auth_route.ResetPasswordRequest(token=token, new_password="new-password-2")))
    assert out["success"] is True
    assert logged[0]["action"] == "account.password_reset" and logged[0]["merchant_id"] == 3 and logged[0]["user"] is None
    assert "account.password_reset" in audit.ACTIONS
    assert sent == [376388098]


def test_short_password_is_refused():
    with pytest.raises(Exception):
        auth_route.ResetPasswordRequest(token="x" * 30, new_password="short")
