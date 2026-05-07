"""Async Supabase helpers for bot handlers.

Thin wrappers around ``app.db.client.SupabaseClient`` that keep the
bot handlers' call sites simple (no context-manager boilerplate).
"""

from __future__ import annotations

from typing import Any

from app.db.client import SupabaseClient


async def sb_get(table: str, params: str) -> list[dict]:
    """GET rows using PostgREST query string (e.g. "select=*&id=eq.5")."""
    async with SupabaseClient.service_role() as db:
        # Parse simple PostgREST params into query builder calls
        # For backwards compat, we pass raw params via httpx
        import httpx
        resp = await db._http.get(f"/{table}?{params}")  # type: ignore[union-attr]
        resp.raise_for_status()
        return resp.json() if resp.text else []


async def sb_get_one(table: str, params: str) -> dict | None:
    """GET single row or None."""
    rows = await sb_get(table, params)
    return rows[0] if rows else None


async def sb_post(table: str, data: dict) -> list[dict]:
    """INSERT into Supabase REST."""
    async with SupabaseClient.service_role() as db:
        return await db.from_(table).insert(data)


async def sb_patch(table: str, params: str, data: dict) -> list[dict]:
    """UPDATE rows via Supabase REST (raw PostgREST filter string)."""
    async with SupabaseClient.service_role() as db:
        resp = await db._http.patch(  # type: ignore[union-attr]
            f"/{table}?{params}",
            json=data,
            headers={"Prefer": "return=representation"},
        )
        resp.raise_for_status()
        return resp.json() if resp.text else []


async def sb_delete(table: str, params: str) -> None:
    """DELETE rows via Supabase REST."""
    async with SupabaseClient.service_role() as db:
        resp = await db._http.delete(f"/{table}?{params}")  # type: ignore[union-attr]
        resp.raise_for_status()
