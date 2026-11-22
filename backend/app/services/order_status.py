"""Changing an order's status: the one place it happens.

Shops (admin orders page) and drivers (delivery app) both move an order forward through here, so the
same rules always apply: only allowed transitions, only one request can win a transition, a cancelled
order gives its stock back, a delivered order makes its earning payable, and the customer (and the
shop on a cancellation) is told.
"""

from __future__ import annotations

from app.core.constants import ORDER_STATUS_TRANSITIONS
from app.core.exceptions import BadRequestError, ConflictError
from app.services import coupons, inventory, notify, settlement


async def change_status(
    db, order: dict, new_status: str, *,
    actor_type: str, actor_id: str | None,
    admin_note: str | None = None, payment_status: str | None = None,
) -> None:
    """Move `order` (needs id and status) to `new_status`. Raises BadRequestError for a transition that is
    not allowed and ConflictError if someone else changed the order first."""
    order_id = order["id"]
    allowed = ORDER_STATUS_TRANSITIONS.get(order["status"], [])
    if new_status not in allowed:
        raise BadRequestError(f"Cannot transition from '{order['status']}' to '{new_status}'. Allowed: {allowed}")

    update_data: dict = {"status": new_status}
    if admin_note:
        update_data["admin_note"] = admin_note
    if payment_status:
        update_data["payment_status"] = payment_status

    actor = {"actor_type": actor_type, "actor_id": actor_id}
    # Reverse first: it refuses if the earning sits in an open payout, and that must stop the
    # cancellation too.
    if new_status == "cancelled":
        await settlement.on_order_status_changed(db, order_id, new_status, reason=admin_note, **actor)

    # Only apply the change if the order is still in the status we validated against, so two people
    # (or two taps) cannot both make the same transition.
    changed = await db.from_("orders").eq("id", order_id).eq("status", order["status"]).update(update_data)
    if not changed:
        raise ConflictError("This order was just updated by someone else. Refresh and try again.")

    if new_status == "cancelled":
        # A cancelled order no longer holds stock
        items = await db.from_("order_items").eq("order_id", order_id).select("product_id,quantity,selected_variants")
        await inventory.release_stock(db, items)
        await coupons.release_for_order(db, order_id)

    if new_status == "delivered":
        await settlement.on_order_status_changed(db, order_id, new_status, **actor)

    # Keep the delivery (if a driver has one) in step with the order
    from app.services import deliveries  # late import: deliveries uses this module too
    if new_status == "cancelled":
        await deliveries.order_cancelled(db, order_id)
    elif new_status == "delivered":
        await deliveries.order_delivered(db, order_id)

    # Tell the customer (and the shop on a cancellation); on delivery, ask how it went
    await notify.order_status_changed(db, order_id, new_status)
    order["status"] = new_status
