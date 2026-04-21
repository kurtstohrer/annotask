"""Stress-lab FastAPI service — Vue data-lab backend.

Exercises FastAPI's automatic OpenAPI generation. Every route is fully typed
via pydantic, so /openapi.json at runtime produces an accurate schema that
annotask can consume without extra configuration.
"""

from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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


WorkflowStatus = Literal["pending", "in_progress", "review", "accepted", "denied"]


class Health(BaseModel):
    status: Literal["ok", "degraded", "down"]
    service: str
    port: int
    version: str


class Workflow(BaseModel):
    id: str
    title: str
    status: WorkflowStatus
    owner: str
    created_at: str


class WorkflowTransition(BaseModel):
    id: str
    title: str
    status: WorkflowStatus
    owner: str
    created_at: str
    transition_id: str
    transitioned_at: str


# Mirrors packages/shared-fixtures/index.ts so every MFE sees the same shape
# regardless of which backend it's talking to.
WORKFLOWS: dict[str, Workflow] = {
    wf.id: wf
    for wf in [
        Workflow(id="wf-1", title="New lease request",      status="pending",     owner="amir",  created_at="2026-04-18T09:12:00Z"),
        Workflow(id="wf-2", title="Invoice adjustment",     status="review",      owner="priya", created_at="2026-04-18T10:04:00Z"),
        Workflow(id="wf-3", title="Access revocation",      status="pending",     owner="dana",  created_at="2026-04-18T10:22:00Z"),
        Workflow(id="wf-4", title="Vendor onboarding",      status="in_progress", owner="jin",   created_at="2026-04-18T11:48:00Z"),
        Workflow(id="wf-5", title="Quarterly audit",        status="accepted",    owner="amir",  created_at="2026-04-17T14:00:00Z"),
        Workflow(id="wf-6", title="Data retention sweep",   status="denied",      owner="priya", created_at="2026-04-17T16:10:00Z"),
    ]
}


@app.get("/api/health", response_model=Health, tags=["health"])
def health() -> Health:
    return Health(status="ok", service="fastapi", port=4320, version="0.0.1")


@app.get("/api/workflows", response_model=list[Workflow], tags=["workflows"])
def list_workflows(status: Optional[WorkflowStatus] = None) -> list[Workflow]:
    items = list(WORKFLOWS.values())
    if status is not None:
        items = [w for w in items if w.status == status]
    return items


@app.get("/api/workflows/{workflow_id}", response_model=Workflow, tags=["workflows"])
def get_workflow(workflow_id: str) -> Workflow:
    wf = WORKFLOWS.get(workflow_id)
    if wf is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return wf


@app.post("/api/workflows/{workflow_id}/transitions", response_model=WorkflowTransition, tags=["workflows"])
def transition_workflow(workflow_id: str, to: WorkflowStatus) -> WorkflowTransition:
    wf = WORKFLOWS.get(workflow_id)
    if wf is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    updated = Workflow(**{**wf.model_dump(), "status": to})
    WORKFLOWS[workflow_id] = updated
    return WorkflowTransition(
        **updated.model_dump(),
        transition_id=str(uuid4()),
        transitioned_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    )
