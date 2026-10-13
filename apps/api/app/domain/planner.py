"""Itinerary composition: a beam search over the intent arc, honouring opening hours,
travel time and the time budget. Deterministic for the same inputs."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from pydantic import BaseModel, Field

from app.domain.intent import IntentSpec, Phase
from app.domain.places import HoursState, Place
from app.domain.taxonomy import CATEGORIES
from app.utils.geo import haversine_km

SPEED_KMH = {"walk": 4.6, "bike": 13.0, "drive": 22.0}
DETOUR = {"walk": 1.3, "bike": 1.35, "drive": 1.45}
OVERHEAD_MIN = {"walk": 2, "bike": 3, "drive": 6}
PROXIMITY_TAU_MIN = {"walk": 16.0, "bike": 14.0, "drive": 14.0}
BEAM_WIDTH = 6
BRANCH = 7
WEIGHTS = {"fit": 0.40, "timing": 0.28, "proximity": 0.22, "confidence": 0.10}


class Leg(BaseModel):
    from_id: str | None  # None means the traveller's origin
    to_id: str
    mode: str
    minutes: int
    km: float
    source: str = "estimate"  # estimate | osrm
    geometry: list[list[float]] = Field(default_factory=list)  # [lon, lat]


class Factors(BaseModel):
    fit: float
    timing: float
    proximity: float
    confidence: float


class Stop(BaseModel):
    order: int
    phase_key: str
    phase_label: str
    place: Place
    arrive: datetime
    depart: datetime
    dwell_min: int
    leg: Leg
    score: float
    factors: Factors
    hours_at_arrival: HoursState
    why: str = ""
    notes: list[str] = Field(default_factory=list)
    alternatives: list[Place] = Field(default_factory=list)


class Gap(BaseModel):
    phase_key: str
    phase_label: str
    reason: str


class Itinerary(BaseModel):
    stops: list[Stop]
    gaps: list[Gap]
    starts_at: datetime
    ends_at: datetime
    total_min: int
    travel_min: int
    distance_km: float
    score: float


def travel_estimate(from_lat: float, from_lon: float, to_lat: float, to_lon: float, mode: str) -> tuple[int, float]:
    km = haversine_km(from_lat, from_lon, to_lat, to_lon) * DETOUR[mode]
    minutes = km / SPEED_KMH[mode] * 60 + OVERHEAD_MIN[mode]
    return int(round(minutes)), round(km, 2)


def constraint_bonus(place: Place, constraints: list[str], budget: str | None) -> float:
    tags = place.tags
    bonus = 0.0
    cat = CATEGORIES[place.category]
    if "quiet" in constraints:
        bonus += 0.15 if "quiet" in cat.tags or place.category in ("park", "library", "bookshop", "museum") else 0.0
        bonus -= 0.35 if place.category in ("bar", "nightclub", "arcade") else 0.0
    if "outdoor" in constraints:
        bonus += 0.18 if not cat.indoor or tags.get("outdoor_seating") == "yes" else 0.0
    if "rain" in constraints:
        bonus += 0.15 if cat.indoor else -0.3
    if "wifi" in constraints:
        bonus += 0.18 if tags.get("internet_access") in ("wlan", "yes") or "wifi" in cat.tags else 0.0
    if "vegetarian" in constraints:
        bonus += 0.2 if tags.get("diet:vegetarian") in ("yes", "only") or "vegetarian" in tags.get("cuisine", "") else 0.0
    if "vegan" in constraints:
        bonus += 0.22 if tags.get("diet:vegan") in ("yes", "only") or "vegan" in tags.get("cuisine", "") else 0.0
    if "wheelchair" in constraints:
        w = tags.get("wheelchair")
        bonus += 0.2 if w == "yes" else (-0.5 if w == "no" else -0.1)
    if "live_music" in constraints:
        bonus += 0.2 if tags.get("live_music") == "yes" else 0.0
    if "coffee" in constraints and place.category == "cafe":
        bonus += 0.08
    if budget == "low" and place.category in ("fast_food", "park", "market", "food_court", "library", "viewpoint"):
        bonus += 0.08
    if budget == "high" and tags.get("reservation") == "yes":
        bonus += 0.06
    return bonus


@dataclass
class Scored:
    place: Place
    arrive: datetime
    depart: datetime
    leg_minutes: int
    leg_km: float
    factors: Factors
    hours: HoursState
    score: float
    notes: list[str] = field(default_factory=list)


def score_candidate(
    place: Place,
    phase: Phase,
    intent: IntentSpec,
    from_lat: float,
    from_lon: float,
    now: datetime,
    used_names: set[str],
    pinned: bool = False,
) -> Scored | None:
    leg_minutes, leg_km = travel_estimate(from_lat, from_lon, place.lat, place.lon, intent.transport)
    arrive = now + timedelta(minutes=leg_minutes)
    dwell = phase.dwell_min
    depart = arrive + timedelta(minutes=dwell)
    hours = place.hours_at(arrive)
    notes: list[str] = []

    if hours.state == "closed" and not pinned:
        return None
    if hours.state == "open":
        timing = 1.0
        if hours.next_change and hours.next_change < depart:
            remaining = int((hours.next_change - arrive).total_seconds() // 60)
            if remaining < max(15, dwell * 0.4):
                if not pinned:
                    return None
                timing = 0.3
                notes.append("Closes very soon after you arrive.")
            else:
                timing = 0.6
                notes.append(f"Closes at {hours.next_change.strftime('%H:%M')}, so keep it short.")
    elif hours.state == "unknown":
        timing = 0.55
        notes.append("Hours not listed on OpenStreetMap. Worth a quick check.")
    else:
        timing = 0.0
        notes.append("Listed as closed at this time.")

    rank = phase.categories.index(place.category) if place.category in phase.categories else len(phase.categories)
    fit = max(0.0, 1.0 - 0.15 * rank) + constraint_bonus(place, intent.constraints, intent.budget)
    if place.landmark and place.category in ("attraction", "monument", "museum", "viewpoint"):
        fit += 0.12
    if place.name.lower() in used_names:
        fit -= 0.5
    fit = max(0.0, min(1.0, fit))
    if fit < 0.2 and not pinned:
        return None

    proximity = math.exp(-leg_minutes / PROXIMITY_TAU_MIN[intent.transport])
    factors = Factors(fit=round(fit, 2), timing=round(timing, 2), proximity=round(proximity, 2), confidence=place.confidence)
    score = sum(WEIGHTS[k] * getattr(factors, k) for k in WEIGHTS)
    return Scored(place, arrive, depart, leg_minutes, leg_km, factors, hours, round(score, 4), notes)


@dataclass
class State:
    stops: list[Scored]
    phases: list[Phase]
    gaps: list[Gap]
    lat: float
    lon: float
    time: datetime
    score: float
    used_ids: set[str]
    used_names: set[str]


def _expand(
    state: State,
    phase: Phase,
    candidates: list[Place],
    intent: IntentSpec,
    deadline: datetime,
    pin: str | None,
) -> list[State]:
    pool = [c for c in candidates if c.category in phase.categories and c.id not in state.used_ids]
    if pin:
        pool = [c for c in pool if c.id == pin] or [c for c in candidates if c.id == pin]
    scored: list[Scored] = []
    for place in pool:
        s = score_candidate(place, phase, intent, state.lat, state.lon, state.time, state.used_names, pinned=bool(pin))
        if s is None:
            continue
        if s.depart > deadline and not pin:
            continue
        scored.append(s)
    scored.sort(key=lambda s: (-s.score, s.leg_minutes, s.place.id))
    nexts: list[State] = []
    for s in scored[:BRANCH]:
        nexts.append(
            State(
                stops=state.stops + [s],
                phases=state.phases + [phase],
                gaps=list(state.gaps),
                lat=s.place.lat,
                lon=s.place.lon,
                time=s.depart,
                score=state.score + s.score,
                used_ids=state.used_ids | {s.place.id},
                used_names=state.used_names | {s.place.name.lower()},
            )
        )
    if phase.optional or not scored:
        reason = "Nothing open in reach for this part of the plan." if not scored else "Skipped to fit the time you have."
        skipped = State(
            stops=list(state.stops),
            phases=list(state.phases),
            gaps=state.gaps + ([Gap(phase_key=phase.key, phase_label=phase.label, reason=reason)] if not scored or not phase.optional else []),
            lat=state.lat,
            lon=state.lon,
            time=state.time,
            score=state.score - (0.15 if phase.optional else 0.6),
            used_ids=set(state.used_ids),
            used_names=set(state.used_names),
        )
        nexts.append(skipped)
    return nexts


def plan(intent: IntentSpec, candidates: list[Place], origin: tuple[float, float], pins: dict[str, str] | None = None, max_alternatives: int = 3) -> Itinerary:
    pins = pins or {}
    start = intent.start_time
    deadline = start + timedelta(minutes=intent.duration_min)
    beam = [State([], [], [], origin[0], origin[1], start, 0.0, set(), set())]
    for phase in intent.arc:
        expanded: list[State] = []
        for state in beam:
            expanded.extend(_expand(state, phase, candidates, intent, deadline, pins.get(phase.key)))
        expanded.sort(key=lambda s: (-s.score, len(s.gaps)))
        beam = expanded[:BEAM_WIDTH] or beam
    best = max(beam, key=lambda s: (len(s.stops) > 0, s.score))

    stops: list[Stop] = []
    prev_id: str | None = None
    prev_lat, prev_lon = origin
    used_names: set[str] = set()
    for index, (scored, phase) in enumerate(zip(best.stops, best.phases, strict=True), start=1):
        # Alternatives: other viable places for this phase from the same starting context.
        others: list[Scored] = []
        for place in candidates:
            if place.id == scored.place.id or place.category not in phase.categories or place.id in best.used_ids:
                continue
            s = score_candidate(place, phase, intent, prev_lat, prev_lon, scored.arrive - timedelta(minutes=scored.leg_minutes), used_names)
            if s is not None:
                others.append(s)
        others.sort(key=lambda s: (-s.score, s.leg_minutes))
        stops.append(
            Stop(
                order=index,
                phase_key=phase.key,
                phase_label=phase.label,
                place=scored.place.model_copy(update={"hours": scored.hours}),
                arrive=scored.arrive,
                depart=scored.depart,
                dwell_min=phase.dwell_min,
                leg=Leg(from_id=prev_id, to_id=scored.place.id, mode=intent.transport, minutes=scored.leg_minutes, km=scored.leg_km),
                score=round(scored.score, 3),
                factors=scored.factors,
                hours_at_arrival=scored.hours,
                notes=list(scored.notes),
                alternatives=[o.place.model_copy(update={"hours": o.hours}) for o in others[:max_alternatives]],
            )
        )
        prev_id = scored.place.id
        prev_lat, prev_lon = scored.place.lat, scored.place.lon
        used_names.add(scored.place.name.lower())

    ends_at = stops[-1].depart if stops else start
    travel = sum(s.leg.minutes for s in stops)
    return Itinerary(
        stops=stops,
        gaps=best.gaps,
        starts_at=start,
        ends_at=ends_at,
        total_min=int((ends_at - start).total_seconds() // 60),
        travel_min=travel,
        distance_km=round(sum(s.leg.km for s in stops), 2),
        score=round(best.score, 3),
    )


def retime(itinerary: Itinerary, leg_minutes: list[int]) -> Itinerary:
    """Shift arrival and departure times after real routing durations replace estimates."""
    if len(leg_minutes) != len(itinerary.stops):
        return itinerary
    current = itinerary.starts_at
    stops: list[Stop] = []
    for stop, minutes in zip(itinerary.stops, leg_minutes, strict=True):
        arrive = current + timedelta(minutes=minutes)
        depart = arrive + timedelta(minutes=stop.dwell_min)
        hours = stop.place.hours_at(arrive)
        stops.append(
            stop.model_copy(
                update={
                    "arrive": arrive,
                    "depart": depart,
                    "leg": stop.leg.model_copy(update={"minutes": minutes}),
                    "hours_at_arrival": hours,
                    "place": stop.place.model_copy(update={"hours": hours}),
                }
            )
        )
        current = depart
    ends_at = stops[-1].depart if stops else itinerary.starts_at
    return itinerary.model_copy(
        update={
            "stops": stops,
            "ends_at": ends_at,
            "total_min": int((ends_at - itinerary.starts_at).total_seconds() // 60),
            "travel_min": sum(leg_minutes),
        }
    )
