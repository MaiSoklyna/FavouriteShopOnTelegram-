"""Stock for orders: take it atomically, give it back atomically.

The database does the work (migration 026): `reserve_stock` takes stock for every line of
an order or takes none and raises, `release_stock` returns it. Nothing here reads stock and
writes it back, because that races: two buyers of the last unit both read "1".

Rules the SQL enforces (the same ones the cart uses):
- a plain product is limited by its own stock;
- a product with variants is limited by the chosen options' stock (product-level stock is
  only a running total for those, clamped at zero).
"""

from __future__ import annotations

import logging

import httpx

from app.core.exceptions import BadRequestError

logger = logging.getLogger(__name__)


def stock_lines(items: list[dict]) -> list[dict]:
    """Order/cart items -> the JSON the SQL functions take."""
    lines = []
    for it in items:
        options = [
            sv["option_id"] for sv in (it.get("selected_variants") or [])
            if isinstance(sv, dict) and sv.get("option_id")
        ]
        lines.append({"product_id": it["product_id"], "quantity": it["quantity"], "option_ids": options})
    return lines


def _error_body(exc: httpx.HTTPStatusError) -> dict:
    try:
        body = exc.response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _function_missing(exc: httpx.HTTPStatusError) -> bool:
    """PostgREST's answer when the database function does not exist (migration 026 not run yet)."""
    body = _error_body(exc)
    return body.get("code") == "PGRST202" or (
        exc.response.status_code == 404 and "function" in str(body.get("message", "")).lower()
    )


async def reserve_stock(db, items: list[dict]) -> None:
    """Take stock for every line, or none. Raises BadRequestError naming what sold out."""
    lines = stock_lines(items)
    if not lines:
        return
    try:
        await db.rpc("reserve_stock", {"p_items": lines})
    except httpx.HTTPStatusError as exc:
        body = _error_body(exc)
        if body.get("code") == "P0001":
            raise BadRequestError(body.get("message") or "An item in your order just sold out") from exc
        if _function_missing(exc):
            logger.error("Migration 026 (atomic stock) is not applied: stock is NOT protected from overselling")
            await _legacy_adjust(db, lines, sign=-1)
            return
        raise


async def release_stock(db, items: list[dict]) -> None:
    """Give stock back (order cancelled or failed). Never raises: a cancel must not fail on this."""
    lines = stock_lines(items)
    if not lines:
        return
    try:
        await db.rpc("release_stock", {"p_items": lines})
    except httpx.HTTPStatusError as exc:
        if _function_missing(exc):
            logger.error("Migration 026 (atomic stock) is not applied: restoring stock the old, racy way")
            await _legacy_adjust(db, lines, sign=+1)
            return
        logger.exception("Could not release stock for %s", lines)
    except Exception:
        logger.exception("Could not release stock for %s", lines)


async def _legacy_adjust(db, lines: list[dict], *, sign: int) -> None:
    """Pre-026 behaviour (read, change, write; clamped at zero). Only used until migration 026 is run."""
    for line in lines:
        qty = line["quantity"] * sign
        product = await db.from_("products").eq("id", line["product_id"]).select_one("stock")
        if product:
            await db.from_("products").eq("id", line["product_id"]).update(
                {"stock": max((product.get("stock") or 0) + qty, 0)}
            )
        for opt_id in line["option_ids"]:
            opt = await db.from_("product_variant_options").eq("id", opt_id).select_one("stock_adjust")
            if opt:
                await db.from_("product_variant_options").eq("id", opt_id).update(
                    {"stock_adjust": max((opt.get("stock_adjust") or 0) + qty, 0)}
                )
