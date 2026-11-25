"""Shop categories & subcategories (what kind of shop a merchant runs).

Public, read-only: the seller registration form, the admin pages and the customer
"browse shops by category" screens use this. Distinct from product `categories`.
"""

from __future__ import annotations

import asyncio
from collections import Counter

from fastapi import APIRouter

from app.db.client import SupabaseClient
from app.services import shop_setup

router = APIRouter(prefix="/shop-categories", tags=["Shop Categories"])


@router.get("")
async def list_shop_categories(with_shops: bool = False):
    """All shop categories, each with its subcategories nested and its active-shop count.

    `shop_count` counts active shops only (a suspended or pending shop is not browsable).
    `with_shops=true` leaves out categories and subcategories nobody sells under yet,
    which is what customer screens want; forms and admin pages keep the default (all).
    """
    async with SupabaseClient.service_role() as db:
        cats, subs, shops = await asyncio.gather(
            db.from_("shop_categories").order("sort_order").select("id,name"),
            db.from_("shop_subcategories").order("sort_order").select("id,category_id,name"),
            db.from_("merchants").eq("status", "active").select(),
        )
    shops = [s for s in shops if shop_setup.is_visible(s)]  # only shops customers can open

    per_category = Counter(s["shop_category_id"] for s in shops if s.get("shop_category_id") is not None)
    per_subcategory = Counter(s["shop_subcategory_id"] for s in shops if s.get("shop_subcategory_id") is not None)

    by_cat: dict[int, list[dict]] = {}
    for s in subs:
        count = per_subcategory.get(s["id"], 0)
        if with_shops and count == 0:
            continue
        by_cat.setdefault(s["category_id"], []).append({"id": s["id"], "name": s["name"], "shop_count": count})

    out = []
    for c in cats:
        count = per_category.get(c["id"], 0)
        if with_shops and count == 0:
            continue
        out.append({**c, "shop_count": count, "subcategories": by_cat.get(c["id"], [])})
    return {"data": out}
