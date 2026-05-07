"""Bot /start handler — user login, session completion, dashboard auth.

Refactored to use ``core.security.mint_jwt`` as the single JWT source of truth,
eliminating the duplicated ``_mint_admin_jwt`` and ``_make_token`` functions.
"""

from __future__ import annotations

import logging

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import ContextTypes

from app.config import settings
from app.core.constants import ADMIN_TOKEN_EXPIRY, USER_TOKEN_EXPIRY, Role
from app.core.security import mint_jwt
from bot.supabase_helpers import sb_get, sb_get_one, sb_post, sb_patch

logger = logging.getLogger(__name__)


# ── Helpers ─────────────────────────────────────────────────────


def _is_https(url: str) -> bool:
    return url.startswith("https://")


def _build_menu_keyboard(miniapp_url: str) -> InlineKeyboardMarkup:
    rows = []
    if _is_https(miniapp_url):
        rows.append([InlineKeyboardButton("Open Shop", web_app=WebAppInfo(url=miniapp_url))])
    rows.append([
        InlineKeyboardButton("My Orders", callback_data="my_orders"),
        InlineKeyboardButton("My Cart", callback_data="view_cart"),
    ])
    rows.append([
        InlineKeyboardButton("My Profile", callback_data="my_profile"),
        InlineKeyboardButton("Support", callback_data="support"),
    ])
    return InlineKeyboardMarkup(rows)


async def _upsert_user(telegram_id: int, username: str, first_name: str, last_name: str):
    """Get or create user, returns (db_user_dict, is_new)."""
    rows = await sb_get("users", f"select=*&telegram_id=eq.{telegram_id}")
    if rows:
        return rows[0], False

    new_rows = await sb_post("users", {
        "telegram_id": telegram_id,
        "username": username or f"user_{telegram_id}",
        "first_name": first_name or "",
        "last_name": last_name or "",
    })
    return new_rows[0] if new_rows else {
        "id": 0, "telegram_id": telegram_id,
        "username": username, "first_name": first_name, "last_name": last_name,
    }, True


def _make_user_token(user_id: int, telegram_id: int) -> str:
    """Mint a user JWT using the shared security module."""
    return mint_jwt(
        sub=str(user_id),
        role=Role.USER,
        telegram_id=telegram_id,
        expires_in=USER_TOKEN_EXPIRY,
    )


def _make_admin_token(admin_id: int, role: Role, email: str, merchant_id: int | None = None) -> str:
    """Mint an admin JWT using the shared security module."""
    return mint_jwt(
        sub=str(admin_id),
        role=role,
        email=email,
        merchant_id=merchant_id,
        expires_in=ADMIN_TOKEN_EXPIRY,
    )


async def _complete_login_session(session_id: str, user_id: int, token: str):
    """Mark a login_sessions row as completed."""
    await sb_patch("login_sessions", f"session_id=eq.{session_id}&status=eq.pending", {
        "jwt_token": token,
        "user_id": user_id,
        "status": "completed",
    })


async def _get_admin_accounts(telegram_id: int):
    """Check both admin tables for this telegram_id."""
    sa = ma = None
    try:
        rows = await sb_get("super_admins", f"select=id,full_name,email,is_active&telegram_id=eq.{telegram_id}")
        if rows and rows[0].get("is_active"):
            sa = rows[0]
    except Exception as e:
        logger.warning("super_admins lookup failed: %s", e)
    try:
        rows = await sb_get("merchant_admins", f"select=id,merchant_id,full_name,email,role,is_active&telegram_id=eq.{telegram_id}")
        if rows and rows[0].get("is_active"):
            ma = rows[0]
    except Exception as e:
        logger.warning("merchant_admins lookup failed: %s", e)
    return sa, ma


async def _complete_dash_as_super(session_id: str, sa: dict):
    token = _make_admin_token(sa["id"], Role.SUPER_ADMIN, sa["email"])
    await _complete_login_session(session_id, sa["id"], token)


async def _complete_dash_as_merchant(session_id: str, ma: dict):
    token = _make_admin_token(ma["id"], Role.MERCHANT_ADMIN, ma["email"], ma.get("merchant_id"))
    await _complete_login_session(session_id, ma["id"], token)


# ── /start command ──────────────────────────────────────────────


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /start — upsert user, optionally complete a browser login session."""
    tg_user = update.effective_user
    telegram_id = tg_user.id
    username = tg_user.username or f"user_{telegram_id}"
    first_name = tg_user.first_name or ""
    last_name = tg_user.last_name or ""

    db_user, is_new = await _upsert_user(telegram_id, username, first_name, last_name)
    token = _make_user_token(db_user["id"], telegram_id)

    session_id = context.args[0] if context.args else None

    # Dashboard login flow
    if session_id and session_id.startswith("dash_"):
        try:
            sa, ma = await _get_admin_accounts(telegram_id)

            if sa and ma:
                merchant_name = "Merchant Admin"
                try:
                    if ma.get("merchant_id"):
                        merchants = await sb_get("merchants", f"select=name&id=eq.{ma['merchant_id']}&limit=1")
                        if merchants:
                            merchant_name = merchants[0].get("name", "Merchant Admin")
                except Exception:
                    pass

                context.user_data["dash_session"] = session_id
                keyboard = InlineKeyboardMarkup([
                    [InlineKeyboardButton("Super Admin (Platform)", callback_data="dash_role_super")],
                    [InlineKeyboardButton(f"Merchant Admin ({merchant_name})", callback_data="dash_role_merchant")],
                ])
                await update.message.reply_text(
                    f"Hello, <b>{sa['full_name']}</b>!\n\n"
                    "You have <b>two admin accounts</b>. Which role?",
                    parse_mode="HTML", reply_markup=keyboard,
                )
                return

            if sa:
                await _complete_dash_as_super(session_id, sa)
                await update.message.reply_text(
                    f"Logged in as <b>Super Admin</b>, {sa['full_name']}! Go back to dashboard.",
                    parse_mode="HTML",
                )
                return

            if ma:
                await _complete_dash_as_merchant(session_id, ma)
                await update.message.reply_text(
                    f"Logged in as <b>Merchant Admin</b>, {ma['full_name']}! Go back to dashboard.",
                    parse_mode="HTML",
                )
                return

            await update.message.reply_text("No admin account linked to this Telegram ID.", parse_mode="HTML")
            return

        except Exception as e:
            logger.exception("Dashboard login failed: %s", e)
            await update.message.reply_text(
                f"Login failed. Try again or use email/password.\n<i>{str(e)[:100]}</i>",
                parse_mode="HTML",
            )
            return

    # Miniapp customer login
    if session_id:
        await _complete_login_session(session_id, db_user["id"], token)
        msg = f"Welcome{' to Favourite of Shop' if is_new else ' back'}, {first_name or 'friend'}! Go back to your browser."
        await update.message.reply_text(msg, parse_mode="HTML")
        return

    # Regular /start — show menu
    miniapp_url = f"{settings.WEB_APP_URL}?auth={token}"
    text = f"{'Welcome to <b>Favourite of Shop</b>' if is_new else 'Welcome back'}, {first_name or 'friend'}!"
    if _is_https(miniapp_url):
        text += "\n\nTap <b>Open Shop</b> to start!"
    else:
        text += f'\n\n<a href="{miniapp_url}">Open Shop</a>'

    await update.message.reply_text(
        text, parse_mode="HTML",
        reply_markup=_build_menu_keyboard(miniapp_url),
        disable_web_page_preview=True,
    )


# ── Callback: dash role selection ───────────────────────────────


async def dash_role_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle role selection when user has both admin accounts."""
    query = update.callback_query
    await query.answer()

    try:
        telegram_id = update.effective_user.id
        session_id = context.user_data.get("dash_session")
        if not session_id:
            await query.edit_message_text("Session expired. Try again on the dashboard.")
            return

        chosen = "super" if query.data == "dash_role_super" else "merchant"
        sa, ma = await _get_admin_accounts(telegram_id)

        if chosen == "super" and sa:
            await _complete_dash_as_super(session_id, sa)
            context.user_data.pop("dash_session", None)
            await query.edit_message_text("Logged in as <b>Super Admin</b>. Dashboard will update.", parse_mode="HTML")
        elif chosen == "merchant" and ma:
            await _complete_dash_as_merchant(session_id, ma)
            context.user_data.pop("dash_session", None)
            name = "your shop"
            try:
                if ma.get("merchant_id"):
                    merchants = await sb_get("merchants", f"select=name&id=eq.{ma['merchant_id']}&limit=1")
                    if merchants:
                        name = merchants[0].get("name", "your shop")
            except Exception:
                pass
            await query.edit_message_text(f"Logged in as <b>Merchant Admin</b> for <b>{name}</b>.", parse_mode="HTML")
        else:
            await query.edit_message_text("Account not found or inactive.")
    except Exception as e:
        logger.exception("dash_role_callback failed: %s", e)
        await query.edit_message_text("Something went wrong. Try again.")


async def main_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show main menu with refreshed token."""
    query = update.callback_query
    await query.answer()

    tg_user = update.effective_user
    db_user = await sb_get_one("users", f"select=id&telegram_id=eq.{tg_user.id}")
    miniapp_url = (
        f"{settings.WEB_APP_URL}?auth={_make_user_token(db_user['id'], tg_user.id)}"
        if db_user else settings.WEB_APP_URL
    )

    text = f"Hey {tg_user.first_name}! What would you like to do?"
    if not _is_https(miniapp_url):
        text += f'\n\n<a href="{miniapp_url}">Open Shop</a>'

    await query.edit_message_text(
        text, parse_mode="HTML",
        reply_markup=_build_menu_keyboard(miniapp_url),
        disable_web_page_preview=True,
    )
