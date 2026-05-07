"""Async PostgREST client for calling Supabase REST API directly."""

from __future__ import annotations

from typing import Any

import aiohttp

from app.config import settings


class RestClient:
    """Thin async wrapper around PostgREST.

    Args:
        jwt: Bearer token for Authorization header.
        service_role: If True, uses the service-role key for both apikey
            and Authorization headers, bypassing RLS.
    """

    def __init__(self, jwt: str | None = None, *, service_role: bool = False):
        self._base = settings.NEXT_PUBLIC_SUPABASE_URL.rstrip("/") + "/rest/v1"
        if service_role:
            key = settings.SUPABASE_SERVICE_ROLE_KEY.strip()
            self._headers = {
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            }
        else:
            anon = settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY.strip()
            self._headers = {
                "apikey": anon,
                "Authorization": f"Bearer {jwt}",
                "Content-Type": "application/json",
            }

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json_body: Any = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        url = f"{self._base}/{path.lstrip('/')}"
        headers = {**self._headers, **(extra_headers or {})}
        async with aiohttp.ClientSession() as session:
            async with session.request(
                method, url, params=params, json=json_body, headers=headers
            ) as resp:
                text = await resp.text()
                if resp.status >= 400:
                    import logging
                    logging.getLogger(__name__).error(
                        "PostgREST %s %s → %s: %s",
                        method, path, resp.status, text[:300],
                    )
                    resp.raise_for_status()
                if not text:
                    return None
                return await resp.json(content_type=None)

    async def get(
        self, path: str, *, params: dict[str, str] | None = None
    ) -> Any:
        return await self._request("GET", path, params=params)

    async def insert(
        self,
        path: str,
        body: dict | list[dict],
        *,
        upsert: bool = False,
    ) -> Any:
        extra: dict[str, str] = {"Prefer": "return=representation"}
        if upsert:
            extra["Prefer"] = "resolution=merge-duplicates,return=representation"
        return await self._request(
            "POST", path, json_body=body, extra_headers=extra
        )

    async def update(
        self,
        path: str,
        body: dict,
        *,
        params: dict[str, str] | None = None,
    ) -> Any:
        return await self._request(
            "PATCH", path, json_body=body, params=params
        )

    async def delete(
        self, path: str, *, params: dict[str, str] | None = None
    ) -> Any:
        return await self._request("DELETE", path, params=params)

    async def rpc(self, function_name: str, body: dict | None = None) -> Any:
        """Call a PostgREST RPC function."""
        return await self._request("POST", f"rpc/{function_name}", json_body=body or {})
