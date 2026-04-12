"""Dashboard API — admin/analytics playground (vue-vite)."""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])

_DATA_PATH = Path(__file__).parent.parent / "data" / "dashboard.json"
_DATA: dict = json.loads(_DATA_PATH.read_text())


# ── Models ──────────────────────────────────────────────


class MetricSeries(BaseModel):
    value: float
    change_pct: float
    trend: list[float]


class MetricsResponse(BaseModel):
    active_users: MetricSeries
    mrr: MetricSeries
    error_rate: MetricSeries
    p95_latency_ms: MetricSeries


class User(BaseModel):
    id: int
    name: str
    email: str
    role: str
    status: str
    plan: str
    joined: str
    last_seen: str | None


class UserListResponse(BaseModel):
    users: list[User]
    total: int


class Order(BaseModel):
    id: str
    customer: str
    plan: str
    seats: int
    amount_usd: float
    status: str
    created: str


class OrderListResponse(BaseModel):
    orders: list[Order]
    total: int


class ActivityEntry(BaseModel):
    id: int
    ts: str
    actor: str
    action: str
    target: str


class AnalyticsBucket(BaseModel):
    day: str
    users: int
    sessions: int
    tasks: int


class AnalyticsResponse(BaseModel):
    range: str
    buckets: list[AnalyticsBucket]


# ── Routes ──────────────────────────────────────────────


@router.get("/metrics", response_model=MetricsResponse)
def get_metrics():
    return _DATA["metrics"]


@router.get("/users", response_model=UserListResponse)
def list_users(
    status: str | None = Query(None, description="active | invited | suspended"),
    plan: str | None = Query(None, description="Solo | Team | Enterprise"),
    search: str | None = None,
):
    result = list(_DATA["users"])
    if status:
        result = [u for u in result if u["status"] == status]
    if plan:
        result = [u for u in result if u["plan"] == plan]
    if search:
        q = search.lower()
        result = [u for u in result if q in u["name"].lower() or q in u["email"].lower()]
    return UserListResponse(users=[User(**u) for u in result], total=len(result))


@router.get("/orders", response_model=OrderListResponse)
def list_orders(status: str | None = None):
    result = list(_DATA["orders"])
    if status:
        result = [o for o in result if o["status"] == status]
    return OrderListResponse(orders=[Order(**o) for o in result], total=len(result))


@router.get("/activity", response_model=list[ActivityEntry])
def list_activity(limit: int = 20):
    return _DATA["activity"][:limit]


@router.get("/analytics", response_model=AnalyticsResponse)
def get_analytics(range: str = Query("7d", description="7d | 30d | 90d")):
    if range not in _DATA["analytics"]:
        raise HTTPException(status_code=400, detail="range must be one of: 7d, 30d, 90d")
    return AnalyticsResponse(range=range, buckets=_DATA["analytics"][range])
