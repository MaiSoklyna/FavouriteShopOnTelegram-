"""Saved delivery addresses (map pins) for the signed-in customer."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.core.constants import Role
from app.core.dependencies import require_role
from app.core.exceptions import NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.routes.orders import _get_db_user

router = APIRouter(prefix="/addresses", tags=["Addresses"])

MAX_ADDRESSES = 10


class AddressIn(BaseModel):
    label: str = Field("Home", min_length=1, max_length=40)
    address: str = Field(..., min_length=1, max_length=500)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    is_default: bool = False


class AddressPatch(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=40)
    address: str | None = Field(None, min_length=1, max_length=500)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    is_default: bool | None = None


@router.get("")
async def list_addresses(user: TokenClaims = require_role(Role.USER)):
    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)
        rows = await db.from_("customer_addresses").eq("user_id", db_user["id"]).order(
            "created_at", desc=True
        ).select()
    rows.sort(key=lambda r: not r.get("is_default"))
    return {"data": rows}


@router.post("")
async def create_address(body: AddressIn, user: TokenClaims = require_role(Role.USER)):
    from app.core.exceptions import BadRequestError

    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)
        existing = await db.from_("customer_addresses").eq("user_id", db_user["id"]).select("id")
        if len(existing) >= MAX_ADDRESSES:
            raise BadRequestError(f"You can save up to {MAX_ADDRESSES} addresses")

        # The first address is the default; a new default replaces the old one
        make_default = body.is_default or not existing
        if make_default:
            await _clear_default(db, db_user["id"])
        rows = await db.from_("customer_addresses").insert({
            **body.model_dump(),
            "user_id": db_user["id"],
            "is_default": make_default,
        })
    return {"data": rows[0]}


@router.patch("/{address_id}")
async def update_address(address_id: int, body: AddressPatch, user: TokenClaims = require_role(Role.USER)):
    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)
        await _owned(db, address_id, db_user["id"])
        data = body.model_dump(exclude_none=True)
        if data.get("is_default"):
            await _clear_default(db, db_user["id"])
        if data:
            await db.from_("customer_addresses").eq("id", address_id).update(data)
    return {"success": True}


@router.delete("/{address_id}")
async def delete_address(address_id: int, user: TokenClaims = require_role(Role.USER)):
    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)
        row = await _owned(db, address_id, db_user["id"])
        await db.from_("customer_addresses").eq("id", address_id).delete()
        # Deleting the default promotes the newest remaining address
        if row.get("is_default"):
            rest = await db.from_("customer_addresses").eq("user_id", db_user["id"]).order(
                "created_at", desc=True
            ).limit(1).select("id")
            if rest:
                await db.from_("customer_addresses").eq("id", rest[0]["id"]).update({"is_default": True})
    return {"success": True}


async def _owned(db, address_id: int, user_id: int) -> dict:
    row = await db.from_("customer_addresses").eq("id", address_id).eq("user_id", user_id).select_one()
    if not row:
        raise NotFoundError("Address", address_id)
    return row


async def _clear_default(db, user_id: int) -> None:
    await db.from_("customer_addresses").eq("user_id", user_id).eq("is_default", True).update(
        {"is_default": False}
    )
