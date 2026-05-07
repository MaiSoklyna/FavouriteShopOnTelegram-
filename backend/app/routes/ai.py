"""AI assistant routes.

User-facing: chat, conversation management.
Admin-facing: settings and conversation monitoring.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter

from app.core.constants import Role
from app.core.dependencies import require_any_admin, require_role
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["AI Assistant"])


# ═══════════════════════════════════════════════════════════════
#  USER ENDPOINTS
# ═══════════════════════════════════════════════════════════════


@router.post("/chat")
async def ai_chat(body: dict, user: TokenClaims = require_role(Role.USER)):
    """Send a message to the AI assistant."""
    message = body.get("message", "").strip()
    conversation_id = body.get("conversation_id")

    if not message:
        raise BadRequestError("Message is required")

    async with SupabaseClient.service_role() as db:
        # Resolve user
        db_user = None
        if user.telegram_id:
            db_user = await db.from_("users").eq("telegram_id", user.telegram_id).select_one("id")
        if not db_user:
            raise NotFoundError("User")

        # Check AI enabled
        ai_settings = await db.from_("ai_settings").select_one()
        if not ai_settings or not ai_settings.get("is_enabled"):
            raise BadRequestError("AI assistant is not enabled")

        # Get or create conversation
        if conversation_id:
            convo = await db.from_("ai_conversations").eq("id", conversation_id).select_one()
            if not convo:
                raise NotFoundError("Conversation", conversation_id)
        else:
            rows = await db.from_("ai_conversations").insert({
                "user_id": db_user["id"],
                "title": message[:80],
                "status": "active",
            })
            convo = rows[0]
            conversation_id = convo["id"]

        # Save user message
        await db.from_("ai_messages").insert({
            "conversation_id": conversation_id,
            "role": "user",
            "content": message,
        })

        # Load recent messages for context
        recent = await (
            db.from_("ai_messages")
            .eq("conversation_id", conversation_id)
            .order("created_at")
            .limit(20)
            .select("role,content")
        )

        # Call OpenAI
        try:
            from app.services.openai_service import build_product_context, chat_completion
            product_context = await build_product_context(db)
            system_prompt = ai_settings.get("system_prompt", "You are a helpful shopping assistant.")
            if product_context:
                system_prompt += f"\n\nAvailable products:\n{product_context}"

            messages_for_ai = [{"role": m["role"], "content": m["content"]} for m in recent]
            response_text, token_count, product_ids = await chat_completion(
                system_prompt=system_prompt,
                messages=messages_for_ai,
                model=ai_settings.get("model", "gpt-4o-mini"),
                temperature=ai_settings.get("temperature", 0.7),
                max_tokens=ai_settings.get("max_tokens", 500),
            )
        except Exception as e:
            logger.exception("AI chat error")
            response_text = "Sorry, I'm having trouble right now. Please try again later."
            token_count = 0
            product_ids = []

        # Save assistant response
        await db.from_("ai_messages").insert({
            "conversation_id": conversation_id,
            "role": "assistant",
            "content": response_text,
            "token_count": token_count,
        })

        # Update conversation
        msg_count = len(recent) + 2  # user + assistant
        await db.from_("ai_conversations").eq("id", conversation_id).update({
            "message_count": msg_count,
        })

        # Fetch referenced products
        products = []
        if product_ids:
            products = await db.from_("products").in_("id", product_ids[:5]).select(
                "id,name,base_price,primary_image,slug"
            )

    return {
        "conversation_id": conversation_id,
        "message": {
            "role": "assistant",
            "content": response_text,
            "products": products,
        },
    }


@router.get("/conversations")
async def list_conversations(user: TokenClaims = require_role(Role.USER)):
    """List user's AI conversations."""
    async with SupabaseClient.service_role() as db:
        db_user = None
        if user.telegram_id:
            db_user = await db.from_("users").eq("telegram_id", user.telegram_id).select_one("id")
        if not db_user:
            return []

        return await (
            db.from_("ai_conversations")
            .eq("user_id", db_user["id"])
            .eq("status", "active")
            .order("updated_at", desc=True)
            .limit(50)
            .select()
        )


@router.get("/conversations/{convo_id}")
async def get_conversation(convo_id: int, user: TokenClaims = require_role(Role.USER)):
    """Get a conversation with all messages."""
    async with SupabaseClient.service_role() as db:
        convo = await db.from_("ai_conversations").eq("id", convo_id).select_one()
        if not convo:
            raise NotFoundError("Conversation", convo_id)

        messages = await (
            db.from_("ai_messages")
            .eq("conversation_id", convo_id)
            .order("created_at")
            .select()
        )
        convo["messages"] = messages
    return convo


@router.post("/conversations/{convo_id}/archive")
async def archive_conversation(convo_id: int, user: TokenClaims = require_role(Role.USER)):
    """Archive (soft-delete) a conversation."""
    async with SupabaseClient.service_role() as db:
        await db.from_("ai_conversations").eq("id", convo_id).update({"status": "archived"})
    return {"success": True}


@router.get("/settings")
async def get_ai_settings_public():
    """Get public AI settings (is_enabled + welcome_message)."""
    async with SupabaseClient.service_role() as db:
        row = await db.from_("ai_settings").select_one("is_enabled,welcome_message")
    return row or {"is_enabled": False}


# ═══════════════════════════════════════════════════════════════
#  ADMIN ENDPOINTS
# ═══════════════════════════════════════════════════════════════


@router.get("/admin/settings")
async def get_ai_settings_admin(user: TokenClaims = require_any_admin()):
    """Get full AI settings (admin)."""
    async with SupabaseClient.service_role() as db:
        return await db.from_("ai_settings").select_one()


@router.put("/admin/settings")
async def update_ai_settings(body: dict, user: TokenClaims = require_any_admin()):
    """Update AI settings (admin)."""
    async with SupabaseClient.service_role() as db:
        data = {k: body[k] for k in (
            "is_enabled", "system_prompt", "welcome_message",
            "model", "temperature", "max_tokens",
        ) if k in body}

        existing = await db.from_("ai_settings").select_one("id")
        if existing:
            await db.from_("ai_settings").eq("id", existing["id"]).update(data)
            return await db.from_("ai_settings").eq("id", existing["id"]).select_one()
        else:
            rows = await db.from_("ai_settings").insert(data)
            return rows[0] if rows else data


@router.get("/admin/conversations")
async def list_conversations_admin(
    search: str | None = None,
    limit: int = 50,
    user: TokenClaims = require_any_admin(),
):
    """List AI conversations with user info (admin)."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("ai_conversations").order("updated_at", desc=True).limit(limit)
        if search:
            q = q.ilike("title", f"*{search}*")
        return await q.select("*,users!inner(username,first_name,last_name)")


@router.get("/admin/conversations/{convo_id}")
async def get_conversation_admin(convo_id: int, user: TokenClaims = require_any_admin()):
    """Get a conversation with messages (admin)."""
    async with SupabaseClient.service_role() as db:
        convo = await (
            db.from_("ai_conversations")
            .eq("id", convo_id)
            .select_one("*,users!inner(username,first_name,last_name)")
        )
        if not convo:
            raise NotFoundError("Conversation", convo_id)

        messages = await (
            db.from_("ai_messages")
            .eq("conversation_id", convo_id)
            .order("created_at")
            .select()
        )
        convo["messages"] = messages
    return convo


@router.get("/admin/stats")
async def get_ai_stats(user: TokenClaims = require_any_admin()):
    """AI assistant usage stats (admin)."""
    from datetime import datetime, timezone

    async with SupabaseClient.service_role() as db:
        convos = await db.from_("ai_conversations").select("id,created_at")
        total = len(convos)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        today_count = sum(1 for c in convos if c.get("created_at", "").startswith(today))

        msgs = await db.from_("ai_messages").select("id")
        total_messages = len(msgs)

    return {
        "totalConversations": total,
        "totalMessages": total_messages,
        "todayConversations": today_count,
    }
