"""Reorganising a catalogue: move products between categories in bulk, and delete a category
without leaving its products behind.

Categories are a shop's own (merchants.id) or platform-wide (merchant_id NULL, made by the platform
admin). A product may sit in its own shop's category or a platform one, never another shop's.

Rules kept here:
- A shop account only ever touches its own shop's products, even inside a platform category.
- A product can only be moved to a category it may belong to: its own shop's or a platform one.
  None means "no category".
- Deleting a category that still holds products needs an answer to "move them where?", so no
  product is left pointing at a hidden category.
- Every move is written to the shop's activity log, once per shop, with the counts.
"""

from __future__ import annotations

from app.core.constants import Role
from app.core.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims
from app.services import audit

MAX_BULK = 500
UNCATEGORISED = "none"


async def load_category(db, category_id: int, user: TokenClaims, *, as_target: bool = False) -> dict:
    """The category, if this account may use it (its own shop's or a platform one)."""
    cat = await db.from_("categories").eq("id", category_id).select_one("id,name,merchant_id,is_active")
    if not cat or (as_target and not cat.get("is_active", True)):
        raise NotFoundError("Category", category_id)
    if user.role == Role.MERCHANT_ADMIN and cat.get("merchant_id") not in (None, user.merchant_id):
        raise ForbiddenError("You can only use your own shop's categories")
    return cat


def _fits(target: dict | None, product_merchant_id: int | None) -> bool:
    """May a product of this shop sit in `target`? (None = no category: always.)"""
    return target is None or target.get("merchant_id") in (None, product_merchant_id)


def _shop_scope(q, user: TokenClaims):
    return q.eq("merchant_id", user.merchant_id) if user.role == Role.MERCHANT_ADMIN else q


async def _log(db, user: TokenClaims, products: list[dict], *, action: str, source: dict | None,
               target: dict | None, extra: dict | None = None) -> None:
    """One activity-log entry per shop whose products moved."""
    per_shop: dict[int, list[dict]] = {}
    for p in products:
        per_shop.setdefault(p.get("merchant_id"), []).append(p)
    for merchant_id, mine in per_shop.items():
        await audit.record(
            db, user, merchant_id=merchant_id, action=action,
            target_type="category", target_id=(source or target or {}).get("id"),
            target_label=(source or target or {}).get("name") or "No category",
            old={"category": source["name"] if source else None},
            new={"category": target["name"] if target else None, "products": len(mine),
                 "product_names": [p.get("name") for p in mine[:20]], **(extra or {})},
        )


async def move_all(db, user: TokenClaims, source_id: int, target_id: int | None) -> dict:
    """Move every product of `source_id` (that this account may touch) to `target_id` (None = no category)."""
    source = await load_category(db, source_id, user)
    target = await load_category(db, target_id, user, as_target=True) if target_id is not None else None
    if target and target["id"] == source["id"]:
        raise BadRequestError("Choose a different category to move the products to")

    products = await _shop_scope(db.from_("products").eq("category_id", source_id), user).select("id,name,merchant_id")
    misfits = sorted({p.get("merchant_id") for p in products if not _fits(target, p.get("merchant_id"))})
    if misfits:
        raise BadRequestError("Some of these products belong to another shop and can't go into that shop's category. "
                              "Choose a platform-wide category or no category.")
    moved: list[dict] = []
    if products:
        moved = await _shop_scope(db.from_("products").eq("category_id", source_id), user).update(
            {"category_id": target["id"] if target else None})
    await _log(db, user, products, action="category.products_moved", source=source, target=target)
    return {"moved": len(moved), "from": source["name"], "to": target["name"] if target else None}


async def delete_with_move(db, user: TokenClaims, category_id: int, move_to: str | None) -> dict:
    """Delete (hide) a category. If it still holds products, `move_to` must say where they go:
    a category id, or "none" for no category."""
    source = await load_category(db, category_id, user)
    if user.role == Role.MERCHANT_ADMIN and source.get("merchant_id") != user.merchant_id:
        raise ForbiddenError("Only the platform can delete a platform-wide category")

    holding = await db.from_("products").eq("category_id", category_id).select("id")
    moved = 0
    if holding:
        if move_to is None or move_to == "":
            raise ConflictError(f"This category still has {len(holding)} product(s). Choose where to move them first.")
        target_id = None if move_to == UNCATEGORISED else _as_id(move_to)
        # The platform deleting a platform category moves every shop's products; a shop moves its own
        moved = (await move_all(db, user, category_id, target_id))["moved"]
        if await db.from_("products").eq("category_id", category_id).select("id"):
            raise ConflictError("Some products could not be moved, so the category was kept.")

    await db.from_("categories").eq("id", category_id).update({"is_active": False})
    if source.get("merchant_id"):
        await audit.record(db, user, merchant_id=source["merchant_id"], action="category.deleted",
                           target_type="category", target_id=category_id, target_label=source["name"],
                           old={"name": source["name"]}, new={"products_moved": moved})
    return {"deleted": category_id, "moved": moved}


async def set_category(db, user: TokenClaims, product_ids: list[int], category_id: int | None) -> dict:
    """Put the chosen products in one category (None = no category)."""
    ids = sorted(set(product_ids))
    if not ids:
        raise BadRequestError("Choose at least one product")
    if len(ids) > MAX_BULK:
        raise BadRequestError(f"At most {MAX_BULK} products at a time")
    target = await load_category(db, category_id, user, as_target=True) if category_id is not None else None

    products = await _shop_scope(db.from_("products").in_("id", ids), user).select("id,name,merchant_id,category_id")
    found = {p["id"] for p in products}
    if found != set(ids):
        raise NotFoundError("Product", ", ".join(str(i) for i in ids if i not in found))
    if any(not _fits(target, p.get("merchant_id")) for p in products):
        raise BadRequestError("That category belongs to another shop. Choose one of this shop's categories or a platform one.")

    new_id = target["id"] if target else None
    changing = [p for p in products if p.get("category_id") != new_id]
    if changing:
        await _shop_scope(db.from_("products").in_("id", [p["id"] for p in changing]), user).update({"category_id": new_id})
    await _log(db, user, changing, action="product.category_changed", source=None, target=target)
    return {"changed": len(changing), "unchanged": len(products) - len(changing), "to": target["name"] if target else None}


def _as_id(value: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise BadRequestError("move_to must be a category id or 'none'")
