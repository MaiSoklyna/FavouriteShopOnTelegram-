"""Product attribute templates and the filtered product search.

Templates (migration 036) are platform-owned: one per kind of product, grouped by shop type. Shops
fill the values on their products. The search narrows products by text, shop type, shop, category,
price, stock and, within one shop type, by the templates' filterable fields, and returns facet
counts for those fields.

Filtering and facet counting run here over the matching products (the catalogue is small); the GIN
index on products.attributes is in place for moving it into the database later.
"""

from __future__ import annotations

import re
from datetime import datetime

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field, field_validator

from app.core.constants import Role
from app.core.dependencies import require_any_admin, require_super_admin
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.services import attributes

router = APIRouter(tags=["Product details"])

CANDIDATE_CAP = 2000
SORTS = ("relevance", "price_asc", "price_desc", "newest", "rating")
PRODUCT_COLUMNS = ("id,merchant_id,category_id,name,description,base_price,compare_price,stock,sku,icon_emoji,"
                   "rating_avg,review_count,is_featured,is_active,primary_image,created_at")


# ── Templates ──────────────────────────────────────────────────


@router.get("/attribute-templates")
async def list_templates(shop_category_id: int | None = None):
    """Active templates with their fields (public: the filter panel and the product page use them)."""
    async with SupabaseClient.service_role() as db:
        return {"data": await attributes.load_templates(db, shop_category_id=shop_category_id)}


@router.get("/attribute-templates/for-shop")
async def templates_for_shop(merchant_id: int | None = None, user: TokenClaims = require_any_admin()):
    """The templates a shop can use (its shop type) and the one suggested for it (its subtype)."""
    if user.role == Role.MERCHANT_ADMIN:
        merchant_id = user.merchant_id
    if merchant_id is None:
        raise BadRequestError("Choose the shop (merchant_id)")
    async with SupabaseClient.service_role() as db:
        shop = await db.from_("merchants").eq("id", merchant_id).select_one("id,shop_category_id,shop_subcategory_id")
        if not shop:
            raise NotFoundError("Merchant", merchant_id)
        # A shop without a type yet may use any template (the super admin sets the type)
        templates = await attributes.load_templates(db, shop_category_id=shop.get("shop_category_id"))
        suggested = attributes.suggested_template(templates, shop.get("shop_subcategory_id"))
        return {"data": templates, "suggested_id": suggested["id"] if suggested else None,
                "shop_category_id": shop.get("shop_category_id")}


# ── Platform (super admin) management ──────────────────────────


class TemplateEdit(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    is_active: bool | None = None
    sort_order: int | None = Field(None, ge=0, le=10_000)


class FieldCreate(BaseModel):
    key: str = Field(..., pattern=r"^[a-z][a-z0-9_]{0,39}$")
    label: str = Field(..., min_length=1, max_length=60)
    type: str = Field(..., pattern=r"^(text|number|select|multi_select|boolean)$")
    unit: str | None = Field(None, max_length=20)
    options: list[str] = []
    filterable: bool = False
    importance: str = Field("optional", pattern=r"^(recommended|optional)$")
    help_text: str | None = Field(None, max_length=200)
    sort_order: int = Field(0, ge=0, le=10_000)


class FieldEdit(BaseModel):
    """Key and type never change once a field exists: products already store values under them."""
    label: str | None = Field(None, min_length=1, max_length=60)
    unit: str | None = Field(None, max_length=20)
    filterable: bool | None = None
    importance: str | None = Field(None, pattern=r"^(recommended|optional)$")
    help_text: str | None = Field(None, max_length=200)
    sort_order: int | None = Field(None, ge=0, le=10_000)
    is_active: bool | None = None
    add_options: list[str] = []

    @field_validator("add_options")
    @classmethod
    def _opts(cls, v: list[str]) -> list[str]:
        return [o.strip() for o in v if o and o.strip()]


def option_value(label: str) -> str:
    """The stored value for an option label ("Serum / Ampoule" -> "serum_ampoule"), as migration 036 does."""
    return re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")


@router.get("/attribute-templates/admin/all")
async def admin_templates(user: TokenClaims = require_super_admin()):
    async with SupabaseClient.service_role() as db:
        templates = await attributes.load_templates(db, include_inactive=True)
        types = {c["id"]: c["name"] for c in await db.from_("shop_categories").select("id,name")}
        used: dict[int, int] = {}
        try:
            for p in await db.from_("products").not_("attribute_template_id", "is", "null").select("attribute_template_id"):
                used[p["attribute_template_id"]] = used.get(p["attribute_template_id"], 0) + 1
        except Exception:
            pass
        for t in templates:
            t["shop_type"] = types.get(t["shop_category_id"])
            t["product_count"] = used.get(t["id"], 0)
        return {"data": templates}


@router.patch("/attribute-templates/admin/{template_id}")
async def admin_edit_template(template_id: int, body: TemplateEdit, user: TokenClaims = require_super_admin()):
    changes = body.model_dump(exclude_none=True)
    if not changes:
        raise BadRequestError("Nothing to change")
    async with SupabaseClient.service_role() as db:
        if not await attributes.load_template(db, template_id):
            raise NotFoundError("Template", template_id)
        await db.from_(attributes.TEMPLATES).eq("id", template_id).update(changes)
    return {"success": True}


def _options_from(labels: list[str]) -> list[dict]:
    out, seen = [], set()
    for label in labels:
        label = label.strip()
        value = option_value(label)
        if label and value and value not in seen:
            seen.add(value)
            out.append({"value": value, "label": label})
    return out


@router.post("/attribute-templates/admin/{template_id}/fields")
async def admin_add_field(template_id: int, body: FieldCreate, user: TokenClaims = require_super_admin()):
    async with SupabaseClient.service_role() as db:
        template = await attributes.load_template(db, template_id)
        if not template:
            raise NotFoundError("Template", template_id)
        if any(f["key"] == body.key for f in template["fields"]):
            raise BadRequestError(f"'{body.key}' already exists in {template['name']}")
        options = _options_from(body.options)
        if body.type in ("select", "multi_select") and len(options) < 2:
            raise BadRequestError("A choice field needs at least 2 options")
        if body.type == "text" and body.filterable and body.key != "brand":
            raise BadRequestError("Only Brand can be a filterable text field. Use a choice field to filter.")
        row = {**body.model_dump(exclude={"options"}), "options": options if body.type in ("select", "multi_select") else [],
               "template_id": template_id}
        return (await db.from_(attributes.FIELDS).insert(row))[0]


@router.patch("/attribute-templates/admin/fields/{field_id}")
async def admin_edit_field(field_id: int, body: FieldEdit, user: TokenClaims = require_super_admin()):
    async with SupabaseClient.service_role() as db:
        field = await db.from_(attributes.FIELDS).eq("id", field_id).select_one(attributes.FIELD_FIELDS)
        if not field:
            raise NotFoundError("Field", field_id)
        changes = body.model_dump(exclude_none=True, exclude={"add_options"})
        if body.add_options:
            if field["type"] not in ("select", "multi_select"):
                raise BadRequestError("Only choice fields have options")
            current = field.get("options") or []
            have = {o["value"] for o in current}
            changes["options"] = current + [o for o in _options_from(body.add_options) if o["value"] not in have]
        if changes.get("filterable") and field["type"] == "text" and field["key"] != "brand":
            raise BadRequestError("Only Brand can be a filterable text field")
        if not changes:
            raise BadRequestError("Nothing to change")
        await db.from_(attributes.FIELDS).eq("id", field_id).update(changes)
    return {"success": True}


# ── Search with filters and facets ─────────────────────────────


def _parse_filters(params) -> dict[str, dict]:
    """a.<key>=v1,v2 · a.<key>.min=1 · a.<key>.max=9 · a.<key>=true  ->  {key: {"values"|"min"|"max": ...}}"""
    out: dict[str, dict] = {}
    for name, raw in params.multi_items():
        if not name.startswith("a.") or raw in (None, ""):
            continue
        parts = name[2:].split(".")
        key = parts[0]
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,39}", key):
            continue
        f = out.setdefault(key, {})
        if len(parts) == 2 and parts[1] in ("min", "max"):
            try:
                f[parts[1]] = float(raw)
            except ValueError:
                raise BadRequestError(f"'{name}' must be a number")
        elif len(parts) == 1:
            f.setdefault("values", [])
            f["values"] += [v.strip() for v in raw.split(",") if v.strip()]
    return out


def _scope_fields(templates: list[dict]) -> dict[str, dict]:
    """Filterable fields of a shop type's templates, merged by key (Brand in Skincare and Cosmetics is one filter)."""
    merged: dict[str, dict] = {}
    for t in templates:
        for f in t["fields"]:
            if not f.get("filterable") or not f.get("is_active", True):
                continue
            m = merged.get(f["key"])
            if m is None:
                merged[f["key"]] = {**f, "options": list(f.get("options") or [])}
            elif m["type"] == f["type"]:
                have = {o["value"] for o in m["options"]}
                m["options"] += [o for o in f.get("options") or [] if o["value"] not in have]
    return dict(sorted(merged.items(), key=lambda kv: (kv[1].get("sort_order", 0), kv[0])))


def _matches(field: dict, value, f: dict) -> bool:
    if value is None or value == "" or value == []:
        return False  # a product without this detail never matches a filter on it
    kind = field["type"]
    if kind == "boolean":
        wanted = [v.lower() for v in f.get("values", [])]
        return ("true" in wanted and value is True) or ("false" in wanted and value is False)
    if kind == "number":
        try:
            v = float(value)
        except (TypeError, ValueError):
            return False
        return ("min" not in f or v >= f["min"]) and ("max" not in f or v <= f["max"])
    if kind == "text":
        return str(value).strip().lower() in {x.lower() for x in f.get("values", [])}
    values = value if isinstance(value, list) else [value]
    return bool(set(values) & set(f.get("values", [])))


def _passes(product: dict, fields: dict[str, dict], filters: dict[str, dict], skip: str | None = None) -> bool:
    attrs = product.get("attributes") or {}
    for key, f in filters.items():
        if key == skip or key not in fields:
            continue
        if not _matches(fields[key], attrs.get(key), f):
            return False
    return True


def _facets(products: list[dict], fields: dict[str, dict], filters: dict[str, dict]) -> list[dict]:
    """Each filterable field with its values and counts, counted over the products that match every *other* filter."""
    out = []
    for key, field in fields.items():
        pool = [p for p in products if _passes(p, fields, filters, skip=key)]
        values = [(p.get("attributes") or {}).get(key) for p in pool]
        values = [v for v in values if v not in (None, "", [])]
        chosen = filters.get(key, {})
        facet = {"key": key, "label": field["label"], "type": field["type"], "unit": field.get("unit"),
                 "help_text": field.get("help_text")}
        if field["type"] in ("select", "multi_select"):
            counts: dict[str, int] = {}
            for v in values:
                for x in (v if isinstance(v, list) else [v]):
                    counts[x] = counts.get(x, 0) + 1
            selected = set(chosen.get("values", []))
            facet["options"] = [{"value": o["value"], "label": o["label"], "count": counts.get(o["value"], 0),
                                 "selected": o["value"] in selected}
                                for o in field["options"] if counts.get(o["value"]) or o["value"] in selected]
            if not facet["options"]:
                continue
        elif field["type"] == "text":
            counts, spelling = {}, {}
            for v in values:
                k = str(v).strip().lower()
                counts[k] = counts.get(k, 0) + 1
                spelling.setdefault(k, str(v).strip())
            selected = {x.lower() for x in chosen.get("values", [])}
            names = sorted(counts, key=lambda k: (-counts[k], k))[:20]
            facet["options"] = [{"value": spelling[k], "label": spelling[k], "count": counts[k], "selected": k in selected}
                                for k in names]
            if not facet["options"]:
                continue
        elif field["type"] == "number":
            nums = []
            for v in values:
                try:
                    nums.append(float(v))
                except (TypeError, ValueError):
                    pass
            if not nums and not chosen:
                continue
            facet.update({"min": min(nums) if nums else None, "max": max(nums) if nums else None, "count": len(nums),
                          "selected_min": chosen.get("min"), "selected_max": chosen.get("max")})
        else:  # boolean: only "Yes" is offered as a filter
            yes = sum(1 for v in values if v is True)
            if not yes and not chosen:
                continue
            facet.update({"count": yes, "selected": "true" in [x.lower() for x in chosen.get("values", [])]})
        out.append(facet)
    return out


def _text_hit(product: dict, needle: str, fields_by_key: dict[str, dict]) -> int:
    """0 = no match; higher = better: name starts with it > name contains it > a detail (brand, option) has it."""
    name = (product.get("name") or "").lower()
    if name.startswith(needle):
        return 3
    if needle in name:
        return 2
    for key, value in (product.get("attributes") or {}).items():
        f = fields_by_key.get(key)
        shown = attributes.show(f, value) if f else str(value)
        if needle in shown.lower():
            return 1
    return 0


def _ts(v) -> float:
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


@router.get("/search/products")
async def search_products(
    request: Request,
    q: str | None = Query(None, max_length=100),
    shop_type: int | None = Query(None, description="shop_categories.id: also turns on detail filters"),
    merchant_id: int | None = None,
    category_id: int | None = None,
    min_price: float | None = Query(None, ge=0),
    max_price: float | None = Query(None, ge=0),
    in_stock: bool = False,
    sort: str = Query("relevance"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=60),
):
    """Products by text, shop type, shop, category, price and stock; within one shop type also by product
    details (`a.skin_type=oily,dry`, `a.storage_gb.min=64`, `a.fragrance_free=true`). Returns the page,
    the total, and facets with counts for the detail filters."""
    if sort not in SORTS:
        raise BadRequestError(f"sort must be one of: {', '.join(SORTS)}")
    if min_price is not None and max_price is not None and min_price > max_price:
        raise BadRequestError("The minimum price is above the maximum")
    filters = _parse_filters(request.query_params)
    needle = " ".join((q or "").lower().split())

    async with SupabaseClient.service_role() as db:
        shops_q = db.from_("merchants").eq("status", "active")
        if merchant_id is not None:
            shops_q = shops_q.eq("id", merchant_id)
        if shop_type is not None:
            shops_q = shops_q.eq("shop_category_id", shop_type)
        shops = {m["id"]: m for m in await shops_q.select("id,name,icon_emoji,logo_url,status,shop_category_id")}
        # Detail filters need one shop type: the one asked for, or the shop's own
        scope_type = shop_type if shop_type is not None else (
            shops[merchant_id].get("shop_category_id") if merchant_id in shops else None)
        templates = await attributes.load_templates(db, shop_category_id=scope_type) if scope_type is not None else []
        fields = _scope_fields(templates)
        all_fields = {f["key"]: f for t in templates for f in t["fields"]}
        if not templates and needle:
            # Text search across every shop type still reads brand and option labels
            all_fields = {f["key"]: f for t in await attributes.load_templates(db) for f in t["fields"]}

        empty = {"data": [], "total": 0, "page": page, "page_size": page_size, "has_more": False,
                 "facets": [], "shop_type": scope_type}
        if not shops:
            return empty

        pq = db.from_("products").eq("is_active", True).in_("merchant_id", list(shops))
        if category_id is not None:
            pq = pq.eq("category_id", category_id)
        if min_price is not None:
            pq = pq.gte("base_price", min_price)
        if max_price is not None:
            pq = pq.lte("base_price", max_price)
        if in_stock:
            pq = pq.gt("stock", 0)
        try:
            rows = await pq.limit(CANDIDATE_CAP).select(PRODUCT_COLUMNS + ",attribute_template_id,attributes")
        except Exception as exc:
            if not attributes.missing(exc):
                raise
            rows = await pq.limit(CANDIDATE_CAP).select(PRODUCT_COLUMNS)

        if needle:
            scored = [(p, _text_hit(p, needle, all_fields)) for p in rows]
            rows = [p for p, s in scored if s]
            relevance = {p["id"]: s for p, s in scored}
        else:
            relevance = {}

        facets = _facets(rows, fields, filters) if fields else []
        unknown = [k for k in filters if k not in fields]
        if unknown and fields:
            raise BadRequestError(f"Unknown filter for this shop type: {', '.join(unknown)}")
        matched = [p for p in rows if _passes(p, fields, filters)] if fields and filters else rows

        if sort == "price_asc":
            matched.sort(key=lambda p: (float(p.get("base_price") or 0), p["id"]))
        elif sort == "price_desc":
            matched.sort(key=lambda p: (-float(p.get("base_price") or 0), p["id"]))
        elif sort == "rating":
            matched.sort(key=lambda p: (-float(p.get("rating_avg") or 0), -(p.get("review_count") or 0), p["id"]))
        elif sort == "newest" or not needle:
            matched.sort(key=lambda p: (-_ts(p.get("created_at")), -p["id"]))
        else:
            matched.sort(key=lambda p: (-relevance.get(p["id"], 0), -_ts(p.get("created_at")), -p["id"]))

        total = len(matched)
        start = (page - 1) * page_size
        items = matched[start:start + page_size]
        await _enrich(db, items, shops)

    return {**empty, "data": items, "total": total, "has_more": start + page_size < total, "facets": facets}


async def _enrich(db, products: list[dict], shops: dict[int, dict]) -> None:
    """Same extras as the product list: shop name and logo, images, whether it has variants."""
    if not products:
        return
    ids = [p["id"] for p in products]
    images: dict[int, list] = {}
    for img in await db.from_("product_images").in_("product_id", ids).order("sort_order").select():
        images.setdefault(img["product_id"], []).append(img)
    with_variants = {v["product_id"] for v in await db.from_("product_variants").in_("product_id", ids).select("product_id")}
    for p in products:
        m = shops.get(p.get("merchant_id")) or {}
        p.update({"merchant_name": m.get("name"), "merchant_icon": m.get("icon_emoji"), "merchant_logo_url": m.get("logo_url"),
                  "merchant_status": m.get("status"), "images": images.get(p["id"], []), "has_variants": p["id"] in with_variants})
