import asyncio, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv; load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

async def main():
    from app.services.rest import RestClient
    c = RestClient(service_role=True)
    orders = await c.get("orders?select=id,status,user_id,total&order=id")
    for o in orders:
        print(f"  Order #{o['id']}: status={o['status']}, user={o['user_id']}, total=${o['total']}")

    # Check if items have product_id
    items = await c.get("order_items?select=id,order_id,product_id,product_name&limit=20")
    print("\nOrder items (first 20):")
    for it in items:
        print(f"  Item #{it['id']}: order={it['order_id']}, product_id={it.get('product_id')}, name={it['product_name']}")

asyncio.run(main())
