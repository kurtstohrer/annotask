"""Countries API — data exploration playground (Svelte)."""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/countries", tags=["Countries"])

_DATA_PATH = Path(__file__).parent.parent / "data" / "countries.json"
_COUNTRIES: list[dict] = json.loads(_DATA_PATH.read_text())
_BY_CODE: dict[str, dict] = {c["cca2"]: c for c in _COUNTRIES}


# ── Models ──────────────────────────────────────────────


class Country(BaseModel):
    cca2: str
    cca3: str
    name: str
    official_name: str
    capital: str
    region: str
    subregion: str
    population: int
    area_km2: float
    currencies: list[str]
    languages: list[str]
    flag_emoji: str
    neighbors: list[str]
    density: float | None = Field(None, description="population / area_km2")


class CountryListResponse(BaseModel):
    countries: list[Country]
    total: int


class CompareResponse(BaseModel):
    countries: list[Country]
    fields: list[str]


def _hydrate(c: dict) -> dict:
    """Add derived fields like density."""
    out = dict(c)
    out["density"] = round(c["population"] / c["area_km2"], 2) if c["area_km2"] else None
    return out


# ── Routes ──────────────────────────────────────────────


@router.get("", response_model=CountryListResponse)
@router.get("/", response_model=CountryListResponse, include_in_schema=False)
def list_countries(
    region: str | None = Query(None, description="Filter by region"),
    subregion: str | None = Query(None, description="Filter by subregion"),
    search: str | None = Query(None, description="Substring match on name"),
    sort_by: str = Query("name", description="name | population | area_km2"),
    sort_desc: bool = Query(False),
    limit: int = Query(200, ge=1, le=500),
):
    """List countries with filters and sorting."""
    result = list(_COUNTRIES)
    if region:
        result = [c for c in result if c["region"].lower() == region.lower()]
    if subregion:
        result = [c for c in result if c["subregion"].lower() == subregion.lower()]
    if search:
        q = search.lower()
        result = [c for c in result if q in c["name"].lower()]

    valid_sorts = {"name", "population", "area_km2"}
    if sort_by not in valid_sorts:
        sort_by = "name"
    result.sort(key=lambda c: c.get(sort_by) or 0, reverse=sort_desc)
    result = result[:limit]

    return CountryListResponse(
        countries=[Country(**_hydrate(c)) for c in result],
        total=len(result),
    )


@router.get("/regions")
def list_regions():
    """Distinct regions and their subregions."""
    out: dict[str, set[str]] = {}
    for c in _COUNTRIES:
        out.setdefault(c["region"], set()).add(c["subregion"])
    return {"regions": [{"region": r, "subregions": sorted(s)} for r, s in sorted(out.items())]}


@router.get("/compare", response_model=CompareResponse)
def compare_countries(
    codes: str = Query(..., description="Comma-separated cca2 codes, max 4"),
):
    """Side-by-side comparison of up to 4 countries."""
    code_list = [c.strip().upper() for c in codes.split(",") if c.strip()]
    if not code_list:
        raise HTTPException(status_code=400, detail="codes parameter required")
    if len(code_list) > 4:
        raise HTTPException(status_code=400, detail="max 4 countries")

    countries: list[dict] = []
    for code in code_list:
        if code not in _BY_CODE:
            raise HTTPException(status_code=404, detail=f"Unknown country: {code}")
        countries.append(_hydrate(_BY_CODE[code]))

    return CompareResponse(
        countries=[Country(**c) for c in countries],
        fields=["population", "area_km2", "density", "languages", "currencies"],
    )


@router.get("/{cca2}", response_model=Country)
def get_country(cca2: str):
    """Single country by cca2 code."""
    code = cca2.upper()
    if code not in _BY_CODE:
        raise HTTPException(status_code=404, detail="Country not found")
    return Country(**_hydrate(_BY_CODE[code]))
