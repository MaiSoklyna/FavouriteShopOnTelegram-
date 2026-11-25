"""Merchant collections: a shop's own curated, ordered product lists ("Birthday Cakes", "Christmas Gifts").

A collection belongs to exactly one shop and holds only that shop's products, in the shop's order.
Customers see it only when it is active, inside its optional date range, and has at least one
active product. Shop owners and staff manage them (marketing work, like promotions); every change
goes to the shop's activity log.

Only manual collections exist today. The `smart` type is reserved for rule-based collections later.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, File, UploadFile

from app.core.constants import Role
from app.core.dependencies import require_any_admin
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import StorageClient, SupabaseClient
from app.models.collection import MAX_COLLECTIONS_PER_SHOP, CollectionIn, CollectionProducts
from app.services import audit, shop_setup

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Collections"])

TABLE, LINKS = "merchant_collections", "merchant_collection_products"
MIGRATION_HINT = "Collections need supabase/migrations/035_merchant_collections.sql to be run first"
FIELDS = "id,merchant_id,type,title,description,cover_url,sort_order,is_active,starts_at,ends_at,created_at,updated_at"
CARD_FIELDS = ("id,merchant_id,category_id,name,base_price,compare_price,stock,icon_emoji,"
               "rating_avg,review_count,is_featured,is_active,primary_image")
PREVIEW_PRODUCTS = 12
ALLOWED_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MAX_COVER_BYTES = 4 * 1024 * 1024


def _missing(exc: Exception) -> bool:
    resp = getattr(exc, "response", None)
    body = resp.text if resp is not None else str(exc)
    return ("PGRST205" in body or "42P01" in body) and "collection" in body


def _when(v) -> datetime | None:
    if not v:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


def status_of(c: dict, product_count: int, now: datetime | None = None) -> tuple[str, str | None]:
    """What the shop sees: (status, why it is a draft).

    draft      not shown: switched off ("off") or no active product yet ("no_products")
    scheduled  switched on, starts later
    ended      switched on, its end date has passed
    live       customers see it (the only one shown on the shop page)
    """
    now = now or datetime.now(timezone.utc)
    if not c.get("is_active"):
        return "draft", "off"
    starts, ends = _when(c.get("starts_at")), _when(c.get("ends_at"))
    if starts and starts > now:
        return "scheduled", None
    if ends and ends <= now:
        return "ended", None
    if product_count == 0:
        return "draft", "no_products"
    return "live", None


def is_visible(c: dict, now: datetime | None = None) -> bool:
    """Active, manual, and inside its dates (the product check comes after)."""
    if c.get("type", "manual") != "manual":
        return False
    return status_of(c, 1, now)[0] == "live"


async def _product_cards(db, ids: list[int], *, active_only: bool = True) -> dict[int, dict]:
    """Products as the shop's product grid shows them (images, has_variants), keyed by id."""
    if not ids:
        return {}
    q = db.from_("products").in_("id", ids)
    if active_only:
        q = q.eq("is_active", True)
    rows = await q.select(CARD_FIELDS)
    if not rows:
        return {}
    found = [r["id"] for r in rows]
    images: dict[int, list] = {}
    for img in await db.from_("product_images").in_("product_id", found).order("sort_order").select():
        images.setdefault(img["product_id"], []).append(img)
    with_variants = {v["product_id"] for v in await db.from_("product_variants").in_("product_id", found).select("product_id")}
    for r in rows:
        r["images"] = images.get(r["id"], [])
        r["has_variants"] = r["id"] in with_variants
    return {r["id"]: r for r in rows}


async def _links(db, collection_ids: list[int]) -> dict[int, list[int]]:
    """Each collection's product ids, in order."""
    if not collection_ids:
        return {}
    out: dict[int, list[int]] = {}
    rows = await db.from_(LINKS).in_("collection_id", collection_ids).order("sort_order").order("added_at").select(
        "collection_id,product_id,sort_order")
    for r in rows:
        out.setdefault(r["collection_id"], []).append(r["product_id"])
    return out


# ── Customers ──────────────────────────────────────────────────


async def _shop_is_open_for_business(db, merchant_id: int) -> bool:
    m = await db.from_("merchants").eq("id", merchant_id).select_one()
    return shop_setup.is_visible(m)


@router.get("/merchants/{merchant_id}/collections")
async def shop_collections(merchant_id: int):
    """The shop's visible collections, each with its first products (shop page rows)."""
    async with SupabaseClient.service_role() as db:
        if not await _shop_is_open_for_business(db, merchant_id):
            return []
        try:
            rows = await db.from_(TABLE).eq("merchant_id", merchant_id).eq("is_active", True).eq("type", "manual") \
                .order("sort_order").order("id").select(FIELDS)
        except httpx.HTTPStatusError as exc:
            if _missing(exc):
                return []
            raise
        now = datetime.now(timezone.utc)
        rows = [c for c in rows if is_visible(c, now)]
        links = await _links(db, [c["id"] for c in rows])
        cards = await _product_cards(db, list({p for ids in links.values() for p in ids}))
        out = []
        for c in rows:
            products = [cards[p] for p in links.get(c["id"], []) if p in cards and cards[p]["merchant_id"] == merchant_id]
            if products:
                out.append({**c, "product_count": len(products), "products": products[:PREVIEW_PRODUCTS]})
        return out


@router.get("/collections/{collection_id}")
async def collection_detail(collection_id: int):
    """One visible collection with all its active products, in the shop's order."""
    async with SupabaseClient.service_role() as db:
        try:
            c = await db.from_(TABLE).eq("id", collection_id).select_one(FIELDS)
        except httpx.HTTPStatusError as exc:
            if _missing(exc):
                raise NotFoundError("Collection", collection_id) from exc
            raise
        if not c or not is_visible(c) or not await _shop_is_open_for_business(db, c["merchant_id"]):
            raise NotFoundError("Collection", collection_id)
        ids = (await _links(db, [collection_id])).get(collection_id, [])
        cards = await _product_cards(db, ids)
        products = [cards[p] for p in ids if p in cards and cards[p]["merchant_id"] == c["merchant_id"]]
        if not products:
            raise NotFoundError("Collection", collection_id)
        shop = await db.from_("merchants").eq("id", c["merchant_id"]).select_one("id,name,logo_url,icon_emoji")
        return {**c, "product_count": len(products), "products": products, "merchant": shop}


# ── Shops (owner and staff) and the platform ───────────────────


def _shop_for(user: TokenClaims, requested: int | None) -> int:
    """The shop this request acts on: a shop account's own; a super admin must say which."""
    if user.role == Role.MERCHANT_ADMIN:
        if user.merchant_id is None:
            raise ForbiddenError("This account is not linked to a shop")
        return user.merchant_id
    if requested is None:
        raise BadRequestError("Choose the shop (merchant_id)")
    return requested


async def _load_own(db, collection_id: int, user: TokenClaims) -> dict:
    try:
        c = await db.from_(TABLE).eq("id", collection_id).select_one(FIELDS)
    except httpx.HTTPStatusError as exc:
        if _missing(exc):
            raise BadRequestError(MIGRATION_HINT) from exc
        raise
    if not c or (user.role == Role.MERCHANT_ADMIN and c["merchant_id"] != user.merchant_id):
        raise NotFoundError("Collection", collection_id)  # another shop's looks the same as none
    return c


async def _check_products(db, merchant_id: int, ids: list[int]) -> dict[int, str]:
    """Every product must belong to this shop. Returns {id: name}."""
    if not ids:
        return {}
    rows = await db.from_("products").in_("id", ids).select("id,merchant_id,name")
    own = {r["id"]: (r.get("name") or "").strip() for r in rows if r.get("merchant_id") == merchant_id}
    foreign = [i for i in ids if i not in own]
    if foreign:
        raise BadRequestError(f"These products are not in this shop: {', '.join(map(str, foreign))}")
    return own


async def _set_products(db, collection_id: int, ids: list[int]) -> None:
    await db.from_(LINKS).eq("collection_id", collection_id).delete()
    if ids:
        await db.from_(LINKS).insert([{"collection_id": collection_id, "product_id": p, "sort_order": i} for i, p in enumerate(ids)])


def _row(body: CollectionIn) -> dict:
    return {
        "title": body.title, "description": body.description, "type": "manual",
        "is_active": body.is_active, "sort_order": body.sort_order,
        "starts_at": body.starts_at.isoformat() if body.starts_at else None,
        "ends_at": body.ends_at.isoformat() if body.ends_at else None,
    }


def _no_smart(body: CollectionIn) -> None:
    if body.type != "manual":
        raise BadRequestError("Smart collections are not available yet. Create a manual collection and pick its products.")


LOG_FIELDS = ("title", "description", "is_active", "sort_order", "starts_at", "ends_at", "cover_url")


@router.get("/collections/admin/list")
async def admin_list(merchant_id: int | None = None, user: TokenClaims = require_any_admin()):
    """The shop's collections (all of them, with status and product ids) for the dashboard."""
    shop = _shop_for(user, merchant_id)
    async with SupabaseClient.service_role() as db:
        try:
            rows = await db.from_(TABLE).eq("merchant_id", shop).order("sort_order").order("id").select(FIELDS)
        except httpx.HTTPStatusError as exc:
            if _missing(exc):
                raise BadRequestError(MIGRATION_HINT) from exc
            raise
        links = await _links(db, [c["id"] for c in rows])
        all_ids = list({p for ids in links.values() for p in ids})
        cards = await _product_cards(db, all_ids, active_only=False)
        now = datetime.now(timezone.utc)
        for c in rows:
            ids = links.get(c["id"], [])
            c["product_ids"] = ids
            c["visible_product_count"] = sum(1 for p in ids if cards.get(p, {}).get("is_active"))
            c["status"], c["draft_reason"] = status_of(c, c["visible_product_count"], now)
        return {"data": rows, "limit": MAX_COLLECTIONS_PER_SHOP}


@router.post("/collections/admin")
async def admin_create(body: CollectionIn, user: TokenClaims = require_any_admin()):
    _no_smart(body)
    shop = _shop_for(user, body.merchant_id)
    async with SupabaseClient.service_role() as db:
        m = await db.from_("merchants").eq("id", shop).select_one("id")
        if not m:
            raise NotFoundError("Merchant", shop)
        try:
            count = len(await db.from_(TABLE).eq("merchant_id", shop).select("id"))
        except httpx.HTTPStatusError as exc:
            if _missing(exc):
                raise BadRequestError(MIGRATION_HINT) from exc
            raise
        if count >= MAX_COLLECTIONS_PER_SHOP:
            raise BadRequestError(f"A shop can have up to {MAX_COLLECTIONS_PER_SHOP} collections. Delete one first.")
        ids = body.product_ids or []
        names = await _check_products(db, shop, ids)
        c = (await db.from_(TABLE).insert({**_row(body), "merchant_id": shop}))[0]
        await _set_products(db, c["id"], ids)
        new = {k: v for k, v in _row(body).items() if v not in (None, "") and k != "type"}
        if ids:
            new["products"] = [names[i] for i in ids]
        await audit.record(db, user, merchant_id=shop, action="collection.created", target_type="collection",
                           target_id=c["id"], target_label=body.title, new=new)
        return {**c, "product_ids": ids}


@router.put("/collections/admin/{collection_id}")
async def admin_update(collection_id: int, body: CollectionIn, user: TokenClaims = require_any_admin()):
    _no_smart(body)
    async with SupabaseClient.service_role() as db:
        current = await _load_own(db, collection_id, user)
        row = _row(body) | {"updated_at": datetime.now(timezone.utc).isoformat()}
        if body.remove_cover:
            row["cover_url"] = None
        c = (await db.from_(TABLE).eq("id", collection_id).update(row))[0]
        old, new = audit.diff({k: current.get(k) for k in LOG_FIELDS},
                              {k: row[k] for k in LOG_FIELDS if k in row})
        if body.product_ids is not None:
            await _apply_products(db, user, current, body.product_ids)
        if new:
            await audit.record(db, user, merchant_id=current["merchant_id"], action="collection.updated",
                               target_type="collection", target_id=collection_id, target_label=body.title, old=old, new=new)
        return c


async def _apply_products(db, user: TokenClaims, current: dict, ids: list[int]) -> list[int]:
    names = await _check_products(db, current["merchant_id"], ids)
    before = (await _links(db, [current["id"]])).get(current["id"], [])
    if before == ids:
        return ids
    await _set_products(db, current["id"], ids)
    old_names = {r["id"]: (r.get("name") or "").strip()
                 for r in (await db.from_("products").in_("id", before).select("id,name") if before else [])}
    await audit.record(
        db, user, merchant_id=current["merchant_id"], action="collection.products_changed", target_type="collection",
        target_id=current["id"], target_label=current.get("title"),
        old={"products": [old_names.get(i, f"#{i}") for i in before]}, new={"products": [names[i] for i in ids]},
    )
    return ids


@router.put("/collections/admin/{collection_id}/products")
async def admin_set_products(collection_id: int, body: CollectionProducts, user: TokenClaims = require_any_admin()):
    """Replace the collection's products; their order here is the order customers see."""
    async with SupabaseClient.service_role() as db:
        current = await _load_own(db, collection_id, user)
        ids = await _apply_products(db, user, current, body.product_ids)
    return {"success": True, "product_ids": ids}


@router.post("/collections/admin/{collection_id}/cover")
async def admin_upload_cover(collection_id: int, file: UploadFile = File(...), user: TokenClaims = require_any_admin()):
    if file.content_type not in ALLOWED_MIME:
        raise BadRequestError("Image must be PNG, JPEG, WebP, or GIF")
    content = await file.read()
    if not content:
        raise BadRequestError("Empty file")
    if len(content) > MAX_COVER_BYTES:
        raise BadRequestError("Image too large (max 4 MB)")
    async with SupabaseClient.service_role() as db:
        current = await _load_own(db, collection_id, user)
        ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "jpg").lower()
        if ext not in {"png", "jpg", "jpeg", "webp", "gif"}:
            ext = "jpg"
        url = await StorageClient().upload(
            bucket="product-images", path=f"collections/{current['merchant_id']}/{collection_id}/{int(time.time() * 1000)}.{ext}",
            content=content, content_type=file.content_type or "application/octet-stream",
        )
        await db.from_(TABLE).eq("id", collection_id).update({"cover_url": url, "updated_at": datetime.now(timezone.utc).isoformat()})
        await audit.record(db, user, merchant_id=current["merchant_id"], action="collection.updated", target_type="collection",
                           target_id=collection_id, target_label=current.get("title"),
                           old={"cover_url": current.get("cover_url")}, new={"cover_url": url})
    return {"cover_url": url}


@router.delete("/collections/admin/{collection_id}")
async def admin_delete(collection_id: int, user: TokenClaims = require_any_admin()):
    """Delete a collection. Its products stay in the shop; only the grouping goes."""
    async with SupabaseClient.service_role() as db:
        current = await _load_own(db, collection_id, user)
        ids = (await _links(db, [collection_id])).get(collection_id, [])
        await db.from_(TABLE).eq("id", collection_id).delete()  # links go with it (on delete cascade)
        await audit.record(db, user, merchant_id=current["merchant_id"], action="collection.deleted", target_type="collection",
                           target_id=collection_id, target_label=current.get("title"),
                           old={"title": current.get("title"), "products": len(ids), "is_active": current.get("is_active")})
    return {"success": True}
