"""Solar System API — planets, moons, and the Sun (vue-vite)."""

import json
from enum import Enum
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/solar", tags=["Solar System"])

_DATA_PATH = Path(__file__).parent.parent / "data" / "solar.json"
_DATA: dict = json.loads(_DATA_PATH.read_text())


# ── Models ──────────────────────────────────────────────


class PlanetType(str, Enum):
    terrestrial = "Terrestrial"
    gas_giant = "Gas Giant"
    ice_giant = "Ice Giant"


class Planet(BaseModel):
    id: int
    name: str
    type: PlanetType
    radius_km: float
    gravity_ms2: float
    avg_temp_c: float
    moons: int
    distance_from_sun_mkm: float
    orbital_period_days: int
    day_length_hours: float = Field(description="Length of a solar day in Earth hours")
    discovered_by: str | None
    description: str
    color: str


class PlanetListResponse(BaseModel):
    planets: list[Planet]
    total: int


class Moon(BaseModel):
    id: int
    name: str
    planet: str
    radius_km: float
    distance_km: float
    orbital_period_days: float
    discovered_by: str | None
    year_discovered: int | None
    description: str
    color: str


class MoonListResponse(BaseModel):
    moons: list[Moon]
    total: int


class SunComposition(BaseModel):
    hydrogen_pct: float
    helium_pct: float
    other_pct: float


class SunLayer(BaseModel):
    name: str
    depth: str
    temp: str
    color: str


class Sun(BaseModel):
    type: str
    age_years: int
    radius_km: float
    surface_temp_c: float
    core_temp_c: float
    mass_kg: float
    luminosity_w: float
    composition: SunComposition
    layers: list[SunLayer]


class StatsResponse(BaseModel):
    total_planets: int
    total_moons: int
    largest_planet: str
    smallest_planet: str
    hottest_planet: str
    coldest_planet: str
    planet_with_most_moons: str


# ── Planets ─────────────────────────────────────────────


@router.get("/planets", response_model=PlanetListResponse)
def list_planets(
    type: PlanetType | None = Query(None, description="Filter by planet type"),
    search: str | None = Query(None, description="Substring match on name"),
    sort_by: str = Query("distance_from_sun_mkm", description="Field to sort by"),
    sort_desc: bool = Query(False, description="Sort descending"),
):
    """List all planets with optional filtering and sorting."""
    result = list(_DATA["planets"])
    if type:
        result = [p for p in result if p["type"] == type.value]
    if search:
        q = search.lower()
        result = [p for p in result if q in p["name"].lower()]

    valid_sorts = {
        "name", "radius_km", "gravity_ms2", "avg_temp_c",
        "moons", "distance_from_sun_mkm", "orbital_period_days",
    }
    key = sort_by if sort_by in valid_sorts else "distance_from_sun_mkm"
    result.sort(key=lambda p: p.get(key) or 0, reverse=sort_desc)

    return PlanetListResponse(
        planets=[Planet(**p) for p in result], total=len(result)
    )


@router.get("/planets/{planet_id}", response_model=Planet)
def get_planet(planet_id: int):
    """Get a single planet by ID."""
    for p in _DATA["planets"]:
        if p["id"] == planet_id:
            return Planet(**p)
    raise HTTPException(status_code=404, detail="Planet not found")


# ── Moons ───────────────────────────────────────────────


@router.get("/moons", response_model=MoonListResponse)
def list_moons(
    planet: str | None = Query(None, description="Filter by parent planet name"),
    search: str | None = Query(None, description="Substring match on name"),
):
    """List all moons with optional filtering."""
    result = list(_DATA["moons"])
    if planet:
        result = [m for m in result if m["planet"].lower() == planet.lower()]
    if search:
        q = search.lower()
        result = [m for m in result if q in m["name"].lower()]
    return MoonListResponse(moons=[Moon(**m) for m in result], total=len(result))


@router.get("/moons/{moon_id}", response_model=Moon)
def get_moon(moon_id: int):
    """Get a single moon by ID."""
    for m in _DATA["moons"]:
        if m["id"] == moon_id:
            return Moon(**m)
    raise HTTPException(status_code=404, detail="Moon not found")


# ── Sun ─────────────────────────────────────────────────


@router.get("/sun", response_model=Sun)
def get_sun():
    """Get facts about the Sun."""
    return Sun(**_DATA["sun"])


# ── Stats ───────────────────────────────────────────────


@router.get("/stats", response_model=StatsResponse)
def get_stats():
    """Aggregate stats about the Solar System."""
    planets = _DATA["planets"]
    return StatsResponse(
        total_planets=len(planets),
        total_moons=sum(p["moons"] for p in planets),
        largest_planet=max(planets, key=lambda p: p["radius_km"])["name"],
        smallest_planet=min(planets, key=lambda p: p["radius_km"])["name"],
        hottest_planet=max(planets, key=lambda p: p["avg_temp_c"])["name"],
        coldest_planet=min(planets, key=lambda p: p["avg_temp_c"])["name"],
        planet_with_most_moons=max(planets, key=lambda p: p["moons"])["name"],
    )
