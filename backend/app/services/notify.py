"""In-app notifications for customers and shops, written whenever something happens to an order.

Rules this module keeps:
- It never raises. A notification must not undo the order, payment or payout it announces.
- One notification per event and recipient: every event has a `dedupe_key`, and a repeat (a retried
  request, two webhooks) is ignored instead of announced twice.
- Works before migration 027 too: if the new columns are missing it writes the old ones (customers
  only; the shop inbox needs the migration).
"""

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

# What each kind is stored as in the old `type` enum (order_update | promo | system)
KIND_TYPE = {
    "order_placed": "order_update", "order_paid": "order_update", "order_status": "order_update",
    "review_request": "order_update", "new_order": "order_update", "order_cancelled": "order_update",
    "delivery_assigned": "order_update", "delivery_update": "order_update", "review": "system",
    "payout": "system", "low_stock": "system", "system": "system", "loyalty": "system", "refund": "order_update",
    "promo": "promo",
}

# Customer-facing wording for each status; (title, body) with {shop} {code} {pickup}
STATUS_COPY = {
    "confirmed": ("Order confirmed", "{shop} accepted your order {code}."),
    "processing": ("Preparing your order", "{shop} is getting order {code} ready."),
    "shipped": ("Out for delivery", "Order {code} from {shop} is on its way."),
    "shipped_pickup": ("Ready for pickup", "Order {code} is ready for you at {shop}."),
    "delivered": ("Order delivered", "Order {code} from {shop} was delivered. Enjoy!"),
    "delivered_pickup": ("Order picked up", "Order {code} was picked up at {shop}. Enjoy!"),
    "cancelled": ("Order cancelled", "Order {code} from {shop} was cancelled."),
    "expired": ("Order expired", "Order {code} from {shop} wasn't paid in time, so it expired. You can order again any time."),
}
# Statuses that also go to Telegram (the rest stay in the app, to keep chat quiet)
PUSH_STATUSES = {"shipped", "delivered", "cancelled"}


def _error_code(exc: httpx.HTTPStatusError) -> str | None:
    try:
        body = exc.response.json()
    except ValueError:
        return None
    return body.get("code") if isinstance(body, dict) else None


async def _insert(db, row: dict) -> bool:
    """Create the row. True = created now, False = already there, refused, or failed (never raises)."""
    try:
        await db.from_("notifications").insert(row)
        return True
    except httpx.HTTPStatusError as exc:
        code = _error_code(exc)
        if code == "23505":
            return False  # this event was already announced
        if code in ("42703", "PGRST204"):
            # Migration 027 not applied: keep the customer feed working with the old columns
            if row.get("user_id") is None:
                logger.warning("Shop inbox needs migration 027; notification skipped")
                return False
            legacy = {k: row[k] for k in ("user_id", "type", "title", "body", "ref_id") if row.get(k) is not None}
            try:
                await db.from_("notifications").insert(legacy)
                return True
            except Exception:
                logger.exception("Could not write notification (legacy columns)")
                return False
        logger.exception("Could not write notification")
        return False
    except Exception:
        logger.exception("Could not write notification")
        return False


async def notify_user(db, user_id: int | None, kind: str, title: str, body: str, *,
                      link: str | None = None, ref_id: int | None = None, dedupe_key: str | None = None) -> bool:
    if not user_id:
        return False
    return await _insert(db, {
        "user_id": user_id, "type": KIND_TYPE.get(kind, "system"), "kind": kind, "title": title, "body": body,
        "ref_id": ref_id, "link": link, "dedupe_key": dedupe_key,
    })


async def notify_merchant(db, merchant_id: int | None, kind: str, title: str, body: str, *,
                          link: str | None = None, ref_id: int | None = None, dedupe_key: str | None = None) -> bool:
    if not merchant_id:
        return False
    return await _insert(db, {
        "merchant_id": merchant_id, "type": KIND_TYPE.get(kind, "system"), "kind": kind, "title": title,
        "body": body, "ref_id": ref_id, "link": link, "dedupe_key": dedupe_key,
    })


def status_copy(status: str, *, pickup: bool, shop: str, code: str) -> tuple[str, str] | None:
    key = f"{status}_pickup" if pickup and f"{status}_pickup" in STATUS_COPY else status
    copy = STATUS_COPY.get(key)
    return (copy[0], copy[1].format(shop=shop, code=code)) if copy else None


async def _order_context(db, order_id: int) -> dict | None:
    order = await db.from_("orders").eq("id", order_id).select_one(
        "id,user_id,merchant_id,order_code,delivery_type,total,payment_method"
    )
    if not order:
        return None
    merchant = await db.from_("merchants").eq("id", order["merchant_id"]).select_one("name") or {}
    order["shop"] = merchant.get("name") or "the shop"
    order["pickup"] = order.get("delivery_type") == "pickup"
    return order


async def _delivery_code_line(db, order_id: int) -> str:
    """" Your delivery code is 1234 ..." when a driver is bringing the order, else "". Never raises."""
    try:
        from app.services import delivery_code
        if await db.from_("deliveries").eq("order_id", order_id).in_("status", ["assigned", "accepted", "picked_up"]).select("id"):
            return f" Your delivery code is {delivery_code.code_for(order_id)}: give it to the driver when your order arrives."
    except Exception:
        logger.exception("Could not add the delivery code for order %s", order_id)
    return ""


async def _push(db, order: dict, title: str, body: str) -> None:
    """Telegram copy of an in-app notification. Never raises."""
    try:
        from bot.status_notifications import send_order_status_to_customer

        user = await db.from_("users").eq("id", order["user_id"]).select_one("id,telegram_id") or {}
        await send_order_status_to_customer(
            user.get("telegram_id"), order_id=order["id"], order_code=order["order_code"],
            title=title, body=body, user_id=user.get("id"),
        )
    except Exception:
        logger.exception("Telegram status push failed for order %s", order.get("id"))


async def push_to_driver(db, driver: dict, *, title: str, body: str) -> None:
    """Telegram copy of a driver's assignment. Never raises."""
    try:
        from bot.status_notifications import send_driver_message

        user = await db.from_("users").eq("id", driver["user_id"]).select_one("telegram_id") or {}
        await send_driver_message(user.get("telegram_id"), title=title, body=body)
    except Exception:
        logger.exception("Telegram push to driver failed")


async def order_status_changed(db, order_id: int, status: str, *, by_customer: bool = False) -> None:
    """Announce a new order status: the customer (unless they did it themselves) and, on a
    cancellation, the shop. On delivery the customer is also asked how it went. Never raises."""
    try:
        order = await _order_context(db, order_id)
        if not order:
            return
        link = f"/shop/order/{order_id}"
        if not by_customer:
            copy = status_copy(status, pickup=order["pickup"], shop=order["shop"], code=order["order_code"])
            if copy and status == "shipped" and not order["pickup"]:
                copy = (copy[0], copy[1] + await _delivery_code_line(db, order_id))
            if copy:
                created = await notify_user(
                    db, order["user_id"], "order_status", *copy,
                    link=link, ref_id=order_id, dedupe_key=f"order:{order_id}:status:{status}",
                )
                if created and status in PUSH_STATUSES:
                    await _push(db, order, *copy)
            if status == "delivered":
                await notify_user(
                    db, order["user_id"], "review_request", "How was your order?",
                    f"Tell others about {order['shop']}: rate order {order['order_code']}.",
                    link=link, ref_id=order_id, dedupe_key=f"order:{order_id}:review",
                )
        if status == "cancelled":
            await notify_merchant(
                db, order["merchant_id"], "order_cancelled", "Order cancelled",
                f"Order {order['order_code']} was cancelled" + (" by the customer." if by_customer else "."),
                link="/orders", ref_id=order_id, dedupe_key=f"order:{order_id}:cancelled",
            )
    except Exception:
        logger.exception("Order status notification failed for order %s", order_id)


async def order_placed(db, order_id: int) -> None:
    """The customer's receipt in the app, and a new-order alert for the shop (cash orders now;
    online orders when they are paid). Never raises."""
    try:
        order = await _order_context(db, order_id)
        if not order:
            return
        await notify_user(
            db, order["user_id"], "order_placed", "Order placed",
            f"Your order {order['order_code']} was sent to {order['shop']}.",
            link=f"/shop/order/{order_id}", ref_id=order_id, dedupe_key=f"order:{order_id}:placed",
        )
        if order.get("payment_method") not in ("khqr", "stripe"):
            await _new_order_for_shop(db, order)
    except Exception:
        logger.exception("Order placed notification failed for order %s", order_id)


async def order_paid(db, order_id: int) -> None:
    """Payment received: tell the customer and alert the shop. Never raises."""
    try:
        order = await _order_context(db, order_id)
        if not order:
            return
        await notify_user(
            db, order["user_id"], "order_paid", "Payment received",
            f"We received ${float(order['total']):.2f} for order {order['order_code']}.",
            link=f"/shop/order/{order_id}", ref_id=order_id, dedupe_key=f"order:{order_id}:paid",
        )
        await _new_order_for_shop(db, order)
    except Exception:
        logger.exception("Payment notification failed for order %s", order_id)


async def _new_order_for_shop(db, order: dict) -> None:
    await notify_merchant(
        db, order["merchant_id"], "new_order", "New order",
        f"Order {order['order_code']} · ${float(order['total']):.2f}", link="/orders",
        ref_id=order["id"], dedupe_key=f"order:{order['id']}:new",
    )


PAYOUT_COPY = {
    "created": ("Payout prepared", "A payout of ${amount} is being prepared for you."),
    "paid": ("Payout sent", "${amount} was sent to your ABA account{ref}."),
    "failed": ("Payout failed", "The ${amount} payout could not be completed. We will retry."),
    "reversed": ("Payout reversed", "The ${amount} payout was reversed and returned to your balance."),
}


async def payout_event(db, payout: dict | None, event: str) -> None:
    """Tell a shop what happened to its payout. Never raises."""
    try:
        if not payout or event not in PAYOUT_COPY:
            return
        title, body = PAYOUT_COPY[event]
        ref = f" (ref {payout['reference']})" if payout.get("reference") else ""
        await notify_merchant(
            db, payout.get("merchant_id"), "payout", title,
            body.format(amount=f"{float(payout.get('amount') or 0):.2f}", ref=ref),
            link="/earnings", ref_id=payout.get("id"), dedupe_key=f"payout:{payout.get('id')}:{event}",
        )
    except Exception:
        logger.exception("Payout notification failed")
