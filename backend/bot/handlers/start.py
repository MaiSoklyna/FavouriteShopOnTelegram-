import time

import jwt as pyjwt
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import ContextTypes
from app.utils.security import create_access_token
from app.config import settings
from bot.supabase_helpers import sb_get, sb_get_one, sb_post, sb_patch
import logging

logger = logging.getLogger(__name__)

JWT_EXPIRY_SECONDS = 86400  # 24 hours


def _is_https(url: str) -> bool:
    return url.startswith("https://")


def _build_menu_keyboard(miniapp_url: str) -> InlineKeyboardMarkup:
    """Build inline keyboard. Uses WebAppInfo for HTTPS links."""
    if _is_https(miniapp_url):
        shop_button = InlineKeyboardButton(
            "Open Shop",
            web_app=WebAppInfo(url=miniapp_url),
        )
    else:
        shop_button = None

    rows = []
    if shop_button:
        rows.append([shop_button])
    rows.append([
        InlineKeyboardButton("My Orders", callback_data="my_orders"),
        InlineKeyboardButton("My Cart", callback_data="view_cart"),
    ])
    rows.append([
        InlineKeyboardButton("My Profile", callback_data="my_profile"),
        InlineKeyboardButton("Support", callback_data="support"),
    ])
    return InlineKeyboardMarkup(rows)


def _make_token(user_id: int, telegram_id: int = None) -> str:
    """Mint a JWT signed with SUPABASE_JWT_SECRET so miniapp_api can verify it."""
    now = int(time.time())
    claims = {
        "sub": str(user_id),
        "role": "authenticated",
        "aud": "authenticated",
        "app_role": "customer",
        "iss": "supabase",
        "iat": now,
        "exp": now + JWT_EXPIRY_SECONDS,
    }
    if telegram_id:
        claims["telegram_id"] = telegram_id
    return pyjwt.encode(claims, settings.SUPABASE_JWT_SECRET, algorithm="HS256")


async def _upsert_user(telegram_id, username, first_name, last_name):
    """Get or create user via Supabase, returns (db_user_dict, is_new)."""
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
        "username": username, "first_name": first_name, "last_name": last_name
    }, True


async def _complete_login_session(session_id: str, user_id: int, token: str):
    """Mark a login_sessions row as completed with the JWT."""
    await sb_patch("login_sessions", f"session_id=eq.{session_id}&status=eq.pending", {
        "jwt_token": token,
        "user_id": user_id,
        "status": "completed",
    })


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /start - upsert user, optionally complete a browser login session."""
    tg_user = update.effective_user
    telegram_id = tg_user.id
    username = tg_user.username or f"user_{telegram_id}"
    first_name = tg_user.first_name or ""
    last_name = tg_user.last_name or ""

    db_user, is_new = await _upsert_user(telegram_id, username, first_name, last_name)
    token = _make_token(db_user["id"], telegram_id)

    # --- deep-link: /start SESSION_ID (browser login) ---
    session_id = context.args[0] if context.args else None

    if session_id and session_id.startswith("dash_"):
        # Dashboard login - check super_admins first, then merchant_admins
        super_rows = await sb_get("super_admins", f"select=id,full_name,email,is_active&telegram_id=eq.{telegram_id}")
        if super_rows and super_rows[0].get("is_active"):
            sa = super_rows[0]
            dash_token = create_access_token({
                "sub": str(sa["id"]),
                "role": "super_admin",
                "email": sa["email"],
            })
            await _complete_login_session(session_id, sa["id"], dash_token)
            await update.message.reply_text(
                f"Hello, <b>{sa['full_name']}</b>!\n\n"
                "You're now logged in as Super Admin - go back to your dashboard.",
                parse_mode="HTML",
            )
            return

        ma_rows = await sb_get("merchant_admins", f"select=id,merchant_id,full_name,email,role,is_active&telegram_id=eq.{telegram_id}")
        if ma_rows and ma_rows[0].get("is_active"):
            ma = ma_rows[0]
            dash_token = create_access_token({
                "sub": str(ma["id"]),
                "role": "merchant",
                "merchant_id": ma["merchant_id"],
                "email": ma["email"],
            })
            await _complete_login_session(session_id, ma["id"], dash_token)
            await update.message.reply_text(
                f"Hello, <b>{ma['full_name']}</b>!\n\n"
                "You're now logged in - go back to your dashboard.",
                parse_mode="HTML",
            )
            return

        await update.message.reply_text(
            "No admin account is linked to this Telegram ID.\n\n"
            "Please contact your administrator or log in with email/password.",
            parse_mode="HTML",
        )
        return

    if session_id:
        # Miniapp customer login
        await _complete_login_session(session_id, db_user["id"], token)

        if is_new:
            text = (
                f"Welcome to <b>Favourite of Shop</b>, {first_name or 'friend'}!\n\n"
                "You're now logged in - go back to your browser to start shopping!"
            )
        else:
            text = (
                f"Welcome back, {first_name or 'friend'}!\n\n"
                "You're now logged in - go back to your browser."
            )
        await update.message.reply_text(text, parse_mode="HTML")
        return

    # --- regular /start (no session) - show Open Shop button ---
    miniapp_url = f"{settings.WEB_APP_URL}?auth={token}"

    if is_new:
        welcome_text = (
            f"Welcome to <b>Favourite of Shop</b>, {first_name or 'friend'}!\n\n"
            f"Your account is ready."
        )
    else:
        welcome_text = f"Welcome back, {first_name or 'friend'}!"

    if _is_https(miniapp_url):
        welcome_text += "\n\nTap <b>Open Shop</b> below to start shopping!"
    else:
        welcome_text += f'\n\n<a href="{miniapp_url}">Open Shop</a>'

    await update.message.reply_text(
        welcome_text,
        parse_mode="HTML",
        reply_markup=_build_menu_keyboard(miniapp_url),
        disable_web_page_preview=True,
    )


async def main_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Regenerate miniapp link and show main menu."""
    query = update.callback_query
    await query.answer()

    tg_user = update.effective_user
    db_user = await sb_get_one("users", f"select=id&telegram_id=eq.{tg_user.id}")
    miniapp_url = (
        f"{settings.WEB_APP_URL}?auth={_make_token(db_user['id'], tg_user.id)}"
        if db_user else settings.WEB_APP_URL
    )

    text = f"Hey {tg_user.first_name}! What would you like to do?"
    if not _is_https(miniapp_url):
        text += f'\n\n<a href="{miniapp_url}">Open Shop</a>'

    await query.edit_message_text(
        text,
        parse_mode="HTML",
        reply_markup=_build_menu_keyboard(miniapp_url),
        disable_web_page_preview=True,
    )
