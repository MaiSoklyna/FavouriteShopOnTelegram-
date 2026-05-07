"""OpenAI service for AI Assistant — product-aware chat."""

import logging
import aiohttp
from app.config import settings
from app.services.rest import RestClient

logger = logging.getLogger(__name__)


async def build_product_context() -> str:
    """Fetch products from DB and format as text context for the AI."""
    client = RestClient(service_role=True)
    products = await client.get(
        "products?is_active=eq.true&select=id,name,base_price,description,stock,slug"
        "&order=created_at.desc&limit=100"
    )
    if not products:
        return "No products currently available."

    lines = []
    for p in products:
        stock_status = "In Stock" if p.get("stock", 0) > 0 else "Out of Stock"
        desc = (p.get("description") or "")[:100]
        lines.append(
            f"- [{p['id']}] {p['name']} — ${p['base_price']} ({stock_status})"
            f"{f': {desc}' if desc else ''}"
        )
    return "\n".join(lines)


def build_system_prompt(product_context: str, custom_prompt: str | None = None) -> str:
    """Build the system prompt with product catalog context."""
    base = custom_prompt or (
        "You are a friendly and helpful shopping assistant for Favourite of Shop, "
        "an e-commerce platform. Your role is to:\n"
        "1. Help customers find products that match their needs\n"
        "2. Answer questions about products, pricing, and availability\n"
        "3. Provide order and delivery information\n"
        "4. Be concise, friendly, and helpful\n\n"
        "When recommending products, mention the product name and price. "
        "If a product is out of stock, let the customer know.\n"
        "Keep responses short and conversational (2-4 sentences max).\n"
        "Answer in the same language the customer uses."
    )

    return f"{base}\n\n## Current Product Catalog:\n{product_context}"


async def chat_completion(
    messages: list[dict],
    system_prompt: str,
    model: str = "gpt-4o-mini",
    temperature: float = 0.7,
    max_tokens: int = 500,
) -> dict:
    """Call OpenAI Chat Completions API."""
    if not settings.OPENAI_API_KEY:
        return {
            "content": "AI Assistant is not configured yet. Please ask the admin to set up the OpenAI API key.",
            "tokens_used": 0,
            "product_ids": [],
        }

    api_messages = [{"role": "system", "content": system_prompt}] + messages

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": api_messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    logger.error("OpenAI API error %s: %s", resp.status, error_text[:300])
                    return {
                        "content": "Sorry, I'm having trouble right now. Please try again in a moment.",
                        "tokens_used": 0,
                        "product_ids": [],
                    }
                data = await resp.json()

        choice = data["choices"][0]["message"]
        usage = data.get("usage", {})

        # Extract product IDs mentioned in brackets like [123]
        import re
        product_ids = [int(x) for x in re.findall(r"\[(\d+)\]", choice["content"])]

        return {
            "content": choice["content"],
            "tokens_used": usage.get("total_tokens", 0),
            "product_ids": product_ids,
        }
    except Exception as e:
        logger.exception("OpenAI API call failed: %s", e)
        return {
            "content": "Sorry, I'm having trouble connecting right now. Please try again later.",
            "tokens_used": 0,
            "product_ids": [],
        }
