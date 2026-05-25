"""Backfill loyalty points for all past orders that haven't been counted yet."""

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

async def main():
    from app.services.loyalty import earn_points, get_settings
    from app.services.rest import RestClient

    settings = await get_settings()
    if not settings or not settings.get("is_enabled"):
        print("ERROR: Loyalty program is not enabled. Enable it in admin first.")
        return

    print(f"Loyalty settings: {settings['points_per_dollar']} pts/$, silver={settings.get('silver_threshold',500)}, gold={settings.get('gold_threshold',2000)}")

    client = RestClient(service_role=True)

    orders = await client.get("orders?status=in.(delivered,confirmed,processing,shipped)&select=id,user_id,total&order=id")
    print(f"Found {len(orders)} completed orders")

    existing_txns = await client.get("points_transactions?type=eq.earn&select=order_id")
    existing_ids = {t["order_id"] for t in existing_txns if t.get("order_id")}
    print(f"Already counted: {len(existing_ids)} orders")

    backfilled = 0
    for order in orders:
        if order["id"] in existing_ids:
            continue
        try:
            result = await earn_points(order["user_id"], order["id"], float(order["total"]))
            if result:
                print(f"  Order #{order['id']}: user={order['user_id']}, total=${order['total']} -> +{result['points_earned']} pts (tier: {result['tier']})")
                backfilled += 1
        except Exception as e:
            print(f"  Order #{order['id']}: FAILED - {e}")

    print(f"\nDone! Backfilled {backfilled} orders.")

if __name__ == "__main__":
    asyncio.run(main())
