"""Deliveries: assigning a driver to a delivery order and moving it from the shop to the customer.

    assigned -> accepted -> picked_up -> delivered        (or failed, or cancelled)

The driver's actions move the *order* too, through the same `order_status.change_status` the shop uses
(picking up = out for delivery, delivering = delivered), so stock, the ledger and the customer's
notifications can never disagree with the delivery.

Never trust the client for who may do what: a driver acts only on deliveries assigned to them, a shop
only assigns its own orders to a driver who works for it or for the platform.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from app.core.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from app.services import delivery_code, notify, order_status

logger = logging.getLogger(__name__)

ACTIVE = ("assigned", "accepted", "picked_up")
FINISHED = ("delivered", "failed", "cancelled")
# A shop can hand an order to a driver after accepting it and before it leaves
ASSIGNABLE_ORDER_STATUSES = ("confirmed", "processing")
DRIVER_ACTIONS = ("accept", "decline", "pickup", "deliver", "fail")
# action -> (status it needs, status it leads to, timestamp column to stamp)
FLOW = {
    "accept": ("assigned", "accepted", "accepted_at"),
    "pickup": ("accepted", "picked_up", "picked_up_at"),
    "deliver": ("picked_up", "delivered", "delivered_at"),
    "fail": ("picked_up", "failed", None),
}
MISSING_TABLE = ("42P01", "PGRST205")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_missing_table(exc: httpx.HTTPStatusError) -> bool:
    return notify._error_code(exc) in MISSING_TABLE


# ── who is a driver ─────────────────────────────────────────────────

async def driver_for_user(db, user) -> dict | None:
    """The drivers row behind a Telegram login (None = not a driver, or the table is not there yet)."""
    if not getattr(user, "telegram_id", None):
        return None
    person = await db.from_("users").eq("telegram_id", user.telegram_id).select_one("id")
    if not person:
        return None
    try:
        return await db.from_("drivers").eq("user_id", person["id"]).select_one()
    except httpx.HTTPStatusError as exc:
        if _is_missing_table(exc):
            return None
        raise


async def require_driver(db, user) -> dict:
    driver = await driver_for_user(db, user)
    if not driver:
        raise ForbiddenError("You are not registered as a driver")
    if not driver.get("is_active"):
        raise ForbiddenError("Your driver account is switched off. Please contact the shop.")
    return driver


# ── the shop side: assign / unassign ────────────────────────────────

async def assignable_drivers(db, order: dict) -> list[dict]:
    """Active drivers this order may be given to: platform drivers and the order's own shop's riders."""
    rows = await (
        db.from_("drivers").eq("is_active", True)
        .or_("merchant_id.is.null", f"merchant_id.eq.{order['merchant_id']}")
        .order("full_name").select("id,full_name,phone,vehicle,merchant_id,is_available")
    )
    busy = await db.from_("deliveries").in_("status", list(ACTIVE)).select("driver_id")
    load: dict[int, int] = {}
    for d in busy:
        load[d["driver_id"]] = load.get(d["driver_id"], 0) + 1
    return [{**r, "active_jobs": load.get(r["id"], 0)} for r in rows]


async def assign(db, order: dict, driver_id: int, *, by: str) -> dict:
    """Give a delivery order to a driver (or hand it to someone else while it has not left yet)."""
    if order.get("delivery_type") != "delivery":
        raise BadRequestError("Only delivery orders need a driver (this one is pickup)")
    existing = await db.from_("deliveries").eq("order_id", order["id"]).select_one()
    # Normally before it leaves; but after a failed delivery the order is already out and needs a new driver
    retry_after_failure = order["status"] == "shipped" and bool(existing) and existing["status"] == "failed"
    if order["status"] not in ASSIGNABLE_ORDER_STATUSES and not retry_after_failure:
        raise BadRequestError("Assign a driver once the shop has accepted the order and before it leaves")

    driver = await db.from_("drivers").eq("id", driver_id).select_one()
    if not driver:
        raise NotFoundError("Driver", driver_id)
    if not driver["is_active"]:
        raise BadRequestError("This driver's account is switched off")
    if driver["merchant_id"] not in (None, order["merchant_id"]):
        raise ForbiddenError("This driver works for another shop")
    if not driver["is_available"]:
        raise BadRequestError("This driver is off shift right now")

    now = _now()
    fresh = {"driver_id": driver_id, "status": "assigned", "assigned_by": by, "assigned_at": now,
             "accepted_at": None, "picked_up_at": None, "delivered_at": None, "failure_reason": None, "updated_at": now}
    if existing:
        if existing["status"] in ("picked_up", "delivered"):
            raise ConflictError("This delivery has already left the shop")
        # Only one request can take over the delivery from the state we just read
        rows = await db.from_("deliveries").eq("id", existing["id"]).eq("status", existing["status"]).update(fresh)
        if not rows:
            raise ConflictError("This delivery was just updated by someone else. Refresh and try again.")
        delivery = rows[0]
    else:
        try:
            delivery = (await db.from_("deliveries").insert({"order_id": order["id"], **fresh}))[0]
        except httpx.HTTPStatusError as exc:
            if notify._error_code(exc) == "23505":
                raise ConflictError("A driver was just assigned to this order. Refresh and try again.")
            raise

    await _tell_driver(db, order, driver, delivery)
    return delivery


async def unassign(db, order: dict) -> None:
    delivery = await db.from_("deliveries").eq("order_id", order["id"]).select_one()
    if not delivery:
        raise NotFoundError("Delivery", order["id"])
    if delivery["status"] in ("picked_up", "delivered"):
        raise BadRequestError("The driver already picked this order up")
    rows = await db.from_("deliveries").eq("id", delivery["id"]).eq("status", delivery["status"]).update(
        {"status": "cancelled", "updated_at": _now()})
    if not rows:
        raise ConflictError("This delivery was just updated by someone else. Refresh and try again.")
    driver = await db.from_("drivers").eq("id", delivery["driver_id"]).select_one("id,user_id")
    if driver:
        await notify.notify_user(db, driver["user_id"], "delivery_update", "Delivery taken off you",
                                 f"The shop gave order {order.get('order_code') or '#' + str(order['id'])} to someone else.",
                                 link="/shop/driver", ref_id=order["id"], dedupe_key=f"delivery:{order['id']}:unassigned:{delivery['id']}:{rows[0].get('updated_at')}")


# ── the driver side ─────────────────────────────────────────────────

async def driver_action(db, driver: dict, order_id: int, action: str, *, reason: str | None = None,
                        code: str | None = None) -> dict:
    """Accept, decline, pick up, deliver or fail one of the driver's own deliveries."""
    if action not in DRIVER_ACTIONS:
        raise BadRequestError("Unknown action")
    delivery = await db.from_("deliveries").eq("order_id", order_id).eq("driver_id", driver["id"]).select_one()
    if not delivery:
        raise NotFoundError("Delivery", order_id)  # also what another driver's job looks like
    order = await db.from_("orders").eq("id", order_id).select_one("id,status,merchant_id,order_code,delivery_type")
    if not order:
        raise NotFoundError("Order", order_id)

    if action == "decline":
        if delivery["status"] not in ("assigned", "accepted"):
            raise BadRequestError(f"You can't decline: this delivery is {delivery['status']}")
        rows = await db.from_("deliveries").eq("id", delivery["id"]).eq("status", delivery["status"]).update(
            {"status": "declined", "updated_at": _now()})
        if not rows:
            raise ConflictError("This delivery was just updated. Refresh and try again.")
        await _tell_shop(db, order, "declined", "Driver declined",
                         f"{driver['full_name']} declined order {order['order_code']}. Please assign another driver.", rows[0])
        return rows[0]

    needs, becomes, stamp = FLOW[action]
    if delivery["status"] != needs:
        raise BadRequestError(f"You can't {action} this: it is {delivery['status']}")
    if order["status"] == "cancelled":
        raise BadRequestError("This order was cancelled")
    if action == "fail" and (not reason or len(reason.strip()) < 3):
        raise BadRequestError("Tell us why it could not be delivered")

    now = _now()
    change = {"status": becomes, "updated_at": now}
    if stamp:
        change[stamp] = now
    if action == "fail":
        change["failure_reason"] = reason.strip()

    if action == "deliver" and order["status"] != "shipped":
        raise BadRequestError("The order has not left the shop yet")
    if action == "deliver":
        await _check_code(db, delivery, order_id, code)

    if action == "pickup":
        if order["status"] not in ("confirmed", "processing", "shipped"):
            raise BadRequestError("The shop has not accepted this order yet")
        # Out for delivery. The order may still be "confirmed": step through preparing first.
        actor = {"actor_type": "driver", "actor_id": str(driver["id"])}
        if order["status"] == "confirmed":
            await order_status.change_status(db, order, "processing", **actor)
        if order["status"] == "processing":
            await order_status.change_status(db, order, "shipped", **actor)

    claimed = await db.from_("deliveries").eq("id", delivery["id"]).eq("status", needs).update(change)
    if not claimed:
        raise ConflictError("This delivery was just updated. Refresh and try again.")

    if action == "deliver":
        try:
            await order_status.change_status(db, order, "delivered", actor_type="driver", actor_id=str(driver["id"]))
        except Exception:
            # Do not leave a delivery marked delivered on an order that is not
            await db.from_("deliveries").eq("id", delivery["id"]).update({"status": needs, "delivered_at": None})
            raise

    if action == "accept":
        await _tell_shop(db, order, "accepted", "Driver accepted",
                         f"{driver['full_name']} accepted order {order['order_code']}.", delivery)
    elif action == "fail":
        await _tell_shop(db, order, "failed", "Delivery failed",
                         f"{driver['full_name']} could not deliver order {order['order_code']}: {change['failure_reason']}", delivery)
    return claimed[0]


async def _check_code(db, delivery: dict, order_id: int, code: str | None) -> None:
    """The customer's code must match before the driver can mark the order delivered."""
    attempts = int(delivery.get("code_attempts") or 0)
    if attempts >= delivery_code.MAX_ATTEMPTS:
        raise ForbiddenError("Too many wrong codes. Call the shop: they can confirm the delivery.")
    if not code or not code.strip():
        raise BadRequestError("Ask the customer for their 4-digit delivery code.")
    if delivery_code.matches(order_id, code):
        return
    left = delivery_code.MAX_ATTEMPTS - attempts - 1
    if "code_attempts" in delivery:  # counted from migration 040 on
        await db.from_("deliveries").eq("id", delivery["id"]).eq("code_attempts", attempts).update(
            {"code_attempts": attempts + 1})
    raise BadRequestError("That code is not right." + (f" {left} {'try' if left == 1 else 'tries'} left." if left > 0
                          else " Call the shop: they can confirm the delivery."))


# ── keeping a delivery in step with its order (called by order_status) ──

async def order_cancelled(db, order_id: int) -> None:
    """The order was cancelled: the driver's job is cancelled too, and they are told. Never raises."""
    try:
        delivery = await db.from_("deliveries").eq("order_id", order_id).select_one()
        if not delivery or delivery["status"] not in ACTIVE:
            return
        rows = await db.from_("deliveries").eq("id", delivery["id"]).eq("status", delivery["status"]).update(
            {"status": "cancelled", "updated_at": _now()})
        if not rows:
            return
        driver = await db.from_("drivers").eq("id", delivery["driver_id"]).select_one("id,user_id")
        order = await db.from_("orders").eq("id", order_id).select_one("order_code")
        if driver and order:
            await notify.notify_user(db, driver["user_id"], "delivery_update", "Delivery cancelled",
                                     f"Order {order['order_code']} was cancelled. No need to deliver it.",
                                     link="/shop/driver", ref_id=order_id, dedupe_key=f"delivery:{order_id}:cancelled:{delivery['id']}")
    except httpx.HTTPStatusError as exc:
        if not _is_missing_table(exc):
            logger.exception("Could not cancel delivery for order %s", order_id)
    except Exception:
        logger.exception("Could not cancel delivery for order %s", order_id)


async def order_delivered(db, order_id: int) -> None:
    """The shop marked the order delivered itself: close the delivery. Never raises."""
    try:
        delivery = await db.from_("deliveries").eq("order_id", order_id).select_one()
        if delivery and delivery["status"] in ACTIVE:
            await db.from_("deliveries").eq("id", delivery["id"]).eq("status", delivery["status"]).update(
                {"status": "delivered", "delivered_at": _now(), "updated_at": _now()})
    except httpx.HTTPStatusError as exc:
        if not _is_missing_table(exc):
            logger.exception("Could not close delivery for order %s", order_id)
    except Exception:
        logger.exception("Could not close delivery for order %s", order_id)


# ── read models ─────────────────────────────────────────────────────

async def jobs(db, driver: dict, scope: str) -> list[dict]:
    """The driver's deliveries with everything needed to do the job (and nothing about other drivers)."""
    statuses = list(ACTIVE) if scope == "active" else list(FINISHED)
    rows = await (
        db.from_("deliveries").eq("driver_id", driver["id"]).in_("status", statuses)
        .order("updated_at", desc=True).limit(50).select()
    )
    out = []
    for d in rows:
        order = await db.from_("orders").eq("id", d["order_id"]).select_one(
            "id,order_code,status,total,payment_method,payment_status,merchant_id,customer_name,customer_phone,delivery_name,"
            "delivery_phone,delivery_address,delivery_latitude,delivery_longitude,distance_km,customer_note,created_at")
        if not order:
            continue
        shop = await db.from_("merchants").eq("id", order["merchant_id"]).select_one(
            "id,name,phone,address,latitude,longitude") or {}
        items = await db.from_("order_items").eq("order_id", order["id"]).select("product_name,quantity")
        cod = order.get("payment_method") == "cod" and order.get("payment_status") != "paid"
        out.append({
            "delivery": {k: d.get(k) for k in ("id", "status", "assigned_at", "accepted_at", "picked_up_at", "delivered_at", "failure_reason")},
            "order": {
                "id": order["id"], "code": order["order_code"], "status": order["status"], "total": order["total"],
                "payment_method": order["payment_method"], "note": order.get("customer_note"), "created_at": order.get("created_at"),
                "item_count": sum(i["quantity"] for i in items), "items": [f"{i['quantity']} × {i['product_name']}" for i in items][:6],
            },
            "collect_cash": float(order["total"]) if cod else 0.0,
            "shop": {"name": shop.get("name"), "phone": shop.get("phone"), "address": shop.get("address"),
                     "lat": shop.get("latitude"), "lng": shop.get("longitude")},
            "customer": {"name": order.get("delivery_name") or order.get("customer_name"),
                         "phone": order.get("delivery_phone") or order.get("customer_phone"),
                         "address": order.get("delivery_address"), "lat": order.get("delivery_latitude"),
                         "lng": order.get("delivery_longitude"), "distance_km": order.get("distance_km")},
        })
    return out


async def customer_view(db, order_id: int, *, for_shop: bool = False) -> dict | None:
    """What the customer may see of their delivery: who is coming and how far it got.
    The shop also sees why a delivery failed (the customer does not)."""
    try:
        delivery = await db.from_("deliveries").eq("order_id", order_id).select_one()
        if not delivery or delivery["status"] in ("cancelled", "declined"):
            return None
        driver = await db.from_("drivers").eq("id", delivery["driver_id"]).select_one("full_name,phone,vehicle")
        view = {
            "status": delivery["status"],
            "driver": {"name": (driver or {}).get("full_name"), "phone": (driver or {}).get("phone"), "vehicle": (driver or {}).get("vehicle")},
            "accepted_at": delivery.get("accepted_at"), "picked_up_at": delivery.get("picked_up_at"), "delivered_at": delivery.get("delivered_at"),
        }
        if for_shop:
            view["failure_reason"] = delivery.get("failure_reason")
        elif delivery["status"] in ACTIVE:
            # Only the customer sees it: they give it to the driver at the door
            view["confirmation_code"] = delivery_code.code_for(order_id)
        return view
    except httpx.HTTPStatusError as exc:
        if _is_missing_table(exc):
            return None
        raise


# ── telling people ──────────────────────────────────────────────────

async def _tell_driver(db, order: dict, driver: dict, delivery: dict) -> None:
    try:
        full = await db.from_("orders").eq("id", order["id"]).select_one("order_code,delivery_address,total")
        shop = await db.from_("merchants").eq("id", order["merchant_id"]).select_one("name") or {}
        code = (full or {}).get("order_code") or order.get("order_code") or f"#{order['id']}"
        body = f"{shop.get('name') or 'A shop'} → {(full or {}).get('delivery_address') or 'the customer'} · order {code}"
        created = await notify.notify_user(
            db, driver["user_id"], "delivery_assigned", "New delivery", body, link="/shop/driver", ref_id=order["id"],
            dedupe_key=f"delivery:{order['id']}:assigned:{delivery['id']}:{delivery.get('assigned_at')}")
        if created:
            await notify.push_to_driver(db, driver, title="New delivery", body=body)
    except Exception:
        logger.exception("Driver notification failed for order %s", order.get("id"))


async def _tell_shop(db, order: dict, event: str, title: str, body: str, delivery: dict) -> None:
    await notify.notify_merchant(
        db, order["merchant_id"], "delivery_update", title, body, link="/orders", ref_id=order["id"],
        dedupe_key=f"delivery:{order['id']}:{event}:{delivery['id']}:{delivery.get('updated_at') or delivery.get('assigned_at')}")
