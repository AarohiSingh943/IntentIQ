from datetime import UTC, datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.core.config import get_settings
from app.domain.intent import MOOD_ARCS, MOOD_EXAMPLES, MOOD_LABELS, MOODS
from app.domain.taxonomy import CATEGORIES

router = APIRouter(prefix="/api", tags=["meta"])


class Health(BaseModel):
    status: str
    version: str
    environment: str
    time_utc: str
    llm: dict
    overpass_cache: dict
    stored_plans: int


class MoodInfo(BaseModel):
    key: str
    label: str
    example: str
    phases: list[str]


class Meta(BaseModel):
    version: str
    moods: list[MoodInfo]
    categories: list[dict]
    transports: list[str]
    llm: dict
    limits: dict


@router.get("/health", response_model=Health)
def health(request: Request) -> Health:
    settings = get_settings()
    model = request.app.state.intent_model
    return Health(
        status="ok",
        version=settings.version,
        environment=settings.environment,
        time_utc=datetime.now(UTC).isoformat(timespec="seconds"),
        llm={"provider": settings.llm_provider, "ready": model is not None},
        overpass_cache=request.app.state.overpass.cache.stats(),
        stored_plans=request.app.state.plans.count(),
    )


@router.get("/meta", response_model=Meta)
def meta(request: Request) -> Meta:
    settings = get_settings()
    model = request.app.state.intent_model
    return Meta(
        version=settings.version,
        moods=[
            MoodInfo(key=m, label=MOOD_LABELS[m], example=MOOD_EXAMPLES[m], phases=[p.label for p in MOOD_ARCS[m]])
            for m in MOODS
        ],
        categories=[{"key": c.key, "label": c.label, "dwell_min": c.dwell_min, "indoor": c.indoor} for c in CATEGORIES.values()],
        transports=["walk", "bike", "drive"],
        llm={"provider": settings.llm_provider, "ready": model is not None},
        limits={"plans_per_minute": settings.rate_limit_per_minute, "max_alternatives": settings.max_alternatives},
    )
