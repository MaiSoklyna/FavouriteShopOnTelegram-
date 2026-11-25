"""Shop activity log: who changed what in a shop, and when.

Every important change a shop's people make (products, prices, orders, drivers, promotions,
coupons, shop settings, payout account, staff) is written to `merchant_audit_log`
(migration 034). The table is append-only. Each row keeps a copy of the person's name and
of the target's name, so the log still reads well after either is removed.

Writing to the log never breaks the change itself: any failure is logged and swallowed,
and before migration 034 is run the log is skipped with one warning.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable

import httpx

from app.core.constants import Role, shop_role
from app.core.security import TokenClaims

logger = logging.getLogger(__name__)

TABLE = "merchant_audit_log"
MISSING_TABLE = ("PGRST205", "42P01")

# What the activity page offers as filters, grouped the way an owner thinks about them
ACTION_GROUPS: dict[str, tuple[str, ...]] = {
    "product": ("product.created", "product.updated", "product.price_changed", "product.deleted",
                "product.variants_changed", "product.image_added", "product.image_removed"),
    "order": ("order.accepted", "order.rejected", "order.status_changed", "order.expired",
              "order.driver_assigned", "order.driver_unassigned"),
    "driver": ("driver.added", "driver.updated", "driver.activated", "driver.deactivated"),
    "promotion": ("promotion.created", "promotion.updated", "promotion.disabled", "promotion.deleted"),
    "collection": ("collection.created", "collection.updated", "collection.products_changed", "collection.deleted"),
    "coupon": ("coupon.created", "coupon.updated", "coupon.disabled", "coupon.deleted", "coupon.granted"),
    "shop": ("shop.profile_updated", "shop.settings_updated"),
    "payout": ("payout.account_updated", "payout.verification_changed"),
    "refund": ("refund.requested", "refund.completed"),
    "staff": ("staff.added", "staff.updated", "staff.role_changed", "staff.deactivated", "staff.reactivated",
              "staff.removed"),
    "access": ("account.login", "account.logout", "account.password_reset"),
}
ACTIONS = frozenset(a for group in ACTION_GROUPS.values() for a in group)

_warned_missing = False


def jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [jsonable(v) for v in value]
    return value


def _same(a: Any, b: Any) -> bool:
    """Equal for audit purposes: 15 == 15.0 == Decimal("15.00"), None == ""."""
    if a in (None, "") and b in (None, ""):
        return True
    try:
        if isinstance(a, (int, float, Decimal, str)) and isinstance(b, (int, float, Decimal)) and not isinstance(a, bool):
            return Decimal(str(a)) == Decimal(str(b))
    except Exception:
        pass
    return jsonable(a) == jsonable(b)


same_value = _same  # public name for routes that compare a submitted value with the stored one


def diff(before: dict, after: dict, fields: Iterable[str] | None = None) -> tuple[dict, dict]:
    """Only the fields that really changed: (old values, new values)."""
    keys = list(fields) if fields is not None else list(after.keys())
    old, new = {}, {}
    for k in keys:
        if k not in after:
            continue
        if not _same(before.get(k), after.get(k)):
            old[k], new[k] = jsonable(before.get(k)), jsonable(after.get(k))
    return old, new


async def _actor(db, user: TokenClaims | None) -> tuple[str, str | None, str | None]:
    """(actor_type, actor_id, actor_name) for the person making the change."""
    if user is None:
        return "system", None, "System"
    if user.role == Role.SUPER_ADMIN:
        actor_type, table = "super_admin", "super_admins"
    elif user.role == Role.MERCHANT_ADMIN:
        actor_type, table = shop_role(user.merchant_role), "merchant_admins"
    else:
        actor_type, table = "user", "users"
    name = user.name
    if not name and table != "users":
        try:
            row = await db.from_(table).eq("id", int(user.sub)).select_one("full_name")
            name = (row or {}).get("full_name")
        except Exception:
            name = None
    if not name:
        name = "Platform admin" if actor_type == "super_admin" else (user.email or f"#{user.sub}")
    return actor_type, user.sub, name


async def record(
    db, user: TokenClaims | None, *, merchant_id: int | None, action: str,
    target_type: str, target_id: int | None = None, target_label: str | None = None,
    old: dict | None = None, new: dict | None = None,
) -> None:
    """Write one entry to the shop's activity log. Never raises."""
    global _warned_missing
    if merchant_id is None:  # platform-wide things (e.g. a platform promotion) belong to no shop's log
        return
    try:
        actor_type, actor_id, actor_name = await _actor(db, user)
        await db.from_(TABLE).insert({
            "merchant_id": merchant_id,
            "actor_type": actor_type,
            "actor_id": actor_id,
            "actor_name": actor_name,
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "target_label": (target_label or "").strip()[:200] or None,
            "old_value": jsonable(old) if old else None,
            "new_value": jsonable(new) if new else None,
        })
    except httpx.HTTPStatusError as exc:
        code = None
        try:
            code = exc.response.json().get("code")
        except Exception:
            pass
        if code in MISSING_TABLE:
            if not _warned_missing:
                logger.warning("Activity log is off: run supabase/migrations/034_merchant_staff_audit.sql")
                _warned_missing = True
            return
        logger.exception("Could not write activity log entry %s for shop %s", action, merchant_id)
    except Exception:
        logger.exception("Could not write activity log entry %s for shop %s", action, merchant_id)


# Order status changes made by a shop, named the way an owner reads them
def order_action(old_status: str, new_status: str) -> str:
    if old_status == "pending" and new_status == "confirmed":
        return "order.accepted"
    if old_status == "pending" and new_status == "cancelled":
        return "order.rejected"
    return "order.status_changed"
