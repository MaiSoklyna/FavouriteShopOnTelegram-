"""Async Supabase REST helpers for bot handlers."""

import httpx
from app.config import settings

_SB_URL = settings.NEXT_PUBLIC_SUPABASE_URL.rstrip("/")
_SB_KEY = settings.SUPABASE_SERVICE_ROLE_KEY
_SB_HEADERS = {
    "apikey": _SB_KEY,
    "Authorization": f"Bearer {_SB_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


async def sb_get(table: str, params: str) -> list:
    """GET rows from Supabase REST (PostgREST query string)."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{_SB_URL}/rest/v1/{table}?{params}", headers=_SB_HEADERS)
    r.raise_for_status()
    return r.json()


async def sb_get_one(table: str, params: str) -> dict | None:
    """GET single row or None."""
    rows = await sb_get(table, params)
    return rows[0] if rows else None


async def sb_post(table: str, data: dict) -> list:
    """INSERT into Supabase REST."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{_SB_URL}/rest/v1/{table}", json=data, headers=_SB_HEADERS)
    r.raise_for_status()
    return r.json()


async def sb_patch(table: str, params: str, data: dict) -> list:
    """UPDATE rows via Supabase REST."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.patch(f"{_SB_URL}/rest/v1/{table}?{params}", json=data, headers=_SB_HEADERS)
    r.raise_for_status()
    return r.json()


async def sb_delete(table: str, params: str) -> None:
    """DELETE rows via Supabase REST."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.delete(f"{_SB_URL}/rest/v1/{table}?{params}", headers=_SB_HEADERS)
    r.raise_for_status()


async def sb_rpc(function_name: str, data: dict | None = None) -> list:
    """Call a PostgREST RPC function."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{_SB_URL}/rest/v1/rpc/{function_name}",
            json=data or {},
            headers=_SB_HEADERS,
        )
    r.raise_for_status()
    return r.json()
