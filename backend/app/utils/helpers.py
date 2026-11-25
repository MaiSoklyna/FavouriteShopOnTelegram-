"""
Utility helper functions used across the application.
"""
import uuid
import re
from datetime import datetime, timezone
from typing import Optional


def generate_order_number() -> str:
    """Generate a unique human-readable order number."""
    return f"ORD-{uuid.uuid4().hex[:8].upper()}"


def generate_invoice_number() -> str:
    """Generate a unique invoice number."""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    unique = uuid.uuid4().hex[:6].upper()
    return f"INV-{timestamp}-{unique}"


def format_price(amount: float, currency: str = "USD") -> str:
    """Format a price for display."""
    symbols = {"USD": "$", "KHR": "៛", "EUR": "€"}
    symbol = symbols.get(currency, currency)
    return f"{symbol}{amount:,.2f}"


def validate_phone_number(phone: str) -> bool:
    """Validate Cambodian phone number format."""
    # Cambodian phone: 0XX XXX XXXX or +855 XX XXX XXXX
    pattern = r'^(\+855|0)\d{8,9}$'
    cleaned = re.sub(r'[\s\-]', '', phone)
    return bool(re.match(pattern, cleaned))


def validate_email(email: str) -> bool:
    """Basic email validation."""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def truncate_text(text: str, max_length: int = 100) -> str:
    """Truncate text with ellipsis if too long."""
    if not text or len(text) <= max_length:
        return text or ""
    return text[:max_length - 3] + "..."


def calculate_discount(price: float, discount_percentage: float) -> dict:
    """Calculate discount amount and final price."""
    discount_amount = round(price * (discount_percentage / 100), 2)
    final_price = round(price - discount_amount, 2)
    return {
        "original_price": price,
        "discount_percentage": discount_percentage,
        "discount_amount": discount_amount,
        "final_price": final_price,
    }


def get_order_status_display(status: str) -> dict:
    """Get display info for order status."""
    status_map = {
        "pending": {"emoji": "⏳", "label": "Pending", "color": "#FFA500"},
        "confirmed": {"emoji": "✅", "label": "Confirmed", "color": "#4CAF50"},
        "preparing": {"emoji": "👨‍🍳", "label": "Preparing", "color": "#2196F3"},
        "shipped": {"emoji": "🚚", "label": "Shipped", "color": "#9C27B0"},
        "delivered": {"emoji": "📦", "label": "Delivered", "color": "#4CAF50"},
        "cancelled": {"emoji": "❌", "label": "Cancelled", "color": "#F44336"},
        "expired": {"emoji": "⌛", "label": "Expired", "color": "#9E9E9E"},
    }
    return status_map.get(status, {"emoji": "❓", "label": status, "color": "#999"})


def get_payment_status_display(status: str) -> dict:
    """Get display info for payment status."""
    status_map = {
        "pending": {"emoji": "⏳", "label": "Pending", "color": "#FFA500"},
        "confirmed": {"emoji": "✅", "label": "Confirmed", "color": "#4CAF50"},
        "completed": {"emoji": "💰", "label": "Completed", "color": "#4CAF50"},
        "failed": {"emoji": "❌", "label": "Failed", "color": "#F44336"},
    }
    return status_map.get(status, {"emoji": "❓", "label": status, "color": "#999"})


def paginate(items: list, page: int = 1, per_page: int = 10) -> dict:
    """Paginate a list of items."""
    total = len(items)
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    start = (page - 1) * per_page
    end = start + per_page

    return {
        "items": items[start:end],
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": total_pages,
        "has_next": page < total_pages,
        "has_prev": page > 1,
    }


def time_ago(dt: Optional[datetime]) -> str:
    """Convert datetime to human-readable 'time ago' string."""
    if not dt:
        return "N/A"
    now = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    diff = now - dt
    seconds = int(diff.total_seconds())

    if seconds < 60:
        return "just now"
    elif seconds < 3600:
        mins = seconds // 60
        return f"{mins}m ago"
    elif seconds < 86400:
        hours = seconds // 3600
        return f"{hours}h ago"
    elif seconds < 604800:
        days = seconds // 86400
        return f"{days}d ago"
    else:
        return dt.strftime("%Y-%m-%d")