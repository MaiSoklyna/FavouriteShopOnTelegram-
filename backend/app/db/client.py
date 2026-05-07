"""Typed async Supabase PostgREST client.

Replaces ``services/rest.py`` with:
- Proper URL-encoding of filter values (prevents query-string injection)
- A shared ``httpx.AsyncClient`` per request instead of aiohttp session-per-call
- Typed return helpers
- No logging of sensitive headers

Usage::

    from app.db.client import SupabaseClient

    async def my_route():
        async with SupabaseClient.service_role() as db:
            users = await db.from_("users").eq("telegram_id", 12345).select()
            await db.from_("users").insert({"telegram_id": 12345, ...})
"""

from __future__ import annotations

import logging
from types import TracebackType
from typing import Any, Self
from urllib.parse import quote

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


# ── Low-level client ─────────���──────────────────────────────────


class SupabaseClient:
    """Async context-manager wrapper around Supabase PostgREST.

    Two factory constructors:

    - ``SupabaseClient.service_role()`` — bypasses RLS (for backend-trusted ops)
    - ``SupabaseClient.with_jwt(token)`` — passes user JWT (for RLS-aware queries)

    Always use as an async context manager to ensure the underlying
    ``httpx.AsyncClient`` is closed::

        async with SupabaseClient.service_role() as db:
            rows = await db.from_("products").select()
    """

    def __init__(self, *, headers: dict[str, str]) -> None:
        self._base_url = settings.supabase_rest_url
        self._headers = headers
        self._http: httpx.AsyncClient | None = None

    # ── Factory constructors ────────────────────────────────────

    @classmethod
    def service_role(cls) -> Self:
        """Create a client using the service_role key (bypasses RLS)."""
        key = settings.SUPABASE_SERVICE_ROLE_KEY
        return cls(headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        })

    @classmethod
    def with_jwt(cls, token: str) -> Self:
        """Create a client using a user JWT (respects RLS)."""
        return cls(headers={
            "apikey": settings.SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        })

    # ── Context manager ──���──────────────────────────────────────

    async def __aenter__(self) -> Self:
        self._http = httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers,
            timeout=30.0,
        )
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        if self._http:
            await self._http.aclose()
            self._http = None

    # ── Query builder entry point ───────────────────────────────

    def from_(self, table: str) -> QueryBuilder:
        """Start building a query against the given table."""
        assert self._http is not None, "Use `async with SupabaseClient...` before querying"
        return QueryBuilder(self._http, table)

    # ── RPC calls ───────────────────────────────────���───────────

    async def rpc(self, function_name: str, params: dict[str, Any] | None = None) -> Any:
        """Call a PostgREST RPC function."""
        assert self._http is not None, "Use `async with SupabaseClient...` before calling rpc"
        resp = await self._http.post(f"/rpc/{function_name}", json=params or {})
        _raise_on_error(resp, f"rpc/{function_name}")
        return _parse_response(resp)


# ── Query builder ────────────���──────────────────────────────────


class QueryBuilder:
    """Chainable PostgREST query builder.

    Supports filtering, ordering, pagination, and CRUD operations.
    All filter values are URL-encoded to prevent query-string injection.

    Example::

        rows = await (
            db.from_("products")
            .eq("merchant_id", 5)
            .eq("is_active", True)
            .order("created_at", desc=True)
            .limit(25)
            .select("id,name,base_price")
        )
    """

    def __init__(self, http: httpx.AsyncClient, table: str) -> None:
        self._http = http
        self._table = table
        self._filters: list[str] = []
        self._order_clause: str | None = None
        self._limit_val: int | None = None
        self._offset_val: int | None = None

    # ── Filters (chainable) ─────────────────────────────────────

    def eq(self, column: str, value: Any) -> QueryBuilder:
        self._filters.append(f"{column}=eq.{_encode(value)}")
        return self

    def neq(self, column: str, value: Any) -> QueryBuilder:
        self._filters.append(f"{column}=neq.{_encode(value)}")
        return self

    def gt(self, column: str, value: Any) -> QueryBuilder:
        self._filters.append(f"{column}=gt.{_encode(value)}")
        return self

    def gte(self, column: str, value: Any) -> QueryBuilder:
        self._filters.append(f"{column}=gte.{_encode(value)}")
        return self

    def lt(self, column: str, value: Any) -> QueryBuilder:
        self._filters.append(f"{column}=lt.{_encode(value)}")
        return self

    def lte(self, column: str, value: Any) -> QueryBuilder:
        self._filters.append(f"{column}=lte.{_encode(value)}")
        return self

    def like(self, column: str, pattern: str) -> QueryBuilder:
        self._filters.append(f"{column}=like.{_encode(pattern)}")
        return self

    def ilike(self, column: str, pattern: str) -> QueryBuilder:
        self._filters.append(f"{column}=ilike.{_encode(pattern)}")
        return self

    def in_(self, column: str, values: list[Any]) -> QueryBuilder:
        encoded = ",".join(_encode(v) for v in values)
        self._filters.append(f"{column}=in.({encoded})")
        return self

    def is_(self, column: str, value: Any) -> QueryBuilder:
        """IS operator — for null/true/false checks."""
        self._filters.append(f"{column}=is.{_encode(value)}")
        return self

    def not_(self, column: str, operator: str, value: Any) -> QueryBuilder:
        self._filters.append(f"{column}=not.{operator}.{_encode(value)}")
        return self

    def or_(self, *conditions: str) -> QueryBuilder:
        """OR filter: .or_("status.eq.active", "status.eq.pending")"""
        self._filters.append(f"or=({','.join(conditions)})")
        return self

    # ── Ordering & pagination (chainable) ───────────────────────

    def order(self, column: str, *, desc: bool = False, nulls_last: bool = False) -> QueryBuilder:
        direction = "desc" if desc else "asc"
        clause = f"{column}.{direction}"
        if nulls_last:
            clause += ".nullslast"
        self._order_clause = clause
        return self

    def limit(self, n: int) -> QueryBuilder:
        self._limit_val = n
        return self

    def offset(self, n: int) -> QueryBuilder:
        self._offset_val = n
        return self

    def range(self, start: int, end: int) -> QueryBuilder:
        """Convenience: set offset and limit from a [start, end) range."""
        self._offset_val = start
        self._limit_val = end - start
        return self

    # ── Terminal operations (execute the query) ─────────────────

    async def select(self, columns: str = "*") -> list[dict[str, Any]]:
        """Execute a SELECT query. Returns a list of rows (may be empty)."""
        qs = self._build_qs({"select": columns})
        resp = await self._http.get(f"/{self._table}?{qs}")
        _raise_on_error(resp, f"SELECT {self._table}")
        return _parse_response(resp) or []

    async def select_one(self, columns: str = "*") -> dict[str, Any] | None:
        """SELECT with limit 1, returns a single row or None."""
        self._limit_val = 1
        rows = await self.select(columns)
        return rows[0] if rows else None

    async def insert(
        self,
        data: dict[str, Any] | list[dict[str, Any]],
        *,
        upsert: bool = False,
    ) -> list[dict[str, Any]]:
        """INSERT one or many rows. Returns the inserted rows."""
        headers: dict[str, str] = {"Prefer": "return=representation"}
        if upsert:
            headers["Prefer"] = "resolution=merge-duplicates,return=representation"
        resp = await self._http.post(
            f"/{self._table}",
            json=data,
            headers=headers,
        )
        _raise_on_error(resp, f"INSERT {self._table}")
        return _parse_response(resp) or []

    async def update(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        """UPDATE rows matching the current filters. Returns updated rows."""
        if not self._filters:
            raise ValueError("Refusing to UPDATE without filters — this would update ALL rows")
        qs = self._build_qs()
        headers = {"Prefer": "return=representation"}
        resp = await self._http.patch(
            f"/{self._table}?{qs}",
            json=data,
            headers=headers,
        )
        _raise_on_error(resp, f"UPDATE {self._table}")
        return _parse_response(resp) or []

    async def delete(self) -> None:
        """DELETE rows matching the current filters."""
        if not self._filters:
            raise ValueError("Refusing to DELETE without filters — this would delete ALL rows")
        qs = self._build_qs()
        resp = await self._http.delete(f"/{self._table}?{qs}")
        _raise_on_error(resp, f"DELETE {self._table}")

    async def count(self) -> int:
        """Return the count of matching rows using PostgREST exact count."""
        qs = self._build_qs({"select": "count"})
        headers = {"Prefer": "count=exact"}
        resp = await self._http.head(
            f"/{self._table}?{qs}",
            headers=headers,
        )
        _raise_on_error(resp, f"COUNT {self._table}")
        content_range = resp.headers.get("content-range", "")
        # Format: "0-9/42" or "*/42"
        if "/" in content_range:
            return int(content_range.split("/")[1])
        return 0

    # ── Internal ────��───────────────────────────────────────────

    def _build_params(self) -> dict[str, str]:
        params: dict[str, str] = {}
        for f in self._filters:
            key, _, value = f.partition("=")
            params[key] = value
        if self._order_clause:
            params["order"] = self._order_clause
        if self._limit_val is not None:
            params["limit"] = str(self._limit_val)
        if self._offset_val is not None:
            params["offset"] = str(self._offset_val)
        return params

    def _build_qs(self, extra: dict[str, str] | None = None) -> str:
        """Build a raw query string that preserves commas (PostgREST needs them)."""
        params = self._build_params()
        if extra:
            params.update(extra)
        parts = [f"{k}={v}" for k, v in params.items()]
        return "&".join(parts)


# ── Storage helper ─────���────────────────────────────────────────


class StorageClient:
    """Minimal Supabase Storage helper for file uploads."""

    def __init__(self) -> None:
        self._base_url = settings.supabase_storage_url

    async def upload(
        self,
        bucket: str,
        path: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        """Upload a file and return its public URL.

        Uses service_role key to bypass storage RLS.
        """
        upload_url = f"{self._base_url}/object/{bucket}/{path}"
        async with httpx.AsyncClient(timeout=60.0) as http:
            resp = await http.post(
                upload_url,
                content=content,
                headers={
                    "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                    "Content-Type": content_type,
                    "Cache-Control": "max-age=3600",
                },
            )
        if resp.status_code >= 400:
            logger.error("Storage upload to %s/%s failed: %s", bucket, path, resp.status_code)
            raise StorageUploadError(f"Upload failed with status {resp.status_code}")

        return f"{settings.SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}"

    async def delete(self, bucket: str, paths: list[str]) -> None:
        """Delete files from a storage bucket."""
        url = f"{self._base_url}/object/{bucket}"
        async with httpx.AsyncClient(timeout=30.0) as http:
            resp = await http.request(
                "DELETE",
                url,
                json={"prefixes": paths},
                headers={
                    "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                },
            )
        if resp.status_code >= 400:
            logger.error("Storage delete from %s failed: %s", bucket, resp.status_code)


class StorageUploadError(Exception):
    pass


# ── Helpers ─────────────────────────────────────────────��───────


def _encode(value: Any) -> str:
    """URL-encode a filter value to prevent query-string injection."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    return quote(str(value), safe="")


def _raise_on_error(resp: httpx.Response, context: str) -> None:
    """Log and raise on non-2xx responses without exposing sensitive headers."""
    if resp.status_code < 400:
        return
    # Log the response body (safe) but NOT request headers (contain keys)
    body_preview = resp.text[:500] if resp.text else "(empty)"
    logger.error(
        "PostgREST error [%s] %s: %s",
        resp.status_code,
        context,
        body_preview,
    )
    resp.raise_for_status()


def _parse_response(resp: httpx.Response) -> Any:
    """Parse JSON response, returning None for empty bodies."""
    if not resp.text or resp.text.strip() == "":
        return None
    return resp.json()
