"""Product attribute templates, product details and the filtered search (database faked).

Covers the five field types, recommended/optional completeness, templates limited to the shop's type,
switching templates, the activity log, the product page's Details rows, and the search: price, stock,
sort, text (also brand and option labels), detail filters (any-of within a field, all-of across fields,
number ranges, Yes-only booleans, missing values never match) and facet counts.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core import dependencies
from app.core.exceptions import BadRequestError
from app.db.client import SupabaseClient
from app.main import app
from app.services import attributes as attrs
from tests.test_merchant_staff import OWNER, STAFF, SUPER, FakeDb, Q


def opts(*labels):
    import re
    return [{"value": re.sub(r"[^a-z0-9]+", "_", l.lower()).strip("_"), "label": l} for l in labels]


def field(id, template_id, key, label, type, *, unit=None, options=(), filterable=False, importance="optional", sort=0, **kw):
    return {"id": id, "template_id": template_id, "key": key, "label": label, "label_kh": None, "type": type, "unit": unit,
            "options": list(options), "filterable": filterable, "importance": importance, "required": False,
            "help_text": None, "min_value": None, "max_value": None, "sort_order": sort, "is_active": True, **kw}


TEMPLATES = [
    {"id": 1, "key": "beauty_skincare", "shop_category_id": 4, "shop_subcategory_ids": [11], "name": "Skincare", "name_kh": None, "sort_order": 10, "is_active": True},
    {"id": 2, "key": "beauty_cosmetics", "shop_category_id": 4, "shop_subcategory_ids": [10], "name": "Cosmetics", "name_kh": None, "sort_order": 20, "is_active": True},
    {"id": 3, "key": "food_cakes", "shop_category_id": 1, "shop_subcategory_ids": [1], "name": "Cakes & Bakery", "name_kh": None, "sort_order": 10, "is_active": True},
    {"id": 4, "key": "old", "shop_category_id": 4, "shop_subcategory_ids": [], "name": "Retired", "name_kh": None, "sort_order": 99, "is_active": False},
]
FIELDS = [
    field(1, 1, "brand", "Brand", "text", filterable=True, importance="recommended", sort=10),
    field(2, 1, "product_type", "Product type", "select", options=opts("Cleanser", "Toner", "Serum / Ampoule"), filterable=True, importance="recommended", sort=20),
    field(3, 1, "skin_type", "Skin type", "multi_select", options=opts("All", "Oily", "Dry", "Sensitive"), filterable=True, importance="recommended", sort=30),
    field(4, 1, "volume_ml", "Volume", "number", unit="ml", sort=40),
    field(5, 1, "spf", "SPF", "number", filterable=True, sort=50),
    field(6, 1, "fragrance_free", "Fragrance-free", "boolean", filterable=True, sort=60),
    field(7, 2, "brand", "Brand", "text", filterable=True, importance="recommended", sort=10),
    field(8, 2, "finish", "Finish", "select", options=opts("Matte", "Dewy"), filterable=True, importance="recommended", sort=20),
    field(9, 3, "serves", "Serves", "number", unit="people", filterable=True, importance="recommended", sort=10),
]


def prod(id, merchant_id, name, price, stock=5, template=None, values=None, created="2026-11-01", **kw):
    return {"id": id, "merchant_id": merchant_id, "category_id": None, "name": name, "description": "", "base_price": price,
            "compare_price": None, "stock": stock, "sku": None, "icon_emoji": None, "rating_avg": kw.pop("rating", 0),
            "review_count": kw.pop("reviews", 0), "is_featured": False, "is_active": kw.pop("active", True), "primary_image": None,
            "created_at": f"{created}T00:00:00+00:00", "attribute_template_id": template, "attributes": values or {}, **kw}


class Q2(Q):
    def gt(self, c, v): return self._add("gt", c, v)

    def not_(self, c, op, v):
        return self._add("notnull", c, None)

    @staticmethod
    def _test(row, op, col, val):
        if op == "gt":
            return row.get(col) is not None and row.get(col) > val
        if op == "notnull":
            return row.get(col) is not None
        return Q._test(row, op, col, val)

    async def select(self, *cols):
        if not self.db.migrated and self.table == "products" and cols and "attributes" in cols[0]:
            raise self.db.error(400, "42703", "column products.attributes does not exist")
        return await super().select(*cols)


class AttrDb(FakeDb):
    def __init__(self, migrated=True):
        super().__init__()
        self.migrated = migrated
        self.t["merchants"] = [
            {"id": 1, "name": "Glow Shop", "status": "active", "shop_category_id": 4, "shop_subcategory_id": 11, "setup_completed_at": "2026-01-01T00:00:00Z"},
            {"id": 2, "name": "Cake Place", "status": "active", "shop_category_id": 1, "shop_subcategory_id": 1, "setup_completed_at": "2026-01-01T00:00:00Z"},
            {"id": 3, "name": "Closed Beauty", "status": "suspended", "shop_category_id": 4, "setup_completed_at": "2026-01-01T00:00:00Z"},
        ]
        self.t["shop_categories"] = [{"id": 1, "name": "Food & Beverage"}, {"id": 4, "name": "Health & Beauty"}]
        self.t[attrs.TEMPLATES] = [dict(t) for t in TEMPLATES]
        self.t[attrs.FIELDS] = [dict(f, options=list(f["options"])) for f in FIELDS]
        self.t["products"] = [
            prod(5, 1, "Centella Ampoule", 18, template=1, values={"brand": "SKIN1004", "product_type": "serum_ampoule", "skin_type": ["oily", "sensitive"], "fragrance_free": True}, created="2026-11-05", rating=4.8, reviews=10),
            prod(6, 1, "Foam Cleanser", 12, template=1, values={"brand": "CeraVe", "product_type": "cleanser", "skin_type": ["dry"], "fragrance_free": False}, created="2026-11-04"),
            prod(7, 1, "AHA BHA Toner", 15, stock=0, template=1, values={"brand": "COSRX", "product_type": "toner", "skin_type": ["oily"], "spf": 0}, created="2026-11-03", rating=4.5, reviews=3),
            prod(8, 1, "Sun Serum", 20, template=1, values={"brand": "cosrx", "product_type": "serum_ampoule", "spf": 50}, created="2026-11-02"),
            prod(9, 1, "Velvet Lip", 9, template=2, values={"brand": "Phka", "finish": "matte"}, created="2026-11-06"),
            prod(10, 1, "Plain Cream", 7, created="2026-11-01"),  # no details at all
            prod(11, 2, "Matcha Cake", 25, template=3, values={"serves": 8}, created="2026-11-07"),
            prod(12, 3, "Hidden Serum", 5, template=1, values={"brand": "SKIN1004"}),   # suspended shop
            prod(13, 1, "Old Toner", 3, active=False, template=1, values={"brand": "COSRX"}),
        ]
        self.t["product_images"] = []
        self.t["product_variants"] = []
        self.t["categories"] = []

    def error(self, status, code, msg):
        req = httpx.Request("GET", "http://db/x")
        return httpx.HTTPStatusError(msg, request=req, response=httpx.Response(status, json={"code": code, "message": msg}, request=req))

    def check(self, table, write=False):
        if not self.migrated and table in (attrs.TEMPLATES, attrs.FIELDS):
            raise self.error(404, "PGRST205", f"Could not find the table 'public.{table}'")
        super().check(table, write)

    def from_(self, table):
        return Q2(self, table)


@pytest.fixture
def db(monkeypatch):
    fake = AttrDb()

    @asynccontextmanager
    async def service_role():
        yield fake

    monkeypatch.setattr(SupabaseClient, "service_role", staticmethod(service_role))
    dependencies._staff_checks.clear()
    yield fake


@pytest.fixture
def client(db):
    return TestClient(app)


SKINCARE = {**TEMPLATES[0], "fields": [f for f in FIELDS if f["template_id"] == 1]}


# ── Field types and completeness ────────────────────────────────


def test_values_are_checked_and_normalised():
    out = attrs.validate(SKINCARE, {"brand": "  COSRX   Korea ", "volume_ml": "150", "spf": 50.0,
                                    "skin_type": ["sensitive", "oily", "oily"], "fragrance_free": "yes", "product_type": "toner",
                                    "concern": None})  # empty values are dropped, even for unknown-looking None
    assert out == {"brand": "COSRX Korea", "volume_ml": 150, "spf": 50, "skin_type": ["oily", "sensitive"],
                   "fragrance_free": True, "product_type": "toner"}


@pytest.mark.parametrize("values,reason", [
    ({"volume_ml": "lots"}, "Volume must be a number"),
    ({"volume_ml": -5}, "cannot be negative"),
    ({"volume_ml": True}, "must be a number"),
    ({"product_type": "lotion"}, "not one of the options"),
    ({"skin_type": ["oily", "greasy"]}, "'greasy' is not one of the options"),
    ({"fragrance_free": "maybe"}, "yes or no"),
    ({"brand": "x" * 121}, "longer than 120"),
    ({"colour": "red"}, "'colour' is not a detail of Skincare"),
])
def test_bad_values_are_refused_with_the_reason(values, reason):
    with pytest.raises(BadRequestError) as e:
        attrs.validate(SKINCARE, values)
    assert reason in str(e.value.detail)


def test_completeness_counts_recommended_double():
    # 3 recommended (brand, product_type, skin_type) x2 + 3 optional = 9 points
    c = attrs.completeness(SKINCARE, {"brand": "COSRX", "skin_type": ["oily"], "spf": 30})
    assert c == {"recommended_filled": 2, "recommended_total": 3, "optional_filled": 1, "optional_total": 3, "score": 56}
    assert attrs.completeness(SKINCARE, {})["score"] == 0
    assert attrs.completeness(None, {"brand": "x"})["score"] == 0


def test_switching_template_keeps_shared_details():
    cosmetics = {**TEMPLATES[1], "fields": [f for f in FIELDS if f["template_id"] == 2]}
    assert attrs.carry_over(cosmetics, {"brand": "Phka", "skin_type": ["oily"], "spf": 30}) == {"brand": "Phka"}


def test_details_rows_follow_the_template_order():
    rows = attrs.details(SKINCARE, {"fragrance_free": False, "volume_ml": 100, "skin_type": ["oily", "dry"], "brand": "COSRX"})
    assert [(r["label"], r["value"]) for r in rows] == [
        ("Brand", "COSRX"), ("Skin type", "Oily, Dry"), ("Volume", "100 ml"), ("Fragrance-free", "No")]


# ── Templates for a shop ────────────────────────────────────────


def test_shop_gets_its_type_templates_and_a_suggestion(client):
    r = client.get("/api/attribute-templates/for-shop", headers=STAFF)  # staff of shop 1 (Health & Beauty, Skincare subtype)
    assert r.status_code == 200
    body = r.json()
    assert [t["name"] for t in body["data"]] == ["Skincare", "Cosmetics"]  # the retired one is not offered
    assert body["suggested_id"] == 1
    assert [f["key"] for f in body["data"][0]["fields"]] == ["brand", "product_type", "skin_type", "volume_ml", "spf", "fragrance_free"]


# ── Products with details ───────────────────────────────────────


def test_staff_create_a_product_with_details_and_it_is_logged(client, db):
    r = client.post("/api/products", headers=STAFF, json={
        "name": "Snail Essence", "base_price": 16, "stock": 4, "attribute_template_id": 1,
        "attributes": {"brand": " COSRX ", "skin_type": ["dry", "all"], "volume_ml": "100", "spf": ""}})
    assert r.status_code == 200, r.text
    p = db.t["products"][-1]
    assert p["attribute_template_id"] == 1 and p["attributes"] == {"brand": "COSRX", "skin_type": ["all", "dry"], "volume_ml": 100}
    e = db.log("product.created")[0]
    assert e["new_value"]["Details template"] == "Skincare"
    assert e["new_value"]["Detail: Skin type"] == "All, Dry"


@pytest.mark.parametrize("payload,text", [
    ({"attribute_template_id": 3}, "for another type of shop"),
    ({"attribute_template_id": 4}, "no longer offered"),
    ({"attribute_template_id": 999}, "does not exist"),
    ({"attributes": {"brand": "X"}}, "Choose what kind of product"),
    ({"attribute_template_id": 1, "attributes": {"skin_type": "shiny"}}, "not one of the options"),
])
def test_wrong_templates_or_values_are_refused(client, db, payload, text):
    before = len(db.t["products"])
    r = client.post("/api/products", headers=OWNER, json={"name": "X", "base_price": 1, **payload})
    assert r.status_code == 400 and text in r.text
    assert len(db.t["products"]) == before


def test_editing_details_logs_each_changed_field(client, db):
    r = client.patch("/api/products/6", headers=STAFF, json={"attributes": {"brand": "CeraVe", "product_type": "cleanser",
                                                                           "skin_type": ["dry", "sensitive"], "volume_ml": 236}})
    assert r.status_code == 200, r.text
    p = next(x for x in db.t["products"] if x["id"] == 6)
    assert p["attributes"] == {"brand": "CeraVe", "product_type": "cleanser", "skin_type": ["dry", "sensitive"], "volume_ml": 236}
    e = db.log("product.updated")[-1]
    assert e["old_value"] == {"Detail: Skin type": "Dry", "Detail: Volume": None, "Detail: Fragrance-free": "No"}
    assert e["new_value"] == {"Detail: Skin type": "Dry, Sensitive", "Detail: Volume": "236 ml", "Detail: Fragrance-free": None}


def test_switching_template_carries_shared_values_and_clearing_removes_them(client, db):
    client.patch("/api/products/5", headers=OWNER, json={"attribute_template_id": 2})
    p = next(x for x in db.t["products"] if x["id"] == 5)
    assert p["attribute_template_id"] == 2 and p["attributes"] == {"brand": "SKIN1004"}
    assert db.log("product.updated")[-1]["new_value"]["Details template"] == "Cosmetics"
    client.patch("/api/products/5", headers=OWNER, json={"attribute_template_id": 0})
    assert p["attribute_template_id"] is None and p["attributes"] == {}


def test_other_edits_leave_details_alone(client, db):
    client.patch("/api/products/5", headers=STAFF, json={"stock": 3})
    p = next(x for x in db.t["products"] if x["id"] == 5)
    assert p["attributes"]["brand"] == "SKIN1004" and p["attribute_template_id"] == 1


def test_product_page_shows_details(client):
    body = client.get("/api/products/5").json()
    assert body["attribute_template"] == {"id": 1, "name": "Skincare"}
    assert [r["label"] for r in body["attribute_details"]] == ["Brand", "Product type", "Skin type", "Fragrance-free"]
    assert body["attribute_details"][1]["value"] == "Serum / Ampoule"


# ── Search ──────────────────────────────────────────────────────


def ids(r):
    assert r.status_code == 200, r.text
    return [p["id"] for p in r.json()["data"]]


def test_search_basics_price_stock_sort(client):
    assert ids(client.get("/api/search/products")) == [11, 9, 5, 6, 7, 8, 10]  # newest first; no hidden shop or product
    assert ids(client.get("/api/search/products?min_price=10&max_price=18&sort=price_asc")) == [6, 7, 5]
    assert ids(client.get("/api/search/products?sort=price_desc&in_stock=true&shop_type=4")) == [8, 5, 6, 9, 10]
    assert ids(client.get("/api/search/products?sort=rating&shop_type=4"))[:2] == [5, 7]
    assert client.get("/api/search/products?min_price=9&max_price=2").status_code == 400
    assert client.get("/api/search/products?sort=cheapest").status_code == 400


def test_text_search_reads_names_brands_and_option_labels(client):
    assert ids(client.get("/api/search/products?q=toner")) == [7]                 # name
    assert ids(client.get("/api/search/products?q=cosrx")) == [7, 8]              # brand, any spelling
    assert ids(client.get("/api/search/products?q=ampoule")) == [5, 8]            # name first, then option label
    assert ids(client.get("/api/search/products?q=zzz")) == []


def test_detail_filters(client):
    base = "/api/search/products?shop_type=4"
    assert ids(client.get(f"{base}&a.skin_type=oily")) == [5, 7]                       # multi: contains
    assert ids(client.get(f"{base}&a.skin_type=oily,dry")) == [5, 6, 7]                # any of within a field
    assert ids(client.get(f"{base}&a.skin_type=oily&a.product_type=toner")) == [7]     # all of across fields
    assert ids(client.get(f"{base}&a.brand=COSRX")) == [7, 8]                          # brand ignores case
    assert ids(client.get(f"{base}&a.spf.min=30")) == [8]                              # number range
    assert ids(client.get(f"{base}&a.spf.max=10")) == [7]                              # 0 counts, missing does not
    assert ids(client.get(f"{base}&a.fragrance_free=true")) == [5]                     # only Yes; "No" and unknown excluded
    assert client.get(f"{base}&a.serves=8").status_code == 400                         # not a field of this shop type


def test_facets_count_within_the_other_filters(client):
    body = client.get("/api/search/products?shop_type=4&a.skin_type=oily").json()
    facets = {f["key"]: f for f in body["facets"]}
    # skin type counts ignore its own filter, so the other choices stay visible
    assert {o["value"]: o["count"] for o in facets["skin_type"]["options"]} == {"oily": 2, "dry": 1, "sensitive": 1}
    assert [o["selected"] for o in facets["skin_type"]["options"]] == [True, False, False]
    # brand counts respect the skin-type filter; brands merged across Skincare and Cosmetics, case-folded
    assert {o["label"]: o["count"] for o in facets["brand"]["options"]} == {"SKIN1004": 1, "COSRX": 1}
    assert (facets["spf"]["min"], facets["spf"]["max"]) == (0, 0)
    assert facets["fragrance_free"]["count"] == 1
    assert "finish" not in facets  # no oily-skin product has a finish
    assert body["total"] == 2 and body["shop_type"] == 4


def test_no_detail_filters_without_a_shop_type(client):
    body = client.get("/api/search/products?a.skin_type=oily").json()
    assert body["facets"] == [] and body["total"] == 7  # ignored: no shop type to read it against
    shop = client.get("/api/search/products?merchant_id=1&a.finish=matte").json()  # the shop's own type counts
    assert [p["id"] for p in shop["data"]] == [9] and shop["shop_type"] == 4


def test_paging(client):
    first = client.get("/api/search/products?shop_type=4&page_size=2").json()
    assert first["total"] == 6 and first["has_more"] and len(first["data"]) == 2
    last = client.get("/api/search/products?shop_type=4&page_size=2&page=3").json()
    assert not last["has_more"] and len(last["data"]) == 2


# ── Platform management ─────────────────────────────────────────


def test_super_admin_adds_and_edits_fields(client, db):
    r = client.post("/api/attribute-templates/admin/1/fields", headers=SUPER,
                    json={"key": "concern", "label": "Concern", "type": "multi_select", "options": ["Acne", "Dark spots", "Acne"],
                          "filterable": True, "importance": "recommended", "sort_order": 35})
    assert r.status_code == 200, r.text
    assert db.t[attrs.FIELDS][-1]["options"] == [{"value": "acne", "label": "Acne"}, {"value": "dark_spots", "label": "Dark spots"}]
    fid = db.t[attrs.FIELDS][-1]["id"]
    assert client.patch(f"/api/attribute-templates/admin/fields/{fid}", headers=SUPER, json={"add_options": ["Pores", "acne"]}).status_code == 200
    assert [o["value"] for o in db.t[attrs.FIELDS][-1]["options"]] == ["acne", "dark_spots", "pores"]
    all_ = client.get("/api/attribute-templates/admin/all", headers=SUPER).json()["data"]
    assert {t["name"]: t["product_count"] for t in all_}["Skincare"] == 6


def test_brand_gets_recommended_values_and_any_brand_still_saves(client, db):
    # Text fields (Brand) can carry recommended values for the product form; they are not a closed list
    r = client.patch("/api/attribute-templates/admin/fields/1", headers=SUPER, json={"add_options": ["COSRX", "Beauty of Joseon", "cosrx"]})
    assert r.status_code == 200, r.text
    brand = next(f for f in db.t[attrs.FIELDS] if f["id"] == 1)
    assert [o["label"] for o in brand["options"]] == ["COSRX", "Beauty of Joseon"]
    assert attrs.clean_value(brand, "My Local Brand") == "My Local Brand"


@pytest.mark.parametrize("body,text", [
    ({"key": "brand", "label": "Brand", "type": "text"}, "already exists"),
    ({"key": "notes", "label": "Notes", "type": "text", "filterable": True}, "Only Brand"),
    ({"key": "tone", "label": "Tone", "type": "select", "options": ["Warm"]}, "at least 2 options"),
])
def test_field_rules(client, body, text):
    r = client.post("/api/attribute-templates/admin/1/fields", headers=SUPER, json=body)
    assert r.status_code == 400 and text in r.text


def test_shops_cannot_change_templates(client):
    assert client.post("/api/attribute-templates/admin/1/fields", headers=OWNER, json={"key": "x", "label": "X", "type": "text"}).status_code == 403
    assert client.patch("/api/attribute-templates/admin/1", headers=STAFF, json={"is_active": False}).status_code == 403


# ── Before migration 036 ────────────────────────────────────────


def test_everything_keeps_working_before_the_migration(client, db):
    db.migrated = False
    for p in db.t["products"]:
        p.pop("attributes", None), p.pop("attribute_template_id", None)
    assert client.get("/api/attribute-templates").json() == {"data": []}
    assert client.get("/api/products?merchant_id=1").status_code == 200
    assert ids(client.get("/api/search/products?shop_type=4&sort=price_asc"))[:2] == [10, 9]
    assert client.get("/api/products/5").json()["attribute_details"] == []
    r = client.post("/api/products", headers=OWNER, json={"name": "X", "base_price": 1, "attribute_template_id": 1})
    assert r.status_code == 400 and "036" in r.text
    assert client.post("/api/products", headers=OWNER, json={"name": "Plain", "base_price": 1}).status_code == 200
