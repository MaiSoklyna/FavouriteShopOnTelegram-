"""Combined entry point — runs FastAPI + Telegram Bot in one process.

For production, prefer running them separately:
  - API:  uvicorn app.main:app --host 0.0.0.0 --port 8000
  - Bot:  python -m bot.main

This combined mode is useful for development and simple deployments.
"""

import asyncio
import logging

import uvicorn

from app.config import settings
from app.main import app
from bot.bot import create_bot_app

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=getattr(logging, settings.LOG_LEVEL, logging.INFO),
)
logger = logging.getLogger(__name__)


async def main():
    logger.info("Starting Favourite of Shop — API + Bot combined")

    bot_app = create_bot_app()

    config = uvicorn.Config(
        app,
        host=settings.API_HOST,
        port=settings.API_PORT,
        log_level="info",
    )
    server = uvicorn.Server(config)

    async with bot_app:
        await bot_app.initialize()
        await bot_app.start()
        await bot_app.updater.start_polling(drop_pending_updates=True)
        logger.info("Bot started — polling for updates")
        logger.info("API server starting on http://%s:%s", settings.API_HOST, settings.API_PORT)

        try:
            await server.serve()
        except (KeyboardInterrupt, SystemExit):
            logger.info("Shutting down...")
        finally:
            await bot_app.updater.stop()
            await bot_app.stop()
            await bot_app.shutdown()
            logger.info("Shutdown complete")


if __name__ == "__main__":
    asyncio.run(main())
