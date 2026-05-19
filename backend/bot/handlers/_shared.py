"""Shared helpers for bot handlers.

Lets the same handler function serve both a CallbackQueryHandler (button tap)
and a CommandHandler (slash command) — the only difference between the two
is whether we should *edit* the existing message or *reply* with a new one.
"""

from __future__ import annotations

from typing import Any

from telegram import Update


async def send_or_edit(update: Update, text: str, **kwargs: Any) -> None:
    """Edit the message when invoked via callback, reply when invoked via command."""
    if update.callback_query is not None:
        await update.callback_query.edit_message_text(text, **kwargs)
        return
    if update.effective_message is not None:
        await update.effective_message.reply_text(text, **kwargs)


async def ack_if_callback(update: Update) -> None:
    """No-op when invoked via command; acknowledges the button tap otherwise."""
    if update.callback_query is not None:
        await update.callback_query.answer()
