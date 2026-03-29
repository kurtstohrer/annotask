"""Planet Explorer API — FastAPI backend with full OpenAPI spec."""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from enum import Enum

app = FastAPI(
    title="Planet Explorer API",
    description="Solar system planet data for the Annotask playground app.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Models ──────────────────────────────────────────────


class PlanetType(str, Enum):
    terrestrial = "Terrestrial"
    gas_giant = "Gas Giant"
    ice_giant = "Ice Giant"


class Planet(BaseModel):
    id: int = Field(description="Unique planet identifier")
    name: str = Field(description="Planet name")
    type: PlanetType = Field(description="Classification of the planet")
    radius_km: float = Field(description="Mean radius in kilometers")
    gravity_ms2: float = Field(description="Surface gravity in m/s²")
    avg_temp_c: float = Field(description="Average surface temperature in °C")
    moons: int = Field(description="Number of known moons")
    distance_from_sun_mkm: float = Field(description="Mean distance from Sun in million km")
    orbital_period_days: int = Field(description="Orbital period in Earth days")
    discovered_by: str | None = Field(None, description="Who discovered this planet, if applicable")
    description: str = Field(description="Brief description of the planet")
    color: str = Field(description="Hex color for UI display")


class PlanetCreate(BaseModel):
    name: str
    type: PlanetType
    radius_km: float
    gravity_ms2: float
    avg_temp_c: float
    moons: int = 0
    distance_from_sun_mkm: float
    orbital_period_days: int
    discovered_by: str | None = None
    description: str = ""
    color: str = "#94a3b8"


class PlanetUpdate(BaseModel):
    name: str | None = None
    type: PlanetType | None = None
    radius_km: float | None = None
    gravity_ms2: float | None = None
    avg_temp_c: float | None = None
    moons: int | None = None
    distance_from_sun_mkm: float | None = None
    orbital_period_days: int | None = None
    discovered_by: str | None = None
    description: str | None = None
    color: str | None = None


class PlanetListResponse(BaseModel):
    planets: list[Planet]
    total: int


class StatsResponse(BaseModel):
    total_planets: int
    total_moons: int
    largest_planet: str
    smallest_planet: str
    hottest_planet: str
    coldest_planet: str


# ── Data ────────────────────────────────────────────────

_planets: list[dict] = [
    {
        "id": 1,
        "name": "Mercury",
        "type": "Terrestrial",
        "radius_km": 2439.7,
        "gravity_ms2": 3.7,
        "avg_temp_c": 167,
        "moons": 0,
        "distance_from_sun_mkm": 57.9,
        "orbital_period_days": 88,
        "discovered_by": None,
        "description": "The smallest planet and closest to the Sun. Has no atmosphere and extreme temperature swings.",
        "color": "#94a3b8",
    },
    {
        "id": 2,
        "name": "Venus",
        "type": "Terrestrial",
        "radius_km": 6051.8,
        "gravity_ms2": 8.87,
        "avg_temp_c": 464,
        "moons": 0,
        "distance_from_sun_mkm": 108.2,
        "orbital_period_days": 225,
        "discovered_by": None,
        "description": "The hottest planet with a thick toxic atmosphere. Rotates in the opposite direction to most planets.",
        "color": "#fbbf24",
    },
    {
        "id": 3,
        "name": "Earth",
        "type": "Terrestrial",
        "radius_km": 6371.0,
        "gravity_ms2": 9.81,
        "avg_temp_c": 15,
        "moons": 1,
        "distance_from_sun_mkm": 149.6,
        "orbital_period_days": 365,
        "discovered_by": None,
        "description": "Our home planet. The only known planet to harbor life, with liquid water on its surface.",
        "color": "#3b82f6",
    },
    {
        "id": 4,
        "name": "Mars",
        "type": "Terrestrial",
        "radius_km": 3389.5,
        "gravity_ms2": 3.72,
        "avg_temp_c": -65,
        "moons": 2,
        "distance_from_sun_mkm": 227.9,
        "orbital_period_days": 687,
        "discovered_by": None,
        "description": "The Red Planet. Has the largest volcano and canyon in the solar system.",
        "color": "#ef4444",
    },
    {
        "id": 5,
        "name": "Jupiter",
        "type": "Gas Giant",
        "radius_km": 69911.0,
        "gravity_ms2": 24.79,
        "avg_temp_c": -110,
        "moons": 95,
        "distance_from_sun_mkm": 778.6,
        "orbital_period_days": 4333,
        "discovered_by": None,
        "description": "The largest planet. Its Great Red Spot is a storm larger than Earth that has raged for centuries.",
        "color": "#f97316",
    },
    {
        "id": 6,
        "name": "Saturn",
        "type": "Gas Giant",
        "radius_km": 58232.0,
        "gravity_ms2": 10.44,
        "avg_temp_c": -140,
        "moons": 146,
        "distance_from_sun_mkm": 1433.5,
        "orbital_period_days": 10759,
        "discovered_by": None,
        "description": "Famous for its stunning ring system. Less dense than water — it would float in a giant bathtub.",
        "color": "#eab308",
    },
    {
        "id": 7,
        "name": "Uranus",
        "type": "Ice Giant",
        "radius_km": 25362.0,
        "gravity_ms2": 8.87,
        "avg_temp_c": -195,
        "moons": 28,
        "distance_from_sun_mkm": 2872.5,
        "orbital_period_days": 30687,
        "discovered_by": "William Herschel",
        "description": "Rotates on its side. An ice giant with a blue-green color from methane in its atmosphere.",
        "color": "#06b6d4",
    },
    {
        "id": 8,
        "name": "Neptune",
        "type": "Ice Giant",
        "radius_km": 24622.0,
        "gravity_ms2": 11.15,
        "avg_temp_c": -200,
        "moons": 16,
        "distance_from_sun_mkm": 4495.1,
        "orbital_period_days": 60190,
        "discovered_by": "Johann Galle",
        "description": "The windiest planet with speeds up to 2,100 km/h. Deep blue color from methane absorption.",
        "color": "#6366f1",
    },
]

_next_id = len(_planets) + 1


# ── Moon Data ──────────────────────────────────────────


class Moon(BaseModel):
    id: int = Field(description="Unique moon identifier")
    name: str = Field(description="Moon name")
    planet: str = Field(description="Parent planet name")
    radius_km: float = Field(description="Mean radius in kilometers")
    distance_km: float = Field(description="Orbital distance from planet in km")
    orbital_period_days: float = Field(description="Orbital period in Earth days")
    discovered_by: str | None = Field(None, description="Discoverer")
    year_discovered: int | None = Field(None, description="Year discovered")
    description: str = Field(description="Brief description")
    color: str = Field(description="Hex color for UI display")


class MoonListResponse(BaseModel):
    moons: list[Moon]
    total: int


_moons: list[dict] = [
    {"id": 1, "name": "Moon", "planet": "Earth", "radius_km": 1737.4, "distance_km": 384400, "orbital_period_days": 27.3, "discovered_by": None, "year_discovered": None, "description": "Earth's only natural satellite. The fifth-largest moon in the solar system.", "color": "#d1d5db"},
    {"id": 2, "name": "Phobos", "planet": "Mars", "radius_km": 11.3, "distance_km": 9376, "orbital_period_days": 0.32, "discovered_by": "Asaph Hall", "year_discovered": 1877, "description": "The larger and closer of Mars' two moons. Gradually spiraling inward.", "color": "#a8a29e"},
    {"id": 3, "name": "Deimos", "planet": "Mars", "radius_km": 6.2, "distance_km": 23458, "orbital_period_days": 1.26, "discovered_by": "Asaph Hall", "year_discovered": 1877, "description": "The smaller and outermost of Mars' two moons.", "color": "#d6d3d1"},
    {"id": 4, "name": "Io", "planet": "Jupiter", "radius_km": 1821.6, "distance_km": 421700, "orbital_period_days": 1.77, "discovered_by": "Galileo Galilei", "year_discovered": 1610, "description": "The most volcanically active body in the solar system with over 400 active volcanoes.", "color": "#facc15"},
    {"id": 5, "name": "Europa", "planet": "Jupiter", "radius_km": 1560.8, "distance_km": 671034, "orbital_period_days": 3.55, "discovered_by": "Galileo Galilei", "year_discovered": 1610, "description": "Has a subsurface ocean beneath its icy crust. A prime candidate for extraterrestrial life.", "color": "#93c5fd"},
    {"id": 6, "name": "Ganymede", "planet": "Jupiter", "radius_km": 2634.1, "distance_km": 1070412, "orbital_period_days": 7.15, "discovered_by": "Galileo Galilei", "year_discovered": 1610, "description": "The largest moon in the solar system. Larger than Mercury. Has its own magnetic field.", "color": "#a3a3a3"},
    {"id": 7, "name": "Callisto", "planet": "Jupiter", "radius_km": 2410.3, "distance_km": 1882709, "orbital_period_days": 16.69, "discovered_by": "Galileo Galilei", "year_discovered": 1610, "description": "The most heavily cratered object in the solar system. May have a subsurface ocean.", "color": "#78716c"},
    {"id": 8, "name": "Titan", "planet": "Saturn", "radius_km": 2574.7, "distance_km": 1221870, "orbital_period_days": 15.95, "discovered_by": "Christiaan Huygens", "year_discovered": 1655, "description": "The only moon with a dense atmosphere. Has lakes and rivers of liquid methane.", "color": "#f59e0b"},
    {"id": 9, "name": "Enceladus", "planet": "Saturn", "radius_km": 252.1, "distance_km": 238042, "orbital_period_days": 1.37, "discovered_by": "William Herschel", "year_discovered": 1789, "description": "Shoots geysers of water ice into space. Has a subsurface ocean and potential for life.", "color": "#e2e8f0"},
    {"id": 10, "name": "Mimas", "planet": "Saturn", "radius_km": 198.2, "distance_km": 185520, "orbital_period_days": 0.94, "discovered_by": "William Herschel", "year_discovered": 1789, "description": "Known for the giant Herschel crater that makes it resemble the Death Star.", "color": "#d4d4d8"},
    {"id": 11, "name": "Rhea", "planet": "Saturn", "radius_km": 763.8, "distance_km": 527108, "orbital_period_days": 4.52, "discovered_by": "Giovanni Cassini", "year_discovered": 1672, "description": "Saturn's second-largest moon. May have a thin ring system of its own.", "color": "#a1a1aa"},
    {"id": 12, "name": "Triton", "planet": "Neptune", "radius_km": 1353.4, "distance_km": 354759, "orbital_period_days": 5.88, "discovered_by": "William Lassell", "year_discovered": 1846, "description": "The only large moon with a retrograde orbit. Likely a captured Kuiper Belt object.", "color": "#a5b4fc"},
    {"id": 13, "name": "Miranda", "planet": "Uranus", "radius_km": 235.8, "distance_km": 129390, "orbital_period_days": 1.41, "discovered_by": "Gerard Kuiper", "year_discovered": 1948, "description": "Has one of the most extreme terrains in the solar system with 20km-high cliffs.", "color": "#cbd5e1"},
    {"id": 14, "name": "Ariel", "planet": "Uranus", "radius_km": 578.9, "distance_km": 190900, "orbital_period_days": 2.52, "discovered_by": "William Lassell", "year_discovered": 1851, "description": "The brightest and possibly youngest surface of Uranus' major moons.", "color": "#e2e8f0"},
    {"id": 15, "name": "Titania", "planet": "Uranus", "radius_km": 788.4, "distance_km": 435910, "orbital_period_days": 8.71, "discovered_by": "William Herschel", "year_discovered": 1787, "description": "The largest moon of Uranus. Has huge canyons and scarps on its surface.", "color": "#9ca3af"},
]


# ── Routes ──────────────────────────────────────────────


@app.get("/api/planets", response_model=PlanetListResponse, tags=["Planets"])
def list_planets(
    type: PlanetType | None = Query(None, description="Filter by planet type"),
    search: str | None = Query(None, description="Search by name"),
    sort_by: str = Query("distance_from_sun_mkm", description="Field to sort by"),
    sort_desc: bool = Query(False, description="Sort descending"),
):
    """List all planets with optional filtering and sorting."""
    result = list(_planets)

    if type:
        result = [p for p in result if p["type"] == type.value]
    if search:
        q = search.lower()
        result = [p for p in result if q in p["name"].lower()]

    reverse = sort_desc
    result.sort(key=lambda p: p.get(sort_by, 0) or 0, reverse=reverse)

    return PlanetListResponse(planets=[Planet(**p) for p in result], total=len(result))


@app.get("/api/planets/{planet_id}", response_model=Planet, tags=["Planets"])
def get_planet(planet_id: int):
    """Get a single planet by ID."""
    for p in _planets:
        if p["id"] == planet_id:
            return Planet(**p)
    raise HTTPException(status_code=404, detail="Planet not found")


@app.post("/api/planets", response_model=Planet, status_code=201, tags=["Planets"])
def create_planet(body: PlanetCreate):
    """Add a new planet."""
    global _next_id
    planet = {"id": _next_id, **body.model_dump()}
    _planets.append(planet)
    _next_id += 1
    return Planet(**planet)


@app.patch("/api/planets/{planet_id}", response_model=Planet, tags=["Planets"])
def update_planet(planet_id: int, body: PlanetUpdate):
    """Update an existing planet."""
    for p in _planets:
        if p["id"] == planet_id:
            updates = body.model_dump(exclude_unset=True)
            p.update(updates)
            return Planet(**p)
    raise HTTPException(status_code=404, detail="Planet not found")


@app.delete("/api/planets/{planet_id}", status_code=204, tags=["Planets"])
def delete_planet(planet_id: int):
    """Delete a planet."""
    global _planets
    before = len(_planets)
    _planets = [p for p in _planets if p["id"] != planet_id]
    if len(_planets) == before:
        raise HTTPException(status_code=404, detail="Planet not found")


@app.get("/api/moons", response_model=MoonListResponse, tags=["Moons"])
def list_moons(
    planet: str | None = Query(None, description="Filter by parent planet"),
    search: str | None = Query(None, description="Search by name"),
):
    """List all moons with optional filtering."""
    result = list(_moons)
    if planet:
        result = [m for m in result if m["planet"].lower() == planet.lower()]
    if search:
        q = search.lower()
        result = [m for m in result if q in m["name"].lower()]
    return MoonListResponse(moons=[Moon(**m) for m in result], total=len(result))


@app.get("/api/stats", response_model=StatsResponse, tags=["Stats"])
def get_stats():
    """Get aggregate statistics about the solar system."""
    if not _planets:
        raise HTTPException(status_code=404, detail="No planets")
    return StatsResponse(
        total_planets=len(_planets),
        total_moons=sum(p["moons"] for p in _planets),
        largest_planet=max(_planets, key=lambda p: p["radius_km"])["name"],
        smallest_planet=min(_planets, key=lambda p: p["radius_km"])["name"],
        hottest_planet=max(_planets, key=lambda p: p["avg_temp_c"])["name"],
        coldest_planet=min(_planets, key=lambda p: p["avg_temp_c"])["name"],
    )
