"""Catalog API — e-commerce playground (mfe-vite + antenna-vite)."""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/api/catalog", tags=["Catalog"])

_DATA_PATH = Path(__file__).parent.parent / "data" / "catalog.json"
_DATA: dict = json.loads(_DATA_PATH.read_text())
_BY_ID: dict[int, dict] = {p["id"]: p for p in _DATA["products"]}


# ── Models ──────────────────────────────────────────────


class Category(BaseModel):
    id: str
    name: str
    icon: str


class Product(BaseModel):
    id: int
    name: str
    category: str
    price_cents: int
    image_emoji: str
    in_stock: bool
    rating: float
    review_count: int
    summary: str


class ProductListResponse(BaseModel):
    products: list[Product]
    total: int


# ── Routes ──────────────────────────────────────────────


@router.get("/products", response_model=ProductListResponse)
def list_products(
    category: str | None = Query(None, description="Filter by category id"),
    search: str | None = Query(None, description="Substring match on name or summary"),
    sort_by: str = Query("name", description="name | price_cents | rating | review_count"),
    sort_desc: bool = Query(False),
    in_stock_only: bool = Query(False),
):
    result = list(_DATA["products"])
    if category:
        result = [p for p in result if p["category"] == category]
    if search:
        q = search.lower()
        result = [p for p in result if q in p["name"].lower() or q in p["summary"].lower()]
    if in_stock_only:
        result = [p for p in result if p["in_stock"]]

    valid_sorts = {"name", "price_cents", "rating", "review_count"}
    if sort_by not in valid_sorts:
        sort_by = "name"
    result.sort(key=lambda p: p.get(sort_by) or 0, reverse=sort_desc)

    return ProductListResponse(products=[Product(**p) for p in result], total=len(result))


@router.get("/products/{product_id}", response_model=Product)
def get_product(product_id: int):
    if product_id not in _BY_ID:
        raise HTTPException(status_code=404, detail="Product not found")
    return Product(**_BY_ID[product_id])


@router.get("/categories", response_model=list[Category])
def list_categories():
    return _DATA["categories"]
