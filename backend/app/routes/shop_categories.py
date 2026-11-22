"""Shop categories & subcategories (what kind of shop a merchant runs).

Public, read-only: the seller registration form and the admin review page
use this to render the category pickers. Distinct from product `categories`.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.db.client import SupabaseClient

router = APIRouter(prefix="/shop-categories", tags=["Shop Categories"])


@router.get("")
async def list_shop_categories():
    """All shop categories, each with its subcategories nested."""
    async with SupabaseClient.service_role() as db:
        cats = await db.from_("shop_categories").order("sort_order").select("id,name")
        subs = await db.from_("shop_subcategories").order("sort_order").select("id,category_id,name")

    by_cat: dict[int, list[dict]] = {}
    for s in subs:
        by_cat.setdefault(s["category_id"], []).append({"id": s["id"], "name": s["name"]})
    return {"data": [{**c, "subcategories": by_cat.get(c["id"], [])} for c in cats]}
