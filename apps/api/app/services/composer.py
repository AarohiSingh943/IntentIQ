"""The planning pipeline, exposed as an event stream so clients can show real progress."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from datetime import datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator

from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.explain import Counterfactual, counterfactuals, explain_stop
from app.domain.intent import IntentSpec, Transport, _round_up, build_arc, compile_with_rules, merge_llm
from app.domain.places import HoursState, Place
from app.domain.planner import Itinerary, plan
from app.services.geocode import GeocodeClient
from app.services.llm import IntentModel, refine_safely
from app.services.overpass import OverpassClient, OverpassUnavailable
from app.services.routing import attach_routes
from app.services.weather import WeatherClient, WeatherSummary, summarise
from app.utils.cache import TTLCache

logger = get_logger("composer")


class PlanRequest(BaseModel):
    query: str = Field(min_length=3, max_length=300)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    timezone: str = "UTC"
    leave_at: datetime | None = None
    duration_min: int | None = Field(default=None, ge=30, le=720)
    transport: Transport | None = None
    pins: dict[str, str] = Field(default_factory=dict)
    exclude: list[str] = Field(default_factory=list)
    lang: str = Field(default="en", max_length=8)

    @field_validator("timezone")
    @classmethod
    def _valid_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("unknown timezone") from exc
        return value

    @field_validator("pins")
    @classmethod
    def _small_pins(cls, value: dict[str, str]) -> dict[str, str]:
        if len(value) > 8:
            raise ValueError("too many pins")
        return {k[:40]: v[:40] for k, v in value.items()}

    @field_validator("exclude")
    @classmethod
    def _small_exclude(cls, value: list[str]) -> list[str]:
        return [v[:40] for v in value[:40]]


class CandidateLite(BaseModel):
    id: str
    name: str
    lat: float
    lon: float
    category: str
    category_label: str
    state: str
    confidence: float


class PlanMeta(BaseModel):
    radius_km: float
    candidate_count: int
    from_cache: bool
    route_source: Literal["osrm", "estimate", "none"]
    llm: str | None
    compiled_ms: int
    timezone: str


class PlanResponse(BaseModel):
    plan_id: str | None = None
    intent: IntentSpec
    itinerary: Itinerary
    counterfactuals: list[Counterfactual]
    candidates: list[CandidateLite]
    weather: WeatherSummary | None = None
    start_label: str | None = None
    origin: tuple[float, float]
    meta: PlanMeta


class PlanError(Exception):
    def __init__(self, code: str, detail: str, status: int = 502):
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.status = status


Event = tuple[str, dict[str, Any]]


def _localize(value: datetime, zone: ZoneInfo) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=zone)
    return value.astimezone(zone)


class Composer:
    def __init__(self, settings: Settings, overpass: OverpassClient, model: IntentModel | None, weather: WeatherClient | None = None, geocode: GeocodeClient | None = None):
        self.settings = settings
        self.overpass = overpass
        self.model = model
        self.weather = weather
        self.geocode = geocode
        # Re-planning (new time, pins, transport) must not re-read the wish: a language model can
        # answer differently twice, and the person expects the same understanding to persist.
        self.intent_cache: TTLCache[tuple[IntentSpec, bool]] = TTLCache(ttl_seconds=1800, max_entries=512)

    async def _compile(self, query: str, now: datetime, timezone: str) -> tuple[IntentSpec, bool]:
        key = f"{timezone}|{now.strftime('%Y-%m-%d')}|{' '.join(query.lower().split())}"
        cached = self.intent_cache.get(key)
        if cached is not None:
            intent, refined = cached
            if intent.query_start_was_now and intent.start_time < now - timedelta(minutes=20):
                intent = intent.model_copy(update={"start_time": _round_up(now)})
            return intent, refined
        rules = compile_with_rules(query, now)
        refined = await refine_safely(self.model, query, now.isoformat(timespec="minutes"))
        intent = merge_llm(rules, refined, now)
        self.intent_cache.set(key, (intent, refined is not None))
        return intent, refined is not None

    async def _sky_and_place(self, request: PlanRequest, intent: IntentSpec, zone: ZoneInfo) -> tuple[WeatherSummary | None, str | None]:
        async def weather() -> WeatherSummary | None:
            if self.weather is None:
                return None
            forecast = await self.weather.forecast(request.lat, request.lon, zone)
            if forecast is None:
                return None
            return summarise(forecast, intent.start_time, intent.start_time + timedelta(minutes=intent.duration_min))

        async def label() -> str | None:
            if self.geocode is None:
                return None
            return await self.geocode.reverse(request.lat, request.lon, request.lang)

        summary, place_label = await asyncio.gather(weather(), label())
        return summary, place_label

    async def stream(self, request: PlanRequest) -> AsyncIterator[Event]:
        started = time.perf_counter()
        zone = ZoneInfo(request.timezone)
        now = datetime.now(zone)

        yield "stage", {"key": "intent", "label": "Reading your intent"}
        intent, refined = await self._compile(request.query, now, request.timezone)
        intent = self._apply_overrides(intent, request, zone)
        yield "intent", intent.model_dump(mode="json")

        yield "stage", {"key": "sky", "label": "Checking the sky"}
        weather, start_label = await self._sky_and_place(request, intent, zone)
        if weather and weather.rain_expected and "rain" not in intent.constraints:
            intent = intent.model_copy(update={"constraints": [*intent.constraints, "rain"]})
        if weather:
            yield "weather", weather.model_dump(mode="json")

        categories = list(dict.fromkeys(c for phase in intent.arc for c in phase.categories))
        yield "stage", {"key": "scan", "label": "Scanning the city", "detail": ", ".join(categories[:5])}
        try:
            candidate_set = await self.overpass.candidates(request.lat, request.lon, intent.transport, intent.duration_min, categories)
        except OverpassUnavailable as exc:
            raise PlanError("map_data_unavailable", "OpenStreetMap's query servers are busy right now. Nothing was invented in their place. Try again in a minute.") from exc
        excluded = set(request.exclude)
        places = [p for p in candidate_set.places if p.id not in excluded]
        yield "candidates", {"count": len(places), "radius_km": candidate_set.radius_km, "from_cache": candidate_set.cached}
        if not places:
            raise PlanError("nothing_nearby", f"No named places of the right kind within {candidate_set.radius_km} km. Try a wider transport mode or a different wish.", status=404)

        yield "stage", {"key": "compose", "label": "Composing the route"}
        origin = (request.lat, request.lon)
        itinerary = plan(intent, places, origin, request.pins, self.settings.max_alternatives)
        if not itinerary.stops:
            raise PlanError("nothing_open", "Places exist nearby but none are open in the window you gave. Try leaving at a different time.", status=404)

        yield "stage", {"key": "route", "label": "Drawing real streets"}
        itinerary, route_source = await attach_routes(itinerary, origin, self.settings)
        sunset = weather.sunset if weather else None
        itinerary = itinerary.model_copy(update={"stops": [s.model_copy(update={"why": explain_stop(s, intent, sunset)}) for s in itinerary.stops]})

        yield "stage", {"key": "explain", "label": "Weighing alternatives"}
        what_ifs = counterfactuals(intent, itinerary, places, origin)

        response = PlanResponse(
            intent=intent,
            itinerary=itinerary,
            counterfactuals=what_ifs,
            candidates=[self._lite(p, intent.start_time) for p in places[:400]],
            weather=weather,
            start_label=start_label,
            origin=origin,
            meta=PlanMeta(
                radius_km=candidate_set.radius_km,
                candidate_count=len(places),
                from_cache=candidate_set.cached,
                route_source=route_source,  # type: ignore[arg-type]
                llm=self.model.name if (self.model and refined) else None,
                compiled_ms=int((time.perf_counter() - started) * 1000),
                timezone=request.timezone,
            ),
        )
        yield "plan", response.model_dump(mode="json")

    async def compose(self, request: PlanRequest) -> PlanResponse:
        final: dict[str, Any] | None = None
        async for event, data in self.stream(request):
            if event == "plan":
                final = data
        assert final is not None
        return PlanResponse.model_validate(final)

    def _apply_overrides(self, intent: IntentSpec, request: PlanRequest, zone: ZoneInfo) -> IntentSpec:
        update: dict[str, Any] = {}
        if request.leave_at is not None:
            update["start_time"] = _localize(request.leave_at, zone)
        if request.duration_min is not None:
            update["duration_min"] = request.duration_min
        if request.transport is not None:
            update["transport"] = request.transport
        if not update:
            return intent
        merged = intent.model_copy(update=update)
        if "duration_min" in update:
            merged = merged.model_copy(update={"arc": build_arc(merged.mood, merged.explicit_categories, merged.duration_min)})
        return merged

    @staticmethod
    def _lite(place: Place, moment: datetime) -> CandidateLite:
        hours: HoursState = place.hours_at(moment)
        return CandidateLite(
            id=place.id,
            name=place.name,
            lat=place.lat,
            lon=place.lon,
            category=place.category,
            category_label=place.category_label,
            state=hours.state,
            confidence=place.confidence,
        )
