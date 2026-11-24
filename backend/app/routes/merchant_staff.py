"""Shop staff accounts, roles and the shop activity log.

Owners invite (add), change, deactivate and remove their shop's people and give each one a role:
Manager or Staff. What each role may do is the matrix in app/core/permissions.py, served to the
dashboard by GET /merchant-permissions. Owners and managers read the activity log: who changed
what in the shop, and when.
"""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone

import httpx
from fastapi import APIRouter, Query

from app.core.constants import Role, ShopRole, shop_role
from app.core import permissions
from app.core.dependencies import forget_staff_check, require_any_admin, require_permission, require_shop_owner_only
from app.core.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims, hash_password
from app.db.client import SupabaseClient
from app.models.staff import StaffCreate, StaffUpdate
from app.services import audit
from app.services.delivery import SHOP_TZ

router = APIRouter(tags=["Shop staff and activity"])

ACCOUNT_FIELDS = "id,merchant_id,full_name,email,role,is_active,telegram_id,last_login,created_at"
MIGRATION_HINT = "The activity log needs supabase/migrations/034_merchant_staff_audit.sql to be run first"
MANAGER_MIGRATION_HINT = "The Manager role needs supabase/migrations/037_shop_manager_role.sql to be run first"


def _view(row: dict, me: TokenClaims) -> dict:
    return {
        "id": row["id"], "full_name": row.get("full_name"), "email": row.get("email"),
        "role": shop_role(row.get("role")), "is_active": bool(row.get("is_active")),
        "telegram_id": row.get("telegram_id"), "last_login": row.get("last_login"),
        "created_at": row.get("created_at"), "is_you": str(row["id"]) == me.sub,
    }


def _shop(user: TokenClaims) -> int:
    if user.merchant_id is None:
        raise ForbiddenError("This account is not linked to a shop")
    return user.merchant_id


async def _check_unique(db, *, email: str | None = None, telegram_id: int | None = None, not_id: int | None = None) -> None:
    if email:
        for table in ("merchant_admins", "super_admins"):
            rows = await db.from_(table).eq("email", email).select("id")
            if any(not (table == "merchant_admins" and r["id"] == not_id) for r in rows):
                raise ConflictError("That email is already used by another account")
    if telegram_id:
        rows = await db.from_("merchant_admins").eq("telegram_id", telegram_id).select("id")
        if any(r["id"] != not_id for r in rows):
            raise ConflictError("That Telegram account is already linked to another shop account")


async def _own_staff(db, staff_id: int, user: TokenClaims) -> dict:
    """A manager or staff account of the owner's shop. Owners (including yourself) cannot be changed here."""
    row = await db.from_("merchant_admins").eq("id", staff_id).select_one(ACCOUNT_FIELDS)
    if not row or row.get("merchant_id") != user.merchant_id:
        raise NotFoundError("Staff member", staff_id)
    if shop_role(row.get("role")) == ShopRole.OWNER:
        raise ForbiddenError("Owner accounts cannot be changed here")
    return row


def _role_not_allowed_yet(exc: httpx.HTTPStatusError) -> bool:
    """The database still only knows owner/staff (migration 037 not run)."""
    return "23514" in exc.response.text and "role" in exc.response.text


# ── Roles and permissions ──────────────────────────────────────


@router.get("/merchant-permissions")
async def my_permissions(user: TokenClaims = require_any_admin()):
    """The permission matrix, and what the signed-in person may do (the dashboard hides the rest)."""
    if user.is_super_admin:
        mine = [str(p) for p in permissions.Perm]
        role = None
    else:
        role = user.shop_role
        mine = sorted(str(p) for p in permissions.ROLE_PERMISSIONS.get(role, ()))
    return {"role": role, "permissions": mine, "matrix": permissions.matrix()}


# ── Staff accounts ─────────────────────────────────────────────


@router.get("/merchant-staff")
async def list_staff(user: TokenClaims = require_shop_owner_only()):
    """Everyone who can sign in to this shop: the owner(s) first, then staff."""
    async with SupabaseClient.service_role() as db:
        rows = await db.from_("merchant_admins").eq("merchant_id", _shop(user)).order("created_at").select(ACCOUNT_FIELDS)
    people = [_view(r, user) for r in rows]
    people.sort(key=lambda p: (p["role"] != ShopRole.OWNER, not p["is_active"], (p["full_name"] or "").lower()))
    return {"data": people}


@router.post("/merchant-staff")
async def add_staff(body: StaffCreate, user: TokenClaims = require_shop_owner_only()):
    """Invite someone: give them their own login for this shop, as Manager or Staff."""
    merchant_id = _shop(user)
    async with SupabaseClient.service_role() as db:
        await _check_unique(db, email=body.email, telegram_id=body.telegram_id)
        row = {
            "merchant_id": merchant_id, "full_name": body.full_name, "email": body.email,
            "password_hash": hash_password(body.password), "role": body.role, "is_active": True,
        }
        if body.telegram_id:
            row["telegram_id"] = body.telegram_id
        try:
            created = (await db.from_("merchant_admins").insert(row))[0]
        except httpx.HTTPStatusError as exc:
            if "23505" in exc.response.text:
                raise ConflictError("That email or Telegram account is already used by another account")
            if _role_not_allowed_yet(exc):
                raise BadRequestError(MANAGER_MIGRATION_HINT) from exc
            raise
        await audit.record(
            db, user, merchant_id=merchant_id, action="staff.added", target_type="staff",
            target_id=created["id"], target_label=body.full_name,
            new={"full_name": body.full_name, "email": body.email, "telegram_id": body.telegram_id, "role": body.role},
        )
    return {"success": True, "data": _view(created, user)}


@router.patch("/merchant-staff/{staff_id}")
async def update_staff(staff_id: int, body: StaffUpdate, user: TokenClaims = require_shop_owner_only()):
    """Rename, change email or role, reset password, link Telegram, or deactivate/reactivate someone."""
    async with SupabaseClient.service_role() as db:
        row = await _own_staff(db, staff_id, user)
        changes: dict = {}
        if body.full_name is not None:
            changes["full_name"] = body.full_name
        if body.email is not None and body.email != row.get("email"):
            await _check_unique(db, email=body.email, not_id=staff_id)
            changes["email"] = body.email
        if body.clear_telegram_id:
            changes["telegram_id"] = None
        elif body.telegram_id is not None and body.telegram_id != row.get("telegram_id"):
            await _check_unique(db, telegram_id=body.telegram_id, not_id=staff_id)
            changes["telegram_id"] = body.telegram_id
        if body.is_active is not None:
            changes["is_active"] = body.is_active
        if body.role is not None and body.role != shop_role(row.get("role")):
            changes["role"] = body.role
        if body.new_password is not None:
            changes["password_hash"] = hash_password(body.new_password)
        if not changes:
            raise BadRequestError("Nothing to change")

        try:
            await db.from_("merchant_admins").eq("id", staff_id).update(changes)
        except httpx.HTTPStatusError as exc:
            if _role_not_allowed_yet(exc):
                raise BadRequestError(MANAGER_MIGRATION_HINT) from exc
            raise
        forget_staff_check(staff_id)  # a new role or deactivation takes effect on their next request

        visible = {k: v for k, v in changes.items() if k != "password_hash"}
        old, new = audit.diff(row, visible)
        if "password_hash" in changes:  # record that it changed, never the password
            old["password"], new["password"] = "(hidden)", "(reset)"
        if new:
            if set(new) == {"is_active"}:
                action = "staff.reactivated" if new["is_active"] else "staff.deactivated"
            elif set(new) == {"role"}:
                action = "staff.role_changed"
            else:
                action = "staff.updated"
            await audit.record(
                db, user, merchant_id=row["merchant_id"], action=action, target_type="staff",
                target_id=staff_id, target_label=changes.get("full_name") or row.get("full_name"), old=old, new=new,
            )
        row.update(changes)
    return {"success": True, "data": _view(row, user)}


@router.delete("/merchant-staff/{staff_id}")
async def remove_staff(staff_id: int, user: TokenClaims = require_shop_owner_only()):
    """Remove a staff login. Their past actions stay in the activity log under their name."""
    async with SupabaseClient.service_role() as db:
        row = await _own_staff(db, staff_id, user)
        await db.from_("merchant_admins").eq("id", staff_id).delete()
        forget_staff_check(staff_id)
        await audit.record(
            db, user, merchant_id=row["merchant_id"], action="staff.removed", target_type="staff",
            target_id=staff_id, target_label=row.get("full_name"),
            old={"full_name": row.get("full_name"), "email": row.get("email"), "is_active": row.get("is_active")},
        )
    return {"success": True}


# ── Activity log ───────────────────────────────────────────────


def _day_start(d: date) -> str:
    """Midnight in the shop's time zone, as UTC."""
    return datetime.combine(d, time.min, tzinfo=SHOP_TZ).astimezone(timezone.utc).isoformat()


_SEARCH_SAFE = re.compile(r"[^\w\s#.@'&-]", re.UNICODE)


@router.get("/merchant-activity")
async def activity_log(
    merchant_id: int | None = None,
    action: str | None = Query(None, max_length=60, description="An action (product.price_changed) or a group (product)"),
    actor_id: str | None = Query(None, max_length=40),
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = Query(None, max_length=100, description="Search the product, order, driver, coupon or person name"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    user: TokenClaims = require_permission(permissions.Perm.ACTIVITY_VIEW),
):
    """Who changed what in the shop, newest first.

    Owners and managers see their own shop; super admins pick one. `actor_id` gives one person's
    history (the Staff page links here for each person).
    """
    if user.role == Role.MERCHANT_ADMIN:
        shop = _shop(user)
    else:
        if merchant_id is None:
            raise BadRequestError("merchant_id is required")
        shop = merchant_id
    if date_from and date_to and date_from > date_to:
        raise BadRequestError("The start date is after the end date")

    async with SupabaseClient.service_role() as db:
        query = db.from_(audit.TABLE).eq("merchant_id", shop)
        if action:
            if action in audit.ACTION_GROUPS:
                query = query.in_("action", list(audit.ACTION_GROUPS[action]))
            elif action in audit.ACTIONS:
                query = query.eq("action", action)
            else:
                raise BadRequestError("Unknown action type")
        if actor_id:
            query = query.eq("actor_id", actor_id)
        if date_from:
            query = query.gte("created_at", _day_start(date_from))
        if date_to:
            query = query.lt("created_at", _day_start(date_to + timedelta(days=1)))
        if q:
            term = _SEARCH_SAFE.sub(" ", q).strip()
            if term:
                query = query.or_(f"target_label.ilike.*{term}*", f"actor_name.ilike.*{term}*")
        query = query.order("created_at", desc=True).order("id", desc=True)
        query = query.offset((page - 1) * page_size).limit(page_size + 1)
        try:
            rows = await query.select(
                "id,actor_type,actor_id,actor_name,action,target_type,target_id,target_label,old_value,new_value,created_at")
        except httpx.HTTPStatusError as exc:
            if "PGRST205" in exc.response.text or "42P01" in exc.response.text:
                raise BadRequestError(MIGRATION_HINT) from exc
            raise
        people = await db.from_("merchant_admins").eq("merchant_id", shop).order("full_name").select("id,full_name,role")

    return {
        "data": rows[:page_size],
        "page": page,
        "has_more": len(rows) > page_size,
        "action_groups": {k: list(v) for k, v in audit.ACTION_GROUPS.items()},
        "people": [{"id": str(p["id"]), "name": p.get("full_name"), "role": shop_role(p.get("role"))} for p in people],
    }
