"""Vercel serverless entry point for the FastAPI app.

Vercel auto-detects ``app`` as an ASGI application and mounts it.
The parent ``backend/`` directory is added to ``sys.path`` so the
existing ``app.*`` and ``bot.*`` package imports continue to work.

NOTE: The Telegram bot's polling loop in run.py CANNOT run here —
serverless functions are killed after each request. Run the bot
on a long-lived host (Railway, your dev machine) or migrate it
to a Telegram webhook calling a dedicated route.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import app  # noqa: E402,F401
