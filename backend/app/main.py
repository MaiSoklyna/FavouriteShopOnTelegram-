"""FastAPI application factory.

Registers all route modules and middleware. This is the single entry point
for the API — no more monolith route files.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.core.exceptions import register_exception_handlers
from app.core.rate_limit import limiter, rate_limit_handler
from app.routes import (
    ai,
    analytics,
    auth,
    banners,
    cart,
    loyalty,
    merchants,
    notifications,
    orders,
    products,
    promos,
    reviews,
    support,
    telegram_webhook,
    users,
)

logging.basicConfig(level=getattr(logging, settings.LOG_LEVEL, logging.INFO))
logger = logging.getLogger(__name__)

_DEFAULT_DEV_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    "http://localhost:5174",
]

ALLOWED_ORIGINS = settings.CORS_ORIGINS if settings.CORS_ORIGINS else _DEFAULT_DEV_ORIGINS


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Favourite of Shop API...")
    yield
    logger.info("Shutting down API...")


app = FastAPI(
    title="Favourite of Shop API",
    description="Multi-Tenant Telegram E-Commerce Platform",
    version="2.0.0",
    lifespan=lifespan,
)

# ── Middleware ───────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ── Exception handlers ──────────────────────────────────────────

register_exception_handlers(app)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_handler)  # type: ignore[arg-type]

# ── Routes ──────────────────────────────────────────────────────

# Auth (Telegram + admin login + profile + password)
app.include_router(auth.router, prefix="/api")

# Users (self-service + admin listing)
app.include_router(users.router, prefix="/api")

# Merchants (browse + admin CRUD)
app.include_router(merchants.router, prefix="/api")

# Products & categories (browse + admin CRUD + image upload)
app.include_router(products.router, prefix="/api")
app.include_router(banners.router, prefix="/api")

# Cart
app.include_router(cart.router, prefix="/api")

# Orders (user placement + admin management)
app.include_router(orders.router, prefix="/api")

# Promos
app.include_router(promos.router, prefix="/api")

# Reviews
app.include_router(reviews.router, prefix="/api")

# Support tickets
app.include_router(support.router, prefix="/api")

# Loyalty program
app.include_router(loyalty.router, prefix="/api")

# Notifications
app.include_router(notifications.router, prefix="/api")

# AI assistant
app.include_router(ai.router, prefix="/api")

# Analytics (admin dashboard stats)
app.include_router(analytics.router, prefix="/api")

# Telegram webhook (replaces polling on Railway)
app.include_router(telegram_webhook.router, prefix="/api")


# ── Backwards-compatible Edge Function routes ───────────────────
# The miniapp currently calls /functions/v1/* endpoints.
# Mount auth and user endpoints under that prefix too for migration.

app.include_router(auth.router, prefix="/functions/v1", tags=["Legacy Miniapp"])
app.include_router(cart.router, prefix="/functions/v1", tags=["Legacy Miniapp"])
app.include_router(orders.router, prefix="/functions/v1", tags=["Legacy Miniapp"])
app.include_router(promos.router, prefix="/functions/v1", tags=["Legacy Miniapp"])
app.include_router(reviews.router, prefix="/functions/v1", tags=["Legacy Miniapp"])
app.include_router(support.router, prefix="/functions/v1", tags=["Legacy Miniapp"])
app.include_router(loyalty.router, prefix="/functions/v1", tags=["Legacy Miniapp"])
app.include_router(ai.router, prefix="/functions/v1", tags=["Legacy Miniapp"])
app.include_router(notifications.router, prefix="/functions/v1", tags=["Legacy Miniapp"])


# ── Health / root ───────────────────────────────────────────────


@app.get("/")
async def root():
    return {
        "name": "Favourite of Shop API",
        "version": "2.0.0",
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "database": "supabase",
        "environment": settings.ENVIRONMENT,
    }
