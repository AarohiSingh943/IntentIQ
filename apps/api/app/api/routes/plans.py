import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel

from app.services.composer import PlanResponse
from app.services.exports import plan_to_gpx, plan_to_ics
from app.storage.plans import PlanStore

router = APIRouter(prefix="/api/plans", tags=["plans"])
_ID_RE = re.compile(r"^[a-z0-9]{6,12}$")


class SavedPlan(BaseModel):
    id: str
    path: str


def _store(request: Request) -> PlanStore:
    return request.app.state.plans


def _load(request: Request, plan_id: str) -> dict:
    if not _ID_RE.match(plan_id):
        raise HTTPException(status_code=404, detail={"error": "not_found", "detail": "No plan with that link."})
    payload = _store(request).get(plan_id)
    if payload is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "detail": "No plan with that link."})
    return payload


@router.post("", response_model=SavedPlan, summary="Store a plan and get a shareable id")
def save_plan(payload: PlanResponse, request: Request) -> SavedPlan:
    body = payload.model_dump(mode="json")
    body.pop("plan_id", None)
    body["candidates"] = body.get("candidates", [])[:120]
    plan_id = _store(request).save(body)
    return SavedPlan(id=plan_id, path=f"/p/{plan_id}")


@router.get("/{plan_id}", response_model=PlanResponse, summary="Fetch a shared plan")
def get_plan(plan_id: str, request: Request) -> PlanResponse:
    payload = _load(request, plan_id)
    payload["plan_id"] = plan_id
    return PlanResponse.model_validate(payload)


@router.get("/{plan_id}/calendar.ics", summary="Download the plan as calendar events")
def get_plan_ics(plan_id: str, request: Request) -> Response:
    payload = _load(request, plan_id)
    return PlainTextResponse(
        plan_to_ics(plan_id, payload),
        media_type="text/calendar",
        headers={"content-disposition": f'attachment; filename="intentra-{plan_id}.ics"'},
    )


@router.get("/{plan_id}/route.gpx", summary="Download the route as GPX")
def get_plan_gpx(plan_id: str, request: Request) -> Response:
    payload = _load(request, plan_id)
    return Response(
        plan_to_gpx(plan_id, payload),
        media_type="application/gpx+xml",
        headers={"content-disposition": f'attachment; filename="intentra-{plan_id}.gpx"'},
    )
