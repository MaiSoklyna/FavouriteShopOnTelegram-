"""QueryBuilder.order: chained calls sort by each column in turn (a bug made the last call win, so
collections, promotions, featured categories and template fields ignored their sort_order)."""

from app.db.client import QueryBuilder


def test_chained_order_keeps_every_column():
    q = QueryBuilder(None, "t").order("sort_order").order("id", desc=True)
    assert q._order_clause == "sort_order.asc,id.desc"


def test_single_order_unchanged():
    q = QueryBuilder(None, "t").order("created_at", desc=True, nulls_last=True)
    assert q._order_clause == "created_at.desc.nullslast"
