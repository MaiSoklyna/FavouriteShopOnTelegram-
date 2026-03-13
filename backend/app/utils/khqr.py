"""
KHQR Payment Integration Utility
Based on BAKONG KHQR Specification (EMV QR Code Standard)
For MVP: Generates static QR codes with simplified format
Production: Use BAKONG API at api.bakong.nbc.gov.kh
"""

import qrcode
import base64
from io import BytesIO
from typing import Optional
from bot.supabase_helpers import sb_get_one


async def get_merchant_name(merchant_id: int) -> str:
    """Fetch merchant name from Supabase"""
    if not merchant_id:
        return "Favourite of Shop"

    result = await sb_get_one("merchants", f"select=name&id=eq.{merchant_id}")
    return result['name'] if result else "Unknown Merchant"


async def get_merchant_account_info(merchant_id: int) -> dict:
    """Fetch merchant payment account information"""
    if not merchant_id:
        return {
            'name': 'Favourite of Shop',
            'account_id': 'platform@bakong',
            'bakong_account': None
        }

    result = await sb_get_one("merchants", f"select=name,bakong_account,phone&id=eq.{merchant_id}")

    if result:
        return {
            'name': result['name'],
            'account_id': result.get('bakong_account') or result.get('phone') or f'merchant_{merchant_id}@bakong',
            'bakong_account': result.get('bakong_account')
        }

    return {
        'name': 'Unknown Merchant',
        'account_id': f'merchant_{merchant_id}@bakong',
        'bakong_account': None
    }


async def generate_khqr_payload(
    amount: float,
    order_id: str,
    merchant_id: Optional[int] = None,
    currency: str = "USD"
) -> str:
    """
    Generate KHQR payload string following simplified EMV QR format
    """
    merchant_info = await get_merchant_account_info(merchant_id) if merchant_id else {
        'name': 'Favourite of Shop',
        'account_id': 'platform@bakong'
    }

    payload_parts = [
        f"00:KHQR",
        f"01:12",
        f"30:{merchant_info['account_id']}",
        f"52:0000",
        f"53:{currency}",
        f"54:{amount:.2f}",
        f"58:KH",
        f"59:{merchant_info['name'][:25]}",
        f"62:ORD-{order_id}",
    ]

    payload = "|".join(payload_parts)
    return payload


async def generate_khqr(
    amount: float,
    order_id: str,
    merchant_id: Optional[int] = None,
    currency: str = "USD"
) -> str:
    """
    Generate KHQR QR code as base64 encoded image
    """
    payload = await generate_khqr_payload(amount, order_id, merchant_id, currency)

    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=2,
    )

    qr.add_data(payload)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")

    buffer = BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)

    base64_image = base64.b64encode(buffer.getvalue()).decode('utf-8')

    return f"data:image/png;base64,{base64_image}"


def verify_khqr_payment(
    transaction_id: str,
    order_id: str,
    expected_amount: float
) -> dict:
    """
    Verify KHQR payment status (MVP simulation)
    """
    return {
        'success': False,
        'verified': False,
        'status': 'pending',
        'message': 'Manual verification required. For production, implement BAKONG API integration.',
        'transaction_id': transaction_id,
        'order_id': order_id,
        'amount': expected_amount,
        'note': 'This is MVP mode. Customer should screenshot payment confirmation.'
    }


async def generate_payment_deeplink(
    amount: float,
    order_id: str,
    merchant_id: Optional[int] = None
) -> str:
    """
    Generate Bakong app deep link for direct payment
    """
    merchant_info = await get_merchant_account_info(merchant_id) if merchant_id else {
        'account_id': 'platform@bakong'
    }

    account = merchant_info['account_id']
    deeplink = f"bakong://pay?account={account}&amount={amount:.2f}&note=Order-{order_id}"

    return deeplink
