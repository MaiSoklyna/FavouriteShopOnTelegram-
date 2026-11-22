"""Delivery routes: the driver's app, the shop's assignment tools, and driver management."""

from __future__ import annotations

import httpx
from fastapi import APIRouter

from app.core.constants import Role
from app.core.dependencies import require_any_admin, require_role
from app.core.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.models.delivery import AssignRequest, AvailabilityUpdate, DriverCreate, DriverUpdate, FailRequest
from app.services import deliveries
from app.services.notify import _error_code

router = APIRouter(prefix="/deliveries", tags=["Deliveries"])

DRIVER_FIELDS = "id,user_id,merchant_id,full_name,phone,vehicle,is_active,is_available,created_at"


# ── The driver's app ────────────────────────────────────────────


@router.get("/me")
async def my_driver_profile(user: TokenClaims = require_role(Role.USER)):
    """Who the caller is as a driver. `driver` is null for everyone else (the app uses this to
    decide whether to show the driver screen), so it is not an error."""
    async with SupabaseClient.service_role() as db:
        driver = await deliveries.driver_for_user(db, user)
    if not driver:
        return {"driver": None}
    return {"driver": {k: driver.get(k) for k in DRIVER_FIELDS.split(",") if k != "user_id"}}


@router.patch("/me/availability")
async def set_availability(body: AvailabilityUpdate, user: TokenClaims = require_role(Role.USER)):
    """Go on or off shift. Shops can only give deliveries to drivers who are on shift."""
    async with SupabaseClient.service_role() as db:
        driver = await deliveries.require_driver(db, user)
        await db.from_("drivers").eq("id", driver["id"]).update({"is_available": body.is_available})
    return {"success": True, "is_available": body.is_available}


@router.get("/me/jobs")
async def my_jobs(scope: str = "active", user: TokenClaims = require_role(Role.USER)):
    """The caller's deliveries: `active` (to do) or `done` (delivered, failed, cancelled)."""
    if scope not in ("active", "done"):
        raise BadRequestError("scope must be active or done")
    async with SupabaseClient.service_role() as db:
        driver = await deliveries.require_driver(db, user)
        return {"data": await deliveries.jobs(db, driver, scope)}


@router.post("/jobs/{order_id}/{action}")
async def job_action(order_id: int, action: str, body: FailRequest | None = None,
                     user: TokenClaims = require_role(Role.USER)):
    """accept | decline | pickup | deliver | fail one of the caller's own deliveries."""
    async with SupabaseClient.service_role() as db:
        driver = await deliveries.require_driver(db, user)
        delivery = await deliveries.driver_action(db, driver, order_id, action, reason=body.reason if body else None)
    return {"success": True, "data": {"status": delivery.get("status")}}


# ── The shop: give an order to a driver ─────────────────────────


async def _needs_setup(call):
    """Before migration 028 the drivers table does not exist: say so plainly instead of a server error."""
    try:
        return await call
    except httpx.HTTPStatusError as exc:
        if _error_code(exc) in deliveries.MISSING_TABLE:
            raise BadRequestError("Drivers are not set up on the server yet. Ask the platform admin to finish the setup.")
        raise


async def _shop_order(db, order_id: int, user: TokenClaims) -> dict:
    order = await db.from_("orders").eq("id", order_id).select_one(
        "id,status,merchant_id,order_code,delivery_type")
    if not order:
        raise NotFoundError("Order", order_id)
    if user.role == Role.MERCHANT_ADMIN and order.get("merchant_id") != user.merchant_id:
        raise ForbiddenError("You can only manage your own shop's orders")
    return order


def _assigned_by(user: TokenClaims) -> str:
    return f"{user.role}:{user.sub}"


@router.get("/orders/{order_id}")
async def order_delivery(order_id: int, user: TokenClaims = require_any_admin()):
    """The order's delivery (driver and progress), or null."""
    async with SupabaseClient.service_role() as db:
        await _shop_order(db, order_id, user)
        return {"data": await deliveries.customer_view(db, order_id, for_shop=True)}


@router.get("/orders/{order_id}/drivers")
async def drivers_for_order(order_id: int, user: TokenClaims = require_any_admin()):
    """Drivers this order may be given to: platform drivers plus this shop's own riders."""
    async with SupabaseClient.service_role() as db:
        order = await _shop_order(db, order_id, user)
        return {"data": await _needs_setup(deliveries.assignable_drivers(db, order))}


@router.post("/orders/{order_id}/assign")
async def assign_driver(order_id: int, body: AssignRequest, user: TokenClaims = require_any_admin()):
    async with SupabaseClient.service_role() as db:
        order = await _shop_order(db, order_id, user)
        delivery = await _needs_setup(deliveries.assign(db, order, body.driver_id, by=_assigned_by(user)))
    return {"success": True, "data": {"status": delivery["status"]}}


@router.post("/orders/{order_id}/unassign")
async def unassign_driver(order_id: int, user: TokenClaims = require_any_admin()):
    async with SupabaseClient.service_role() as db:
        order = await _shop_order(db, order_id, user)
        await _needs_setup(deliveries.unassign(db, order))
    return {"success": True}


# ── Driver management ───────────────────────────────────────────
# A shop manages its own riders; the platform manages everyone (including platform drivers).


async def _tolerant(call, empty):
    """Before migration 028 there is no drivers table: show an empty list instead of an error."""
    try:
        return await call
    except httpx.HTTPStatusError as exc:
        if _error_code(exc) in deliveries.MISSING_TABLE:
            return empty
        raise


async def _list_drivers(db, user: TokenClaims) -> list[dict]:
    q = db.from_("drivers").order("full_name")
    if user.role == Role.MERCHANT_ADMIN:
        q = q.eq("merchant_id", user.merchant_id or 0)
    rows = await q.select(DRIVER_FIELDS)
    shops = {m["id"]: m["name"] for m in await db.from_("merchants").select("id,name")} if rows else {}
    busy = await db.from_("deliveries").in_("status", list(deliveries.ACTIVE)).select("driver_id") if rows else []
    load: dict[int, int] = {}
    for d in busy:
        load[d["driver_id"]] = load.get(d["driver_id"], 0) + 1
    return [{**r, "shop_name": shops.get(r["merchant_id"]) if r["merchant_id"] else None, "active_jobs": load.get(r["id"], 0)} for r in rows]


@router.get("/admin/drivers")
async def list_drivers(user: TokenClaims = require_any_admin()):
    async with SupabaseClient.service_role() as db:
        return {"data": await _tolerant(_list_drivers(db, user), [])}


@router.post("/admin/drivers")
async def create_driver(body: DriverCreate, user: TokenClaims = require_any_admin()):
    """Make someone a driver. They must have opened the Telegram bot once (that is how they sign in)."""
    if user.role == Role.MERCHANT_ADMIN:
        merchant_id = user.merchant_id
        if merchant_id is None:
            raise ForbiddenError("This account is not linked to a shop")
    else:
        merchant_id = body.merchant_id  # None = platform driver
    async with SupabaseClient.service_role() as db:
        person = await db.from_("users").eq("telegram_id", body.telegram_id).select_one("id")
        if not person:
            raise BadRequestError("No account with that Telegram ID. Ask them to open the bot once first.")
        if merchant_id is not None and not await db.from_("merchants").eq("id", merchant_id).select_one("id"):
            raise NotFoundError("Merchant", merchant_id)
        try:
            rows = await _needs_setup(db.from_("drivers").insert({
                "user_id": person["id"], "merchant_id": merchant_id, "full_name": body.full_name.strip(),
                "phone": body.phone.strip(), "vehicle": (body.vehicle or "").strip() or None,
            }))
        except httpx.HTTPStatusError as exc:
            if _error_code(exc) == "23505":
                raise ConflictError("That person is already a driver")
            raise
    return {"success": True, "data": rows[0]}


@router.patch("/admin/drivers/{driver_id}")
async def update_driver(driver_id: int, body: DriverUpdate, user: TokenClaims = require_any_admin()):
    async with SupabaseClient.service_role() as db:
        driver = await _needs_setup(db.from_("drivers").eq("id", driver_id).select_one("id,merchant_id"))
        if not driver:
            raise NotFoundError("Driver", driver_id)
        if user.role == Role.MERCHANT_ADMIN and driver["merchant_id"] != user.merchant_id:
            # A platform driver or another shop's rider looks the same as one that does not exist
            raise NotFoundError("Driver", driver_id)
        changes = body.model_dump(exclude_none=True)
        if "vehicle" in body.model_fields_set and body.vehicle is None:
            changes["vehicle"] = None
        if changes:
            await db.from_("drivers").eq("id", driver_id).update(changes)
    return {"success": True}
