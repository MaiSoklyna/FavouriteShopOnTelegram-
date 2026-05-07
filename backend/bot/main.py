"""Standalone bot entry point.

Run this to start ONLY the Telegram bot without the API server.
Useful for deploying bot and API as separate services.

    python -m bot.main
"""

import asyncio
import logging

from bot.bot import create_bot_app

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


async def main():
    logger.info("Starting Telegram bot (standalone)...")
    app = create_bot_app()
    async with app:
        await app.initialize()
        await app.start()
        logger.info("Bot is running! Press Ctrl+C to stop.")
        await app.updater.start_polling(drop_pending_updates=True)

        # Block until stopped
        stop_event = asyncio.Event()
        try:
            await stop_event.wait()
        except (KeyboardInterrupt, SystemExit):
            pass
        finally:
            await app.updater.stop()
            await app.stop()
            await app.shutdown()
            logger.info("Bot shutdown complete.")


if __name__ == "__main__":
    asyncio.run(main())
