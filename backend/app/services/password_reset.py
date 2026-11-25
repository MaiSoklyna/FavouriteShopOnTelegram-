"""Forgot password for dashboard accounts (shop owners, managers, staff and platform admins).

There is no email service, but every dashboard account can have a Telegram account linked
(the same one used for "Log in with Telegram"). A reset link is sent there by the bot.

The link carries a signed token, so no table is needed:
- it is signed with a key derived from SUPABASE_JWT_SECRET that is used for nothing else, so a reset
  token can never pass as a login token (and a login token can never pass as a reset token);
- it names the account and expires after RESET_TTL_MINUTES;
- it holds a fingerprint of the account's current password hash, so it stops working the moment the
  password changes: the link works once, and an older link dies when a newer one is used.

Asking for a reset never reveals whether an email has an account: the answer is always the same.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone

import jwt as pyjwt

from app.config import settings
from app.core.exceptions import BadRequestError
from app.core.security import hash_password

logger = logging.getLogger(__name__)

RESET_TTL_MINUTES = 30
PURPOSE = "password_reset"
ACCOUNT_TABLES = {"merchant_admin": "merchant_admins", "super_admin": "super_admins"}
INVALID = "This reset link is invalid or has expired. Ask for a new one."


def _key() -> bytes:
    return hmac.new(settings.SUPABASE_JWT_SECRET.encode(), b"byme24:password-reset:v1", hashlib.sha256).digest()


def _fingerprint(password_hash: str | None) -> str:
    return hashlib.sha256((password_hash or "").encode()).hexdigest()[:24]


def make_token(kind: str, account: dict, *, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    claims = {
        "purpose": PURPOSE, "kind": kind, "sub": str(account["id"]),
        "pw": _fingerprint(account.get("password_hash")),
        "iat": int(now.timestamp()), "exp": int((now + timedelta(minutes=RESET_TTL_MINUTES)).timestamp()),
        "jti": secrets.token_urlsafe(8),
    }
    return pyjwt.encode(claims, _key(), algorithm="HS256")


def read_token(token: str) -> dict:
    """The token's claims, or BadRequestError if it is not a valid, unexpired reset token."""
    try:
        claims = pyjwt.decode(token, _key(), algorithms=["HS256"])
    except pyjwt.PyJWTError:
        raise BadRequestError(INVALID)
    if claims.get("purpose") != PURPOSE or claims.get("kind") not in ACCOUNT_TABLES:
        raise BadRequestError(INVALID)
    return claims


def reset_link(token: str) -> str:
    return f"{settings.ADMIN_PANEL_URL.rstrip('/')}/reset-password?token={token}"


async def request_reset(db, email: str, send) -> int:
    """Send a reset link to the Telegram of every active dashboard account with this email.
    `send(telegram_id, text)` delivers a message. Returns how many links were sent (never shown to the
    person asking, so the reply cannot reveal whether the email exists)."""
    email = (email or "").strip()
    if not email:
        return 0
    sent = 0
    for kind, table in ACCOUNT_TABLES.items():
        try:
            rows = await db.from_(table).ilike("email", email).select("id,full_name,email,password_hash,telegram_id,is_active")
        except Exception:
            logger.exception("Password reset lookup failed in %s", table)
            continue
        for account in rows:
            if account.get("email", "").strip().lower() != email.lower() or not account.get("is_active"):
                continue
            if not account.get("telegram_id"):
                logger.info("Password reset asked for %s #%s, but no Telegram is linked", kind, account["id"])
                continue
            link = reset_link(make_token(kind, account))
            text = (
                "🔑 <b>Reset your Byme24 dashboard password</b>\n\n"
                f"Someone (hopefully you) asked to reset the password of <b>{account['email']}</b>.\n"
                f"<a href=\"{link}\">Set a new password</a> — the link works once, for {RESET_TTL_MINUTES} minutes.\n\n"
                "If this wasn't you, ignore this message: your password stays the same."
            )
            if await send(account["telegram_id"], text):
                sent += 1
            else:
                logger.warning("Could not send the password reset link to %s #%s", kind, account["id"])
    return sent


async def reset_password(db, token: str, new_password: str) -> dict:
    """Set a new password with a reset token. Returns {"kind", "account"}. Raises BadRequestError."""
    claims = read_token(token)
    table = ACCOUNT_TABLES[claims["kind"]]
    account = await db.from_(table).eq("id", int(claims["sub"])).select_one(
        "id,full_name,email,password_hash,telegram_id,is_active" + (",merchant_id,role" if table == "merchant_admins" else "")
    )
    if not account or not account.get("is_active"):
        raise BadRequestError(INVALID)
    if not hmac.compare_digest(_fingerprint(account.get("password_hash")), claims.get("pw", "")):
        raise BadRequestError(INVALID)  # already used, or the password changed since the link was sent

    # Only change it if it is still the password the link was made for: two tabs cannot both use one link
    changed = await (
        db.from_(table).eq("id", account["id"]).eq("password_hash", account["password_hash"])
        .update({"password_hash": hash_password(new_password)})
    )
    if not changed:
        raise BadRequestError(INVALID)
    return {"kind": claims["kind"], "account": account}
