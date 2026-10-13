from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from app.services.geocode import GeoHit

router = APIRouter(prefix="/api/geocode", tags=["geocode"])


class SearchResponse(BaseModel):
    hits: list[GeoHit]


class ReverseResponse(BaseModel):
    label: str | None


@router.get("", response_model=SearchResponse, summary="Search anywhere in the world for a starting point")
async def search(
    request: Request,
    q: str = Query(min_length=2, max_length=120),
    lang: str = Query(default="en", max_length=8),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lon: float | None = Query(default=None, ge=-180, le=180),
) -> SearchResponse:
    near = (lat, lon) if lat is not None and lon is not None else None
    hits = await request.app.state.geocode.search(q, lang=lang, near=near)
    return SearchResponse(hits=hits)


@router.get("/reverse", response_model=ReverseResponse, summary="Name a coordinate")
async def reverse(request: Request, lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180), lang: str = Query(default="en", max_length=8)) -> ReverseResponse:
    return ReverseResponse(label=await request.app.state.geocode.reverse(lat, lon, lang))
