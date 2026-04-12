"""Marketing API — annotask landing page data."""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, Field

router = APIRouter(prefix="/api/marketing", tags=["Marketing"])

_DATA_PATH = Path(__file__).parent.parent / "data" / "marketing.json"
_DATA: dict = json.loads(_DATA_PATH.read_text())

_waitlist: list[str] = []


# ── Models ──────────────────────────────────────────────


class Feature(BaseModel):
    id: int
    icon: str
    category: str = Field(description="visual | agent | framework | integration")
    title: str
    description: str


class Testimonial(BaseModel):
    id: int
    name: str
    role: str
    company: str
    avatar_url: str
    quote: str
    rating: int


class PricingTier(BaseModel):
    id: int
    name: str
    price_monthly: float | None
    billing: str
    highlighted: bool
    cta_label: str
    features: list[str]


class Integration(BaseModel):
    id: int
    name: str
    logo: str
    status: str = Field(description="stable | beta | experimental")
    category: str


class ChangelogEntry(BaseModel):
    version: str
    date: str
    headline: str
    highlights: list[str]


class MarketingStats(BaseModel):
    installs: int
    github_stars: int
    contributors: int
    frameworks_supported: int


class WaitlistRequest(BaseModel):
    email: EmailStr


class WaitlistResponse(BaseModel):
    ok: bool
    position: int


# ── Routes ──────────────────────────────────────────────


@router.get("/features", response_model=list[Feature])
def list_features(category: str | None = None):
    """All features, optionally filtered by category."""
    items = _DATA["features"]
    if category:
        items = [f for f in items if f["category"] == category]
    return items


@router.get("/testimonials", response_model=list[Testimonial])
def list_testimonials():
    return _DATA["testimonials"]


@router.get("/pricing", response_model=list[PricingTier])
def list_pricing():
    return _DATA["pricing"]


@router.get("/integrations", response_model=list[Integration])
def list_integrations(status: str | None = None):
    """All integrations, optionally filtered by status (stable|beta|experimental)."""
    items = _DATA["integrations"]
    if status:
        items = [i for i in items if i["status"] == status]
    return items


@router.get("/changelog", response_model=list[ChangelogEntry])
def list_changelog(limit: int = 10):
    return _DATA["changelog"][:limit]


@router.get("/stats", response_model=MarketingStats)
def get_stats():
    return _DATA["stats"]


@router.post("/waitlist", response_model=WaitlistResponse)
def join_waitlist(body: WaitlistRequest):
    email = body.email.lower()
    if email in _waitlist:
        raise HTTPException(status_code=409, detail="Already on the waitlist")
    _waitlist.append(email)
    return WaitlistResponse(ok=True, position=len(_waitlist))
