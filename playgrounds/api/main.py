"""Annotask Playgrounds API — themed domains for each playground."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import marketing, countries, dashboard, catalog

app = FastAPI(
    title="Annotask Playgrounds API",
    description=(
        "Themed backend for the annotask playgrounds. Each domain backs a different "
        "kind of site: marketing (React), countries (Svelte), dashboard (Vue), catalog (MFE/Antenna)."
    ),
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(marketing.router)
app.include_router(countries.router)
app.include_router(dashboard.router)
app.include_router(catalog.router)
