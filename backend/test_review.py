import asyncio, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv; load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

async def main():
    from app.services.rest import RestClient
    c = RestClient(service_role=True)

    # Check reviews table columns
    try:
        existing = await c.get("reviews?limit=1&select=*")
        if existing:
            print("Existing review columns:", list(existing[0].keys()))
        else:
            print("No existing reviews")
    except Exception as e:
        print(f"GET reviews error: {type(e).__name__}: {e}")

    # Try to insert a review
    try:
        result = await c.insert("reviews", {
            "product_id": 1,
            "user_id": 1,
            "rating": 5,
            "comment": "Test review",
            "user_name": "Test User",
        })
        print("INSERT SUCCESS:", result)
        # Clean up
        if result and isinstance(result, list):
            rid = result[0]["id"]
            await c.delete(f"reviews?id=eq.{rid}")
            print("Cleaned up test review")
    except Exception as e:
        print(f"INSERT ERROR: {type(e).__name__}: {e}")

asyncio.run(main())
