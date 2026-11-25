"""The order's message in the shop's Telegram order group, with Accept / Reject buttons.

    🛒 New order — FS-251125-4821                 cash order (pending):  [✅ Accept] [✖ Reject]
       items · total · customer · address          paid order (confirmed): [✖ Can't fulfil – cancel & refund]

Reject and cancel ask "Why?" first (preset reasons), so a mis-tap does nothing. Taps follow the same
rules as the dashboard (decisions 2026-11-25):
- the tap must come from the shop's own order group, for an order of that shop;
- the person's Telegram must be linked to an active account of that shop (merchant_admins.telegram_id);
- their role must allow it: accept = orders.process (owner, manager, staff), reject/cancel =
  orders.cancel (owner, manager);
- the change goes through order_status.change_status (stock, coupons, loyalty, refunds, customer notice)
  and is written to the shop's activity log under the person's name, marked as done in Telegram.

The message is rebuilt from the database every time, so it can be redrawn after an action anywhere:
the dashboard and a customer's own cancellation call `sync` (needs orders.telegram_group_message_id,
migration 042), which removes the buttons and says what happened.

Everything here is bot-agnostic: Telegram calls go through `_send` / `_edit`, so tests replace them.
"""

from __future__ import annotations

import html
import logging
from datetime import datetime

import httpx

from app.config import settings
from app.core.constants import Role, shop_role
from app.core.exceptions import AppError, ConflictError
from app.core.permissions import Perm, role_can
from app.core.security import TokenClaims
from app.services import audit, order_status
from app.services.delivery import SHOP_TZ

logger = logging.getLogger(__name__)

PREFIX = "oa"
REASONS = {
    "oos": "Out of stock",
    "closed": "Shop is closed",
    "area": "Can't deliver there",
    "other": "Other",
}
PAYMENT_LABELS = {"khqr": "ABA KHQR", "stripe": "Card (Stripe test)", "cod": "Cash on delivery"}
STATUS_WORDS = {"confirmed": "accepted", "processing": "being prepared", "shipped": "out for delivery",
                "delivered": "delivered", "cancelled": "cancelled", "expired": "expired", "pending": "waiting"}
_MISSING_COLUMN = ("42703", "PGRST204")


# ── Telegram I/O (replaced in tests) ────────────────────────────

def _markup(rows):
    if rows is None:
        return None
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup
    return InlineKeyboardMarkup([[InlineKeyboardButton(text, callback_data=data) for text, data in row] for row in rows])


async def _send(chat_id: int, text: str, rows) -> int | None:
    from telegram import Bot
    from telegram.constants import ParseMode
    async with Bot(token=settings.TELEGRAM_BOT_TOKEN) as bot:
        msg = await bot.send_message(chat_id=chat_id, text=text, parse_mode=ParseMode.HTML,
                                     disable_web_page_preview=True, reply_markup=_markup(rows))
    return msg.message_id


async def _edit(chat_id: int, message_id: int, text: str, rows) -> None:
    from telegram import Bot
    from telegram.constants import ParseMode
    async with Bot(token=settings.TELEGRAM_BOT_TOKEN) as bot:
        await bot.edit_message_text(chat_id=chat_id, message_id=message_id, text=text, parse_mode=ParseMode.HTML,
                                    disable_web_page_preview=True, reply_markup=_markup(rows))


# ── Building the message ────────────────────────────────────────

ORDER_COLUMNS = ("id,order_code,merchant_id,status,payment_method,payment_status,total,delivery_address,"
                 "customer_name,customer_phone,delivery_name,delivery_phone,delivery_type")


async def context(db, order_id: int) -> dict | None:
    """Everything the message shows, read fresh from the database."""
    order = await db.from_("orders").eq("id", order_id).select_one(ORDER_COLUMNS)
    if not order:
        return None
    try:
        extra = await db.from_("orders").eq("id", order_id).select_one("telegram_group_message_id")
    except httpx.HTTPStatusError:
        extra = None  # before migration 042
    shop = await db.from_("merchants").eq("id", order["merchant_id"]).select_one("id,name,telegram_group_id") or {}
    items = await db.from_("order_items").eq("order_id", order_id).select("product_name,quantity,unit_price,subtotal")
    return {**order, "shop": shop, "items": items, "message_id": (extra or {}).get("telegram_group_message_id")}


def _e(v) -> str:
    return html.escape(str(v or ""), quote=False)


def render(ctx: dict, footer: str | None = None) -> str:
    paid = ctx.get("payment_status") == "paid"
    lines = [f"<b>🛒 New order</b> — {_e(ctx['order_code'])}", f"<b>Shop:</b> {_e(ctx['shop'].get('name'))}", "", "<b>Items</b>"]
    for it in ctx.get("items") or []:
        qty = it.get("quantity", 0)
        sub = float(it.get("subtotal") or float(it.get("unit_price") or 0) * qty)
        lines.append(f"  • {_e(it.get('product_name') or 'Item')} × {qty} — ${sub:.2f}")
    if not ctx.get("items"):
        lines.append("  (no items)")
    method = ctx.get("payment_method") or "cod"
    lines += ["", f"<b>Total: ${float(ctx.get('total') or 0):.2f}</b>",
              f"Payment: {PAYMENT_LABELS.get(method, method.upper())}{' — PAID ✅' if paid else ''}", ""]
    if ctx.get("delivery_type") == "pickup":
        lines.append("<b>Pickup at the shop</b>")
    else:
        lines.append("<b>Deliver to</b>")
    for v in (ctx.get("customer_name") or ctx.get("delivery_name"), ctx.get("customer_phone") or ctx.get("delivery_phone")):
        if v:
            lines.append(f"  {_e(v)}")
    if ctx.get("delivery_type") != "pickup":
        lines.append(f"  {_e(ctx.get('delivery_address'))}")
    lines += ["", f"<a href=\"{settings.ADMIN_PANEL_URL}/orders\">Open in dashboard</a>"]
    if footer:
        lines += ["", footer]
    return "\n".join(lines)


def buttons(ctx: dict):
    """The buttons the order's state allows, or None."""
    oid = ctx["id"]
    if ctx.get("status") == "pending" and ctx.get("payment_method") not in ("khqr", "stripe"):
        return [[("✅ Accept", f"{PREFIX}:acc:{oid}"), ("✖ Reject", f"{PREFIX}:rej:{oid}")]]
    if ctx.get("status") == "confirmed" and ctx.get("payment_status") == "paid":
        return [[("✖ Can't fulfil – cancel & refund", f"{PREFIX}:rej:{oid}")]]
    return None


def reason_buttons(order_id: int):
    rows = [[(label, f"{PREFIX}:rr:{order_id}:{code}")] for code, label in REASONS.items()]
    return rows + [[("‹ Back", f"{PREFIX}:back:{order_id}")]]


def _now() -> str:
    return datetime.now(SHOP_TZ).strftime("%H:%M")


def footer_for(status: str, who: str, *, reason: str | None = None, paid: bool = False,
               where: str = "", verb: str | None = None) -> str:
    if status == "confirmed":
        return f"✅ Accepted by {_e(who)}{where} · {_now()}"
    if status == "cancelled":
        verb = verb or ("Cancelled" if paid else "Rejected")
        tail = f" · {_e(reason)}" if reason else ""
        refund = " · the customer will be refunded" if paid else ""
        return f"✖ {verb} by {_e(who)}{where}{tail}{refund} · {_now()}"
    return f"ℹ️ Now {STATUS_WORDS.get(status, status)} · {_now()}"


# ── Posting and redrawing ───────────────────────────────────────

async def post_new(db, order_id: int) -> int | None:
    """Post the new-order message (with its buttons) to the shop's group and remember it. Never raises."""
    try:
        ctx = await context(db, order_id)
        group = (ctx or {}).get("shop", {}).get("telegram_group_id")
        if not ctx or not group:
            return None
        message_id = await _send(int(group), render(ctx), buttons(ctx))
        if message_id:
            try:
                await db.from_("orders").eq("id", order_id).update({"telegram_group_message_id": message_id})
            except httpx.HTTPStatusError as exc:
                if not _missing(exc):
                    raise
        logger.info("Order group message posted: order %s -> chat %s msg %s", order_id, group, message_id)
        return message_id
    except Exception:
        logger.exception("Could not post order %s to its shop's group", order_id)
        return None


async def sync(db, order_id: int, footer: str) -> bool:
    """Redraw the order's group message after it was handled elsewhere: no buttons, what happened. Never raises."""
    try:
        ctx = await context(db, order_id)
        if not ctx or not ctx.get("message_id") or not ctx["shop"].get("telegram_group_id"):
            return False
        await _edit(int(ctx["shop"]["telegram_group_id"]), int(ctx["message_id"]), render(ctx, footer), buttons(ctx))
        return True
    except Exception:
        logger.exception("Could not update the group message of order %s", order_id)
        return False


def _missing(exc: httpx.HTTPStatusError) -> bool:
    try:
        return exc.response.json().get("code") in _MISSING_COLUMN
    except Exception:
        return False


# ── A tap on a button ───────────────────────────────────────────

def parse(data: str | None):
    """"oa:acc:12" -> ("acc", 12, None); "oa:rr:12:oos" -> ("rr", 12, "oos"); else None."""
    parts = (data or "").split(":")
    if len(parts) < 3 or parts[0] != PREFIX or parts[1] not in ("acc", "rej", "rr", "back"):
        return None
    try:
        order_id = int(parts[2])
    except ValueError:
        return None
    reason = parts[3] if len(parts) > 3 else None
    if parts[1] == "rr" and reason not in REASONS:
        return None
    return parts[1], order_id, reason


def _claims(account: dict) -> TokenClaims:
    return TokenClaims(sub=str(account["id"]), role=Role.MERCHANT_ADMIN, merchant_id=account["merchant_id"],
                       merchant_role=shop_role(account.get("role")), name=account.get("full_name"),
                       email=account.get("email"))


async def handle_tap(db, *, chat_id: int, telegram_id: int, data: str) -> dict:
    """Act on a button tap. Returns what to show:
    {"answer": text for the tapping person, "alert": bool, "text": new message text or None,
     "buttons": new buttons (None = remove), "edit": bool}"""
    parsed = parse(data)
    if not parsed:
        return {"answer": "This button is no longer valid.", "alert": True, "edit": False}
    action, order_id, reason = parsed
    ctx = await context(db, order_id)
    if not ctx:
        return {"answer": "This order no longer exists.", "alert": True, "edit": False}

    # The tap must come from this shop's own order group
    group = ctx["shop"].get("telegram_group_id")
    if group is None or int(group) != int(chat_id):
        return {"answer": "This button belongs to another shop's group.", "alert": True, "edit": False}

    # Who tapped: an active account of this shop, linked to this Telegram
    account = await db.from_("merchant_admins").eq("telegram_id", telegram_id).eq("merchant_id", ctx["merchant_id"]) \
        .eq("is_active", True).select_one("id,merchant_id,full_name,email,role,is_active")
    if not account:
        return {"answer": "Only this shop's team can do this. Ask the shop owner to add your Telegram ID to your "
                          "account under Staff.", "alert": True, "edit": False}
    role = shop_role(account.get("role"))
    need = Perm.ORDERS_PROCESS if action == "acc" else Perm.ORDERS_CANCEL
    if not role_can(role, need):
        what = "reject or cancel orders" if need == Perm.ORDERS_CANCEL else "accept orders"
        return {"answer": f"Your role can't {what}. Ask the owner or a manager.", "alert": True, "edit": False}

    # The order may have moved on (dashboard, another tap): just bring the message up to date
    still = buttons(ctx)
    if still is None:
        return {"answer": f"This order is already {STATUS_WORDS.get(ctx['status'], ctx['status'])}.", "alert": True,
                "edit": True, "text": render(ctx, footer_for(ctx["status"], "someone")) if ctx["status"] in ("confirmed", "cancelled")
                else render(ctx, f"ℹ️ Now {STATUS_WORDS.get(ctx['status'], ctx['status'])}"), "buttons": None}

    if action == "rej":
        return {"answer": "Why can't you take this order?", "alert": False, "edit": True,
                "text": render(ctx, "<i>Choose a reason (the customer is told):</i>"), "buttons": reason_buttons(order_id)}
    if action == "back":
        return {"answer": "", "alert": False, "edit": True, "text": render(ctx), "buttons": still}
    if action == "acc" and ctx["status"] != "pending":
        return {"answer": "This order can't be accepted any more.", "alert": True, "edit": True,
                "text": render(ctx), "buttons": still}

    new_status = "confirmed" if action == "acc" else "cancelled"
    label = REASONS.get(reason) if reason else None
    note = f"{'Rejected' if ctx['status'] == 'pending' else 'Cancelled'} in Telegram: {label}" if label else None
    user = _claims(account)
    try:
        await order_status.change_status(
            db, {"id": order_id, "status": ctx["status"]}, new_status,
            actor_type="merchant_admin", actor_id=str(account["id"]), admin_note=note,
        )
    except ConflictError:
        fresh = await context(db, order_id) or ctx
        who = "someone else"
        return {"answer": f"Already {STATUS_WORDS.get(fresh['status'], fresh['status'])} by {who}.", "alert": True, "edit": True,
                "text": render(fresh, footer_for(fresh["status"], who)) if fresh["status"] in ("confirmed", "cancelled")
                else render(fresh), "buttons": buttons(fresh)}
    except AppError as exc:
        return {"answer": str(getattr(exc, "detail", None) or exc)[:180], "alert": True, "edit": False}

    await audit.record(
        db, user, merchant_id=ctx["merchant_id"], action=audit.order_action(ctx["status"], new_status),
        target_type="order", target_id=order_id, target_label=ctx.get("order_code"),
        old={"status": ctx["status"]},
        new={"status": new_status, "via": "Telegram", **({"note": label} if label else {})},
    )
    paid = ctx.get("payment_status") == "paid"
    fresh = await context(db, order_id) or ctx
    done = "Accepted ✅" if new_status == "confirmed" else ("Cancelled; the customer will be refunded" if paid else "Rejected")
    return {"answer": done, "alert": False, "edit": True,
            "text": render(fresh, footer_for(new_status, account.get("full_name") or "a team member", reason=label, paid=paid)),
            "buttons": None}


async def apply_tap(db, *, chat_id: int, message_id: int, telegram_id: int, data: str) -> dict:
    """handle_tap, then redraw the tapped message. Returns handle_tap's result."""
    result = await handle_tap(db, chat_id=chat_id, telegram_id=telegram_id, data=data)
    if result.get("edit") and result.get("text"):
        try:
            await _edit(chat_id, message_id, result["text"], result.get("buttons"))
        except Exception as exc:
            if "message is not modified" not in str(exc).lower():
                logger.warning("Could not edit group message %s: %s", message_id, exc)
    return result
