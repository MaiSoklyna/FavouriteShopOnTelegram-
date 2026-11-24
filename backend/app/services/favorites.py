"""Favorites: products and shops a customer has saved.

Rules:
- Saving is idempotent: saving the same thing twice (double tap, two tabs) leaves one row and is not an error.
- Only things that exist and are live can be newly saved (an unknown or inactive product / shop is a 404).
- Something already saved that later goes inactive stays in the list, marked unavailable, so the customer
  can see why it is not orderable and remove it.
- A customer can save at most MAX_PER_KIND of each kind.
- Before migration 032 there is no table: reads return empty lists and writes explain what to run.
"""

from __future__ import annotations

import httpx

from app.core.exceptions import BadRequestError, NotFoundError
from app.services import notify

MAX_PER_KIND = 200
NOT_SET_UP = ("42P01", "PGRST205", "42703", "PGRST204")
PRODUCT_COLUMNS = (
    "id,merchant_id,category_id,name,base_price,compare_price,stock,icon_emoji,rating_avg,review_count,"
    "is_active,primary_image"
)
KINDS = {"product": "product_id", "shop": "merchant_id"}


def not_set_up(exc: httpx.HTTPStatusError) -> bool:
    return notify._error_code(exc) in NOT_SET_UP


async def tolerant(call, empty):
    """Run a read; before migration 032 answer `empty` instead of failing."""
    try:
        return await call
    except httpx.HTTPStatusError as exc:
        if not_set_up(exc):
            return empty
        raise


async def ids_for(db, user_id: int) -> dict:
    rows = await tolerant(db.from_("favorites").eq("user_id", user_id).order("created_at", desc=True).select("kind,product_id,merchant_id"), [])
    return {
        "products": [r["product_id"] for r in rows if r["kind"] == "product"],
        "shops": [r["merchant_id"] for r in rows if r["kind"] == "shop"],
    }


async def _target_is_live(db, kind: str, target_id: int) -> bool:
    if kind == "product":
        row = await db.from_("products").eq("id", target_id).select_one("id,is_active,merchant_id")
        if not row or not row.get("is_active"):
            return False
        shop = await db.from_("merchants").eq("id", row["merchant_id"]).select_one("id,status")
        return bool(shop) and shop.get("status") == "active"
    row = await db.from_("merchants").eq("id", target_id).select_one("id,status")
    return bool(row) and row.get("status") == "active"


async def add(db, user_id: int, kind: str, target_id: int) -> bool:
    """Save an item. Returns True if it is newly saved, False if it already was. Raises NotFoundError for a
    thing that does not exist or is not live, BadRequestError past the limit or before the migration."""
    column = KINDS[kind]
    if not await _target_is_live(db, kind, target_id):
        raise NotFoundError("Product" if kind == "product" else "Shop", target_id)
    try:
        existing = await db.from_("favorites").eq("user_id", user_id).eq("kind", kind).select(column)
        if any(r[column] == target_id for r in existing):
            return False
        if len(existing) >= MAX_PER_KIND:
            raise BadRequestError(f"You can save up to {MAX_PER_KIND} {'products' if kind == 'product' else 'shops'}. Remove one first.")
        await db.from_("favorites").insert({"user_id": user_id, "kind": kind, column: target_id})
    except httpx.HTTPStatusError as exc:
        if notify._error_code(exc) == "23505":
            return False  # saved by another tab a moment ago
        if not_set_up(exc):
            raise BadRequestError("Favorites are not set up on the server yet. Please try again later.") from exc
        raise
    return True


async def remove(db, user_id: int, kind: str, target_id: int) -> None:
    """Un-save an item (not an error if it was not saved)."""
    await tolerant(db.from_("favorites").eq("user_id", user_id).eq("kind", kind).eq(KINDS[kind], target_id).delete(), None)


async def merge(db, user_id: int, product_ids: list[int]) -> dict:
    """Add hearts kept on this device to the account (first login). Unknown / inactive ids and anything past
    the limit are skipped. Returns how many were added and skipped."""
    added = skipped = 0
    for pid in dict.fromkeys(product_ids):  # de-duplicated, order kept
        try:
            if await add(db, user_id, "product", pid):
                added += 1
            else:
                skipped += 1
        except (NotFoundError, BadRequestError):
            skipped += 1
    return {"added": added, "skipped": skipped}


async def products_for(db, user_id: int) -> list[dict]:
    """Saved products, newest first, shaped like the product list so the normal product card can show them."""
    rows = await tolerant(db.from_("favorites").eq("user_id", user_id).eq("kind", "product").order("created_at", desc=True).select("product_id,created_at"), [])
    if not rows:
        return []
    ids = [r["product_id"] for r in rows]
    products = {p["id"]: p for p in await db.from_("products").in_("id", ids).select(PRODUCT_COLUMNS)}
    shop_ids = list({p["merchant_id"] for p in products.values() if p.get("merchant_id")})
    shops = {m["id"]: m for m in await db.from_("merchants").in_("id", shop_ids).select("id,name,icon_emoji,logo_url,status")} if shop_ids else {}
    with_variants = {v["product_id"] for v in await db.from_("product_variants").in_("product_id", ids).select("product_id")}
    out = []
    for r in rows:
        p = products.get(r["product_id"])
        if not p:
            continue
        m = shops.get(p.get("merchant_id")) or {}
        out.append({
            **p, "slug": "", "merchant_name": m.get("name"), "merchant_icon": m.get("icon_emoji"), "merchant_logo_url": m.get("logo_url"),
            "merchant_status": m.get("status"), "has_variants": p["id"] in with_variants,
            "available": bool(p.get("is_active")) and m.get("status") == "active", "saved_at": r["created_at"],
        })
    return out


async def shops_for(db, user_id: int, public_view, category_names) -> list[dict]:
    """Saved shops, newest first, shaped like the shop list so the normal shop card can show them."""
    rows = await tolerant(db.from_("favorites").eq("user_id", user_id).eq("kind", "shop").order("created_at", desc=True).select("merchant_id,created_at"), [])
    if not rows:
        return []
    shops = {m["id"]: m for m in await db.from_("merchants").in_("id", [r["merchant_id"] for r in rows]).select("*")}
    cats, subs = await category_names(db)
    out = []
    for r in rows:
        m = shops.get(r["merchant_id"])
        if not m:
            continue
        view = public_view(m)
        view["shop_category"], view["shop_subcategory"] = cats.get(m.get("shop_category_id")), subs.get(m.get("shop_subcategory_id"))
        view["available"] = m.get("status") == "active"
        view["saved_at"] = r["created_at"]
        out.append(view)
    return out

