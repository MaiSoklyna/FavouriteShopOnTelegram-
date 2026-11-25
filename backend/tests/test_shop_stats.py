"""The shops list carries each shop's counts and product-review average, so shop cards need no
extra per-shop requests."""

from app.routes.merchants import shop_stats

PRODUCTS = [
    {"merchant_id": 1, "rating_avg": 5, "review_count": 3},
    {"merchant_id": 1, "rating_avg": 3, "review_count": 1},
    {"merchant_id": 1, "rating_avg": None, "review_count": 0},
    {"merchant_id": 2, "rating_avg": 4, "review_count": 2},
]
ORDERS = [{"merchant_id": 1}, {"merchant_id": 1}, {"merchant_id": 2}]


def test_counts_and_review_weighted_average():
    assert shop_stats(1, PRODUCTS, ORDERS) == {
        "product_count": 3, "order_count": 2, "product_rating": 4.5, "product_review_count": 4,
    }


def test_shop_without_reviews_or_products():
    assert shop_stats(9, PRODUCTS, ORDERS) == {
        "product_count": 0, "order_count": 0, "product_rating": None, "product_review_count": 0,
    }
