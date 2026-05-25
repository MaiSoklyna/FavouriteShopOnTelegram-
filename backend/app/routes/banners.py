"""Category banner routes — super admin manages promotional banners linked to categories."""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, File, UploadFile
from pydantic import BaseModel, Field

from app.core.constants import Role
from app.core.dependencies import require_role
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import StorageClient, SupabaseClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/category-banners", tags=["CategoryBanners"])

ALLOWED_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MAX_IMAGE_BYTES = 4 * 1024 * 1024


class BannerCreate(BaseModel):
    category_id: int
    title: str = Field(..., min_length=1, max_length=200)
    subtitle: str | None = Field(None, max_length=500)
    placement: str = Field("home", pattern=r"^(home|category)$")


class BannerUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    subtitle: str | None = Field(None, max_length=500)
    category_id: int | None = None
    placement: str | None = Field(None, pattern=r"^(home|category)$")
    sort_order: int | None = None
    is_active: bool | None = None


@router.get("")
async def list_banners(placement: str | None = None, category_id: int | None = None):
    """List active banners (public). Filterable by placement and category_id."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("category_banners").eq("is_active", True).order("sort_order")
        if placement:
            q = q.eq("placement", placement)
        if category_id:
            q = q.eq("category_id", category_id)
        banners = await q.select()

        cat_ids = list({b["category_id"] for b in banners})
        if cat_ids:
            cats = await db.from_("categories").in_("id", cat_ids).select("id,name")
            cat_map = {c["id"]: c["name"] for c in cats}
            for b in banners:
                b["category_name"] = cat_map.get(b["category_id"])

        return banners


@router.get("/all")
async def list_all_banners(user: TokenClaims = require_role(Role.SUPER_ADMIN)):
    """List all banners including inactive (super admin)."""
    async with SupabaseClient.service_role() as db:
        banners = await db.from_("category_banners").order("sort_order").select()

        cat_ids = list({b["category_id"] for b in banners})
        if cat_ids:
            cats = await db.from_("categories").in_("id", cat_ids).select("id,name")
            cat_map = {c["id"]: c["name"] for c in cats}
            for b in banners:
                b["category_name"] = cat_map.get(b["category_id"])

        return banners


@router.post("")
async def create_banner(body: BannerCreate, user: TokenClaims = require_role(Role.SUPER_ADMIN)):
    """Create a category banner (super admin)."""
    async with SupabaseClient.service_role() as db:
        cat = await db.from_("categories").eq("id", body.category_id).select_one("id")
        if not cat:
            raise NotFoundError("Category", body.category_id)

        rows = await db.from_("category_banners").insert({
            "category_id": body.category_id,
            "title": body.title,
            "subtitle": body.subtitle,
            "placement": body.placement,
        })
        return rows[0] if rows else {"success": True}


@router.post("/{banner_id}/image")
async def upload_banner_image(
    banner_id: int,
    file: UploadFile = File(...),
    user: TokenClaims = require_role(Role.SUPER_ADMIN),
):
    """Upload a banner image (super admin)."""
    if file.content_type not in ALLOWED_MIME:
        raise BadRequestError("Image must be PNG, JPEG, WebP, or GIF")

    content = await file.read()
    if len(content) > MAX_IMAGE_BYTES:
        raise BadRequestError("Image too large (max 4 MB)")

    ext = file.filename.rsplit(".", 1)[-1] if file.filename else "jpg"
    path = f"category-banners/{banner_id}/{int(time.time() * 1000)}.{ext}"

    storage = StorageClient()
    public_url = await storage.upload(
        bucket="product-images",
        path=path,
        content=content,
        content_type=file.content_type or "application/octet-stream",
    )

    async with SupabaseClient.service_role() as db:
        banner = await db.from_("category_banners").eq("id", banner_id).select_one("id")
        if not banner:
            raise NotFoundError("Banner", banner_id)
        await db.from_("category_banners").eq("id", banner_id).update({"image_url": public_url})

    return {"url": public_url}


@router.patch("/{banner_id}")
async def update_banner(banner_id: int, body: BannerUpdate, user: TokenClaims = require_role(Role.SUPER_ADMIN)):
    """Update a category banner (super admin)."""
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("category_banners").eq("id", banner_id).select_one("id")
        if not existing:
            raise NotFoundError("Banner", banner_id)

        data = body.model_dump(exclude_none=True)
        if not data:
            raise BadRequestError("No fields to update")

        await db.from_("category_banners").eq("id", banner_id).update(data)
    return {"success": True}


@router.delete("/{banner_id}")
async def delete_banner(banner_id: int, user: TokenClaims = require_role(Role.SUPER_ADMIN)):
    """Delete a category banner (super admin)."""
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("category_banners").eq("id", banner_id).select_one("id")
        if not existing:
            raise NotFoundError("Banner", banner_id)
        await db.from_("category_banners").eq("id", banner_id).delete()
    return {"success": True}
