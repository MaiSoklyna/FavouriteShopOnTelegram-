"""Application settings with validation.

Uses pydantic-settings to load from environment variables and .env files.
Every secret is validated at startup — the app refuses to start with missing
or obviously broken credentials.
"""

from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv
from pydantic import BaseModel, field_validator

load_dotenv()


class Settings(BaseModel):
    """Validated application settings.

    All values come from environment variables (or .env).
    pydantic validates types and constraints at construction time,
    so the app crashes immediately if something critical is missing.
    """

    # ── Telegram ────────────────────────────────────────────────
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_BOT_USERNAME: str = ""

    # ── Supabase ────────────────────────────────────────────────
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_JWT_SECRET: str = ""

    # ── JWT / Auth ──────────────────────────────────────────────
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 h default

    # ── App ─────────────────────────────────────────────────────
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"
    CURRENCY: str = "USD"

    # ── Server ──────────────────────────────────────────────────
    API_HOST: str = "127.0.0.1"
    API_PORT: int = 8000

    # ── Frontend URLs ───────────────────────────────────────────
    WEB_APP_URL: str = "http://localhost:3000"
    ADMIN_PANEL_URL: str = "http://localhost:3001"

    # ── CORS ────────────────────────────────────────────────────
    CORS_ORIGINS: list[str] = []

    # ── Admin ───────────────────────────────────────────────────
    ADMIN_USER_IDS: list[int] = []

    # ── Support ─────────────────────────────────────────────────
    SUPPORT_GROUP_ID: int = 0

    # ── OpenAI (optional) ───────────────────────────────────────
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"

    # ── Validators ──────────────────────────────────────────────

    @field_validator("SUPABASE_URL")
    @classmethod
    def _url_not_empty(cls, v: str) -> str:
        if not v:
            raise ValueError(
                "SUPABASE_URL is required. "
                "Set it to your Supabase project URL (https://xxx.supabase.co)."
            )
        return v.rstrip("/")

    @field_validator("SUPABASE_JWT_SECRET")
    @classmethod
    def _jwt_secret_present(cls, v: str) -> str:
        if not v:
            raise ValueError(
                "SUPABASE_JWT_SECRET is required. "
                "Find it in Supabase → Settings → API → JWT Secret."
            )
        return v

    @field_validator("SUPABASE_SERVICE_ROLE_KEY")
    @classmethod
    def _service_role_present(cls, v: str) -> str:
        if not v:
            raise ValueError(
                "SUPABASE_SERVICE_ROLE_KEY is required. "
                "Find it in Supabase → Settings → API → service_role key."
            )
        return v.strip()

    @field_validator("TELEGRAM_BOT_TOKEN")
    @classmethod
    def _bot_token_present(cls, v: str) -> str:
        if not v:
            raise ValueError(
                "TELEGRAM_BOT_TOKEN is required. Get it from @BotFather."
            )
        return v

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def supabase_rest_url(self) -> str:
        return f"{self.SUPABASE_URL}/rest/v1"

    @property
    def supabase_storage_url(self) -> str:
        return f"{self.SUPABASE_URL}/storage/v1"

    @property
    def supabase_issuer(self) -> str:
        """JWT issuer claim matching Supabase's own tokens."""
        return f"{self.SUPABASE_URL}/auth/v1"


def _load_settings() -> Settings:
    """Build Settings from environment variables.

    Handles the type conversions that env vars need (comma-separated lists,
    int parsing, bool parsing) before passing to pydantic.
    """
    raw: dict = {}

    # Simple string/int/bool env vars — pydantic handles type coercion
    simple_keys = [
        "TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME",
        "SUPABASE_JWT_SECRET", "SUPABASE_SERVICE_ROLE_KEY",
        "ALGORITHM", "ENVIRONMENT", "LOG_LEVEL", "CURRENCY",
        "API_HOST", "WEB_APP_URL", "ADMIN_PANEL_URL",
        "SUPPORT_GROUP_ID", "OPENAI_API_KEY", "OPENAI_MODEL",
        "ACCESS_TOKEN_EXPIRE_MINUTES",
    ]
    for key in simple_keys:
        val = os.getenv(key)
        if val is not None and val != "":
            raw[key] = val

    # Supabase URL — accept both old and new env var names for migration
    raw["SUPABASE_URL"] = (
        os.getenv("SUPABASE_URL")
        or os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
    )
    raw["SUPABASE_ANON_KEY"] = (
        os.getenv("SUPABASE_ANON_KEY")
        or os.getenv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY", "")
    )

    # Port — platforms like Railway set PORT
    port = os.getenv("PORT") or os.getenv("API_PORT")
    if port:
        raw["API_PORT"] = int(port)

    # DEBUG
    raw["DEBUG"] = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")

    # Comma-separated lists
    cors = os.getenv("CORS_ORIGINS", "")
    raw["CORS_ORIGINS"] = [o.strip() for o in cors.split(",") if o.strip()]

    admin_ids = os.getenv("ADMIN_USER_IDS", "")
    raw["ADMIN_USER_IDS"] = [int(x) for x in admin_ids.split(",") if x.strip()]

    return Settings(**raw)


@lru_cache
def get_settings() -> Settings:
    return _load_settings()


# Module-level singleton for backwards-compatible `from app.config import settings`
settings = get_settings()
