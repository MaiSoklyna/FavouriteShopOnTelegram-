"""GET /api/merchants and /api/merchants/{id}: owner contact details and bot tokens stay private (database faked)."""

from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from app.core.constants import Role
from app.core.dependencies import get_optional_user
from app.core.security import TokenClaims
from app.main import app
from app.routes import merchants as merchants_route

PRIVATE = ("email", "owner_name", "telegram_token", "telegram_group_id", "plan", "logo_update_history")


def merchant(id, status="active"):
    return {
        "id": id, "name": f"Shop{id}", "slug": f"shop{id}", "status": status, "phone": "012345678",
        "email": f"owner{id}@secret.example", "owner_name": "Private Owner", "telegram_token": "123:SECRET",
        "telegram_group_id": -100123, "plan": "pro", "logo_update_history": [],
    }


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def eq(self, col, v):
        return FakeQuery([r for r in self.rows if r.get(col) == v])

    def order(self, *_, **__):
        return self

    def ilike(self, *_):
        return self

    async def select(self, *_):
        return [dict(r) for r in self.rows]

    async def select_one(self, *_):
        return dict(self.rows[0]) if self.rows else None


@pytest.fixture
def client(monkeypatch):
    shops = [merchant(1), merchant(2), merchant(3, status="pending")]

    class DB:
        def from_(self, table):
            return FakeQuery(shops if table == "merchants" else [])

    @asynccontextmanager
    async def service_role():
        yield DB()

    monkeypatch.setattr(merchants_route.SupabaseClient, "service_role", staticmethod(service_role))
    yield TestClient(app)
    app.dependency_overrides.clear()


def login_as(role, merchant_id=None):
    app.dependency_overrides[get_optional_user] = lambda: TokenClaims(sub="1", role=role, merchant_id=merchant_id)


def assert_public(shop):
    assert not any(k in shop for k in PRIVATE), shop
    assert shop["phone"] == "012345678"  # the shop page's contact button


def test_visitor_list_hides_private_fields_and_inactive_shops(client):
    data = client.get("/api/merchants").json()
    assert [s["id"] for s in data] == [1, 2]
    for s in data:
        assert_public(s)
        assert "product_count" in s and "order_count" in s


def test_visitor_detail_hides_private_fields(client):
    r = client.get("/api/merchants/1")
    assert r.status_code == 200
    assert_public(r.json())


def test_visitor_cannot_open_an_inactive_shop(client):
    assert client.get("/api/merchants/3").status_code == 404


def test_customer_sees_public_view(client):
    login_as(Role.USER)
    assert_public(client.get("/api/merchants/1").json())


def test_merchant_admin_sees_only_their_own_private_fields(client):
    login_as(Role.MERCHANT_ADMIN, merchant_id=1)
    assert client.get("/api/merchants/1").json()["telegram_token"] == "123:SECRET"
    assert_public(client.get("/api/merchants/2").json())
    by_id = {s["id"]: s for s in client.get("/api/merchants").json()}
    assert by_id[1]["email"] == "owner1@secret.example"
    assert_public(by_id[2])


def test_super_admin_sees_everything(client):
    login_as(Role.SUPER_ADMIN)
    data = client.get("/api/merchants").json()
    assert {s["id"] for s in data} == {1, 2, 3}
    assert all(s["telegram_token"] == "123:SECRET" for s in data)
    assert client.get("/api/merchants/3").json()["email"] == "owner3@secret.example"
