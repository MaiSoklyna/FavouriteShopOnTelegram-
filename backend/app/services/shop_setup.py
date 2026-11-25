"""Shop setup: the checklist a new shop works through, and when customers may see it.

A shop is visible to customers when it is active AND its setup is complete
(`merchants.setup_completed_at`, migration 041). Required before going live (decision 2026-11-25):

    name · shop type · logo · address + map pin · opening hours (a weekly schedule or 24/7) ·
    Telegram order group · at least one category · at least one product · delivery settings

The checklist is never stored: it is worked out from the shop's own data every time, so it can't
drift. `refresh` makes a shop live the first time everything required is done (exactly once, and the
owner is told). A live shop that later loses an item stays visible (decision 2026-11-25); its dashboard
shows what to fix.

Telegram group linking: the wizard shows a short code; the owner sends `/link@<bot> CODE` in the
shop's order group, and the bot links that group. The code is an HMAC of the shop id and a 15-minute
window, so nothing is stored and it expires on its own.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import time
from datetime import datetime, timezone

import httpx

from app.config import settings
from app.core.security import TokenClaims
from app.services import audit, notify

logger = logging.getLogger(__name__)

# 24/7: every day open 00:00-00:00 (delivery.is_open reads a window with start == end as all day)
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
ALWAYS_OPEN = {d: [["00:00", "00:00"]] for d in DAYS}

LINK_WINDOW_SECONDS = 15 * 60      # a code is valid in its window and the next one (15-30 minutes)
LINK_CODE_LENGTH = 6
_MISSING = ("42703", "PGRST204", "PGRST100", "42P01", "PGRST205")

REQUIRED = [
    # key, label, wizard step
    ("name", "Shop name", "basics"),
    ("shop_type", "Shop type", "basics"),
    ("logo", "Logo", "basics"),
    ("location", "Address and map location", "location"),
    ("hours", "Opening hours", "hours"),
    ("telegram_group", "Telegram order group", "telegram"),
    ("category", "At least one category", "categories"),
    ("product", "At least one product", "products"),
    ("delivery", "Delivery settings", "delivery"),
]
OPTIONAL = [
    ("subtype", "Shop subtype", "basics"),
    ("description", "Description and tagline", "extras"),
    ("cover", "Cover photos", "extras"),
    ("payout", "Payout account (ABA)", "extras"),
    ("owner_telegram", "Your Telegram login", "extras"),
    ("staff", "Invite staff", "extras"),
    ("social", "Facebook or Instagram", "extras"),
]
MERCHANT_COLUMNS = ("id,name,status,shop_category_id,shop_subcategory_id,logo_url,address,latitude,longitude,"
                    "opening_hours,telegram_group_id,delivery_radius_km,delivery_base_fee,delivery_fee_mode,"
                    "tagline,description,aba_account,fb_page,instagram,setup_completed_at,created_at")


def _code(exc: Exception) -> str | None:
    if isinstance(exc, httpx.HTTPStatusError):
        try:
            return exc.response.json().get("code")
        except Exception:
            return None
    return None


def _missing(exc: Exception) -> bool:
    return _code(exc) in _MISSING


# ── What counts as done ─────────────────────────────────────────

def hours_set(hours) -> bool:
    """A weekly schedule with at least one open day, or 24/7."""
    if not isinstance(hours, dict):
        return False
    return any(isinstance(v, list) and any(isinstance(w, list) and len(w) == 2 for w in v) for v in hours.values())


def is_always_open(hours) -> bool:
    return isinstance(hours, dict) and all(hours.get(d) == [["00:00", "00:00"]] for d in DAYS)


def is_group_chat(chat_id) -> bool:
    """Telegram groups and supergroups have negative ids; people (private chats) positive."""
    try:
        return int(chat_id) < 0
    except (TypeError, ValueError):
        return False


def delivery_set(m: dict) -> bool:
    mode = m.get("delivery_fee_mode")
    if not m.get("delivery_radius_km") or float(m["delivery_radius_km"]) <= 0:
        return False
    if mode == "platform":
        return True
    return mode == "custom" and m.get("delivery_base_fee") is not None


def _required_done(m: dict, counts: dict) -> dict[str, bool]:
    return {
        "name": bool((m.get("name") or "").strip()),
        "shop_type": m.get("shop_category_id") is not None,
        "logo": bool(m.get("logo_url")),
        "location": bool((m.get("address") or "").strip()) and m.get("latitude") is not None and m.get("longitude") is not None,
        "hours": hours_set(m.get("opening_hours")),
        "telegram_group": is_group_chat(m.get("telegram_group_id")),
        "category": counts.get("categories", 0) > 0,
        "product": counts.get("products", 0) > 0,
        "delivery": delivery_set(m),
    }


def _optional_done(m: dict, counts: dict) -> dict[str, bool]:
    return {
        "subtype": m.get("shop_subcategory_id") is not None,
        "description": bool((m.get("description") or "").strip()) and bool((m.get("tagline") or "").strip()),
        "cover": counts.get("hero_images", 0) > 0,
        "payout": bool(m.get("aba_account")),
        "owner_telegram": counts.get("owner_telegram", 0) > 0,
        "staff": counts.get("staff", 0) > 0,
        "social": bool(m.get("fb_page") or m.get("instagram")),
    }


async def _counts(db, merchant_id: int) -> dict:
    async def n(q) -> int:
        try:
            return len(await q)
        except Exception:
            return 0
    return {
        "categories": await n(db.from_("categories").eq("merchant_id", merchant_id).eq("is_active", True).select("id")),
        "products": await n(db.from_("products").eq("merchant_id", merchant_id).eq("is_active", True).select("id")),
        "hero_images": await n(db.from_("merchant_hero_images").eq("merchant_id", merchant_id).select("id")),
        "owner_telegram": await n(db.from_("merchant_admins").eq("merchant_id", merchant_id).eq("role", "owner")
                                  .not_("telegram_id", "is", "null").select("id")),
        "staff": await n(db.from_("merchant_admins").eq("merchant_id", merchant_id).neq("role", "owner")
                         .eq("is_active", True).select("id")),
    }


async def load_merchant(db, merchant_id: int) -> dict | None:
    try:
        return await db.from_("merchants").eq("id", merchant_id).select_one(MERCHANT_COLUMNS)
    except httpx.HTTPStatusError as exc:
        if not _missing(exc):
            raise
        # Before migration 041: the same without the two new columns
        cols = ",".join(c for c in MERCHANT_COLUMNS.split(",") if c not in ("delivery_fee_mode", "setup_completed_at"))
        row = await db.from_("merchants").eq("id", merchant_id).select_one(cols)
        if row:
            row.update({"delivery_fee_mode": None, "setup_completed_at": row.get("created_at"), "_premigration": True})
        return row


async def checklist(db, merchant_id: int, merchant: dict | None = None) -> dict:
    m = merchant or await load_merchant(db, merchant_id)
    if not m:
        return {}
    counts = await _counts(db, merchant_id)
    req, opt = _required_done(m, counts), _optional_done(m, counts)
    required = [{"key": k, "label": label, "step": step, "done": req[k]} for k, label, step in REQUIRED]
    optional = [{"key": k, "label": label, "step": step, "done": opt[k]} for k, label, step in OPTIONAL]
    done = sum(1 for r in required if r["done"])
    return {
        "merchant_id": merchant_id,
        "name": m.get("name"),
        "live": m.get("setup_completed_at") is not None,
        "setup_completed_at": m.get("setup_completed_at"),
        "status": m.get("status"),
        "required": required,
        "optional": optional,
        "done": done,
        "total": len(required),
        "complete": done == len(required),
        "missing": [r["label"] for r in required if not r["done"]],
        "always_open": is_always_open(m.get("opening_hours")),
        "delivery_fee_mode": m.get("delivery_fee_mode"),
    }


async def refresh(db, merchant_id: int | None) -> dict | None:
    """Make the shop live if it has everything now. Cheap for live shops. Never raises."""
    if not merchant_id:
        return None
    try:
        m = await load_merchant(db, merchant_id)
        if not m or m.get("setup_completed_at") is not None or m.get("_premigration"):
            return None
        state = await checklist(db, merchant_id, m)
        if not state.get("complete") or m.get("status") != "active":
            return state
        went_live = await (
            db.from_("merchants").eq("id", merchant_id).is_("setup_completed_at", "null")
            .update({"setup_completed_at": datetime.now(timezone.utc).isoformat()})
        )
        if went_live:
            await _announce_live(db, m, by=None)
            state.update({"live": True, "setup_completed_at": went_live[0].get("setup_completed_at")})
        return state
    except Exception:
        logger.exception("Shop setup refresh failed for shop %s", merchant_id)
        return None


async def publish(db, merchant_id: int, admin: TokenClaims) -> bool:
    """The platform makes a shop live by hand (e.g. a shop it set up itself)."""
    m = await load_merchant(db, merchant_id)
    if not m or m.get("setup_completed_at") is not None:
        return False
    rows = await db.from_("merchants").eq("id", merchant_id).is_("setup_completed_at", "null").update(
        {"setup_completed_at": datetime.now(timezone.utc).isoformat()})
    if rows:
        await _announce_live(db, m, by=admin)
    return bool(rows)


async def _announce_live(db, m: dict, *, by: TokenClaims | None) -> None:
    await audit.record(db, by, merchant_id=m["id"], action="shop.published_by_platform" if by else "shop.went_live",
                       target_type="shop", target_id=m["id"], target_label=m.get("name"),
                       new={"live": True})
    await notify.notify_merchant(
        db, m["id"], "system", "Your shop is live 🎉",
        f"{m.get('name') or 'Your shop'} is now visible to customers on Byme24.",
        link="/dashboard", ref_id=m["id"], dedupe_key=f"shop:{m['id']}:live",
    )
    if is_group_chat(m.get("telegram_group_id")):
        try:
            from app.utils.bot_manager import send_telegram_message
            await send_telegram_message(int(m["telegram_group_id"]),
                                        f"🎉 {m.get('name') or 'Your shop'} is now live on Byme24. New orders will appear here.")
        except Exception:
            logger.exception("Could not announce shop %s going live on Telegram", m["id"])


# ── Who customers may see ───────────────────────────────────────

async def visible_shop_ids(db) -> set[int]:
    """Active shops whose setup is complete. Before migration 041: every active shop."""
    try:
        rows = await db.from_("merchants").eq("status", "active").not_("setup_completed_at", "is", "null").select("id")
    except httpx.HTTPStatusError as exc:
        if not _missing(exc):
            raise
        rows = await db.from_("merchants").eq("status", "active").select("id")
    return {r["id"] for r in rows}


def is_visible(m: dict | None) -> bool:
    """For a merchant row that was read with status and setup_completed_at."""
    if not m or m.get("status") != "active":
        return False
    return "setup_completed_at" not in m or m.get("setup_completed_at") is not None


def sees_hidden_shop(user: TokenClaims | None, merchant_id: int | None) -> bool:
    """The shop's own people and the platform admin can look at a shop before it is live."""
    if not user:
        return False
    if user.is_super_admin:
        return True
    return bool(user.is_admin and merchant_id is not None and user.merchant_id == merchant_id)


# ── Telegram group link codes ───────────────────────────────────

def _link_key() -> bytes:
    return hmac.new(settings.SUPABASE_JWT_SECRET.encode(), b"byme24:group-link:v1", hashlib.sha256).digest()


def link_code(merchant_id: int, window: int | None = None) -> str:
    window = int(time.time() // LINK_WINDOW_SECONDS) if window is None else window
    digest = hmac.new(_link_key(), f"{int(merchant_id)}:{window}".encode(), hashlib.sha256).digest()
    return base64.b32encode(digest).decode()[:LINK_CODE_LENGTH]


def link_code_expires_in() -> int:
    """Seconds the code shown now stays valid (until the end of the next window)."""
    now = time.time()
    return int((now // LINK_WINDOW_SECONDS + 2) * LINK_WINDOW_SECONDS - now)


def match_link_code(code: str, merchant_ids: list[int]) -> int | None:
    """Which shop a code belongs to (current or previous window), or None."""
    code = (code or "").strip().upper()
    if len(code) != LINK_CODE_LENGTH:
        return None
    window = int(time.time() // LINK_WINDOW_SECONDS)
    for mid in merchant_ids:
        for w in (window, window - 1):
            if hmac.compare_digest(code, link_code(mid, w)):
                return mid
    return None


async def link_group(db, code: str, chat_id: int, chat_title: str | None) -> dict:
    """Called by the bot for `/link CODE` in a group. Returns {"ok", "message", "merchant_id"}."""
    if not is_group_chat(chat_id):
        return {"ok": False, "message": "Send this in your shop's order group (a Telegram group with the bot in it), not in a private chat."}
    shops = await db.from_("merchants").select("id,name,telegram_group_id")
    mid = match_link_code(code, [s["id"] for s in shops])
    if mid is None:
        return {"ok": False, "message": "That code is not valid or has expired. Get a new one in Shop setup → Telegram."}
    shop = next(s for s in shops if s["id"] == mid)
    before = shop.get("telegram_group_id")
    if before != chat_id:
        await db.from_("merchants").eq("id", mid).update({"telegram_group_id": chat_id})
        await audit.record(db, None, merchant_id=mid, action="shop.settings_updated", target_type="shop",
                           target_id=mid, target_label="Telegram order group",
                           old={"telegram_group_id": before}, new={"telegram_group_id": chat_id, "group": chat_title})
    await refresh(db, mid)
    return {"ok": True, "merchant_id": mid,
            "message": f"✅ Linked to {shop.get('name') or 'your shop'}. New orders will be posted in this group."}
