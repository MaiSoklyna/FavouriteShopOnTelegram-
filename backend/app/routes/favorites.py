"""Favorites routes: a customer saves products and shops and finds them again on the Favorites page."""

from __future__ import annotations

from fastapi import APIRouter

from app.core.constants import Role
from app.core.dependencies import require_role
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.models.favorites import SyncRequest
from app.routes.merchants import public_view, shop_category_names
from app.routes.orders import _get_db_user
from app.services import favorites

router = APIRouter(prefix="/favorites", tags=["Favorites"])


@router.get("/ids")
async def my_favorite_ids(user: TokenClaims = require_role(Role.USER)):
    """Just the ids, so every heart on a page can show its state from one request."""
    async with SupabaseClient.service_role() as db:
        person = await _get_db_user(db, user)
        return await favorites.ids_for(db, person["id"])


@router.get("/products")
async def my_favorite_products(user: TokenClaims = require_role(Role.USER)):
    async with SupabaseClient.service_role() as db:
        person = await _get_db_user(db, user)
        return {"data": await favorites.products_for(db, person["id"])}


@router.get("/shops")
async def my_favorite_shops(user: TokenClaims = require_role(Role.USER)):
    async with SupabaseClient.service_role() as db:
        person = await _get_db_user(db, user)
        return {"data": await favorites.shops_for(db, person["id"], public_view, shop_category_names)}


@router.put("/products/{product_id}")
async def save_product(product_id: int, user: TokenClaims = require_role(Role.USER)):
    async with SupabaseClient.service_role() as db:
        person = await _get_db_user(db, user)
        added = await favorites.add(db, person["id"], "product", product_id)
    return {"success": True, "added": added}


@router.delete("/products/{product_id}")
async def unsave_product(product_id: int, user: TokenClaims = require_role(Role.USER)):
    async with SupabaseClient.service_role() as db:
        person = await _get_db_user(db, user)
        await favorites.remove(db, person["id"], "product", product_id)
    return {"success": True}


@router.put("/shops/{merchant_id}")
async def save_shop(merchant_id: int, user: TokenClaims = require_role(Role.USER)):
    async with SupabaseClient.service_role() as db:
        person = await _get_db_user(db, user)
        added = await favorites.add(db, person["id"], "shop", merchant_id)
    return {"success": True, "added": added}


@router.delete("/shops/{merchant_id}")
async def unsave_shop(merchant_id: int, user: TokenClaims = require_role(Role.USER)):
    async with SupabaseClient.service_role() as db:
        person = await _get_db_user(db, user)
        await favorites.remove(db, person["id"], "shop", merchant_id)
    return {"success": True}


@router.post("/sync")
async def sync_device_hearts(body: SyncRequest, user: TokenClaims = require_role(Role.USER)):
    """First login on a device: add the products hearted before signing in to the account."""
    async with SupabaseClient.service_role() as db:
        person = await _get_db_user(db, user)
        result = await favorites.merge(db, person["id"], body.product_ids)
        return {"success": True, **result, **await favorites.ids_for(db, person["id"])}
