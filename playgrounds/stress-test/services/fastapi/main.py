"""Stress-lab FastAPI service — Vue data-lab backend."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Annotask Stress Lab — FastAPI",
    description="Typed JSON + OpenAPI stress surface for the Vue data-lab MFE.",
    version="0.0.1",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "fastapi",
        "port": 4320,
        "version": "0.0.1",
    }
