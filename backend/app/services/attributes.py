"""Product attribute templates: loading, validating, displaying and scoring product details.

The platform defines templates per shop type (migration 036); each product stores its template and
its values (`products.attributes`, JSON keyed by field key). This module is the one place that knows
the five field types:

  text          a short string (Brand is the only filterable text field)
  number        a number in the field's fixed unit (no conversion)
  select        one option value
  multi_select  a list of option values (any of them matches a filter)
  boolean       true / false; absent means "not specified" (never treated as false)

Importance: "recommended" fields count double in the completeness score, "optional" fields once.
Nothing is required.
"""

from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from app.core.exceptions import BadRequestError

logger = logging.getLogger(__name__)

TEMPLATES, FIELDS = "attribute_templates", "attribute_definitions"
TYPES = ("text", "number", "select", "multi_select", "boolean")
MIGRATION_HINT = "Product details need supabase/migrations/036_product_attributes.sql to be run first"
MAX_TEXT = 120
MAX_MULTI = 10
TEMPLATE_FIELDS = "id,key,shop_category_id,shop_subcategory_ids,name,name_kh,sort_order,is_active"
FIELD_FIELDS = ("id,template_id,key,label,label_kh,type,unit,options,filterable,importance,required,"
                "help_text,min_value,max_value,sort_order,is_active")


def missing(exc: Exception) -> bool:
    """Is this the "migration 036 not run" error (unknown table or column)?"""
    resp = getattr(exc, "response", None)
    body = resp.text if resp is not None else str(exc)
    return any(code in body for code in ("PGRST205", "42P01", "42703", "PGRST204")) and \
        any(word in body for word in ("attribute", "attributes"))


async def load_templates(db, *, shop_category_id: int | None = None, include_inactive: bool = False,
                         template_ids: list[int] | None = None) -> list[dict]:
    """Templates (ordered) with their fields (ordered). [] before migration 036."""
    try:
        q = db.from_(TEMPLATES).order("sort_order").order("id")
        if shop_category_id is not None:
            q = q.eq("shop_category_id", shop_category_id)
        if template_ids is not None:
            if not template_ids:
                return []
            q = q.in_("id", template_ids)
        if not include_inactive:
            q = q.eq("is_active", True)
        templates = await q.select(TEMPLATE_FIELDS)
        if not templates:
            return []
        fq = db.from_(FIELDS).in_("template_id", [t["id"] for t in templates]).order("sort_order").order("id")
        if not include_inactive:
            fq = fq.eq("is_active", True)
        fields = await fq.select(FIELD_FIELDS)
    except httpx.HTTPStatusError as exc:
        if missing(exc):
            return []
        raise
    by_template: dict[int, list[dict]] = {}
    for f in fields:
        f["options"] = f.get("options") or []
        by_template.setdefault(f["template_id"], []).append(f)
    for t in templates:
        t["fields"] = by_template.get(t["id"], [])
    return templates


async def load_template(db, template_id: int) -> dict | None:
    rows = await load_templates(db, template_ids=[template_id], include_inactive=True)
    return rows[0] if rows else None


def suggested_template(templates: list[dict], shop_subcategory_id: int | None) -> dict | None:
    """The template a shop most likely wants: the one listed for its subtype, else the first of its type."""
    active = [t for t in templates if t.get("is_active", True)]
    for t in active:
        if shop_subcategory_id is not None and shop_subcategory_id in (t.get("shop_subcategory_ids") or []):
            return t
    return active[0] if active else None


# ── Values ─────────────────────────────────────────────────────


def _empty(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip()) or (isinstance(v, (list, tuple)) and len(v) == 0)


def _number(field: dict, v: Any) -> float | int:
    if isinstance(v, bool):
        raise ValueError("must be a number")
    try:
        d = Decimal(str(v).strip().replace(",", ""))
    except (InvalidOperation, ValueError):
        raise ValueError("must be a number")
    if not d.is_finite():
        raise ValueError("must be a number")
    if d < 0:
        raise ValueError("cannot be negative")
    if field.get("min_value") is not None and d < Decimal(str(field["min_value"])):
        raise ValueError(f"must be at least {field['min_value']}")
    if field.get("max_value") is not None and d > Decimal(str(field["max_value"])):
        raise ValueError(f"must be at most {field['max_value']}")
    return int(d) if d == d.to_integral_value() else float(d)


def _option_values(field: dict) -> dict[str, str]:
    return {o["value"]: o.get("label", o["value"]) for o in field.get("options") or []}


def clean_value(field: dict, v: Any) -> Any:
    """One value checked and normalised for its field type. Raises ValueError with a short reason."""
    kind = field["type"]
    if kind == "text":
        if not isinstance(v, (str, int, float)) or isinstance(v, bool):
            raise ValueError("must be text")
        s = " ".join(str(v).split())
        if len(s) > MAX_TEXT:
            raise ValueError(f"is longer than {MAX_TEXT} characters")
        return s
    if kind == "number":
        return _number(field, v)
    if kind == "boolean":
        if isinstance(v, bool):
            return v
        if isinstance(v, str) and v.lower() in ("true", "yes"):
            return True
        if isinstance(v, str) and v.lower() in ("false", "no"):
            return False
        raise ValueError("must be yes or no")
    allowed = _option_values(field)
    if kind == "select":
        if not isinstance(v, str) or v not in allowed:
            raise ValueError("is not one of the options")
        return v
    if kind == "multi_select":
        values = v if isinstance(v, (list, tuple)) else [v]
        out: list[str] = []
        for x in values:
            if not isinstance(x, str) or x not in allowed:
                raise ValueError(f"'{x}' is not one of the options")
            if x not in out:
                out.append(x)
        if len(out) > MAX_MULTI:
            raise ValueError(f"can have at most {MAX_MULTI} choices")
        # keep the template's option order, so the same choice always reads the same
        order = list(allowed)
        return sorted(out, key=order.index)
    raise ValueError("has an unknown type")


def validate(template: dict, raw: dict | None) -> dict:
    """The product's details checked against its template: unknown fields and bad values are refused,
    empty values (filled or not, known or not) are simply dropped."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise BadRequestError("Product details must be an object of field: value")
    fields = {f["key"]: f for f in template.get("fields", [])}
    out: dict[str, Any] = {}
    problems: list[str] = []
    for key, value in raw.items():
        if _empty(value):
            continue
        field = fields.get(key)
        if field is None:
            problems.append(f"'{key}' is not a detail of {template.get('name', 'this template')}")
            continue
        try:
            out[key] = clean_value(field, value)
        except ValueError as e:
            problems.append(f"{field['label']} {e}")
    if problems:
        raise BadRequestError("Check the product details: " + "; ".join(problems))
    return out


def carry_over(new_template: dict, values: dict | None) -> dict:
    """Switching templates keeps only the values the new template understands (same key, still valid)."""
    fields = {f["key"]: f for f in new_template.get("fields", [])}
    out = {}
    for k, v in (values or {}).items():
        if k in fields:
            try:
                out[k] = clean_value(fields[k], v)
            except ValueError:
                pass
    return out


def show(field: dict, v: Any) -> str:
    """A value as customers read it."""
    if field["type"] == "boolean":
        return "Yes" if v else "No"
    if field["type"] in ("select", "multi_select"):
        labels = _option_values(field)
        values = v if isinstance(v, list) else [v]
        return ", ".join(labels.get(x, str(x)) for x in values)
    if field["type"] == "number":
        unit = field.get("unit")
        return f"{v} {unit}" if unit else str(v)
    return str(v)


def details(template: dict | None, values: dict | None) -> list[dict]:
    """The product page's Details table: filled fields only, in the template's order."""
    if not template or not values:
        return []
    rows = []
    for f in template.get("fields", []):
        if f["key"] in values and not _empty(values[f["key"]]):
            rows.append({"key": f["key"], "label": f["label"], "value": show(f, values[f["key"]])})
    return rows


def completeness(template: dict | None, values: dict | None) -> dict:
    """How complete a product's details are. Recommended fields weigh 2, optional fields 1."""
    fields = [f for f in (template or {}).get("fields", []) if f.get("is_active", True)]
    values = values or {}
    rec = [f for f in fields if f.get("importance") == "recommended"]
    opt = [f for f in fields if f.get("importance") != "recommended"]
    rec_done = sum(1 for f in rec if not _empty(values.get(f["key"])))
    opt_done = sum(1 for f in opt if not _empty(values.get(f["key"])))
    total = 2 * len(rec) + len(opt)
    score = round(100 * (2 * rec_done + opt_done) / total) if total else 0
    return {"recommended_filled": rec_done, "recommended_total": len(rec),
            "optional_filled": opt_done, "optional_total": len(opt), "score": score}


def label_changes(template_old: dict | None, template_new: dict | None, old: dict, new: dict) -> tuple[dict, dict]:
    """Detail changes for the activity log, keyed by the field's label ("Skin type": "Oily" -> "Oily, Dry")."""
    fields = {f["key"]: f for t in (template_old, template_new) if t for f in t.get("fields", [])}
    before, after = {}, {}
    for key in sorted(set(old) | set(new), key=lambda k: fields.get(k, {}).get("sort_order", 0)):
        if old.get(key) == new.get(key):
            continue
        f = fields.get(key, {"label": key, "type": "text"})
        name = f"Detail: {f['label']}"
        before[name] = show(f, old[key]) if key in old else None
        after[name] = show(f, new[key]) if key in new else None
    return before, after
