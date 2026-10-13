"""Plain-language explanations and counterfactuals for a composed itinerary."""

from __future__ import annotations

from datetime import datetime, timedelta

from pydantic import BaseModel

from app.domain.intent import IntentSpec
from app.domain.places import Place
from app.domain.planner import Itinerary, Stop, plan

MODE_VERB = {"walk": "walk", "bike": "ride", "drive": "drive"}


class Counterfactual(BaseModel):
    kind: str  # more_time | later_start | other_mode
    label: str
    outcome: str


def _leg_phrase(stop: Stop) -> str:
    if stop.leg.from_id is None:
        return f"a {stop.leg.minutes} minute {MODE_VERB[stop.leg.mode]} from where you start"
    return f"a {stop.leg.minutes} minute {MODE_VERB[stop.leg.mode]} from stop {stop.order - 1}"


def explain_stop(stop: Stop, intent: IntentSpec, sunset: datetime | None = None) -> str:
    parts: list[str] = []
    tags = stop.place.tags
    hours = stop.hours_at_arrival
    if hours.state == "open" and hours.next_change:
        until = hours.next_change.strftime("%H:%M")
        if hours.next_change.date() != stop.arrive.date():
            until += " tomorrow"
        parts.append(f"Open until {until} when you arrive at {stop.arrive.strftime('%H:%M')}")
    elif hours.state == "open":
        parts.append(f"Open around the clock, so {stop.arrive.strftime('%H:%M')} works")
    elif hours.state == "unknown":
        parts.append(f"Hours are not listed, so treat {stop.arrive.strftime('%H:%M')} as a best guess")
    else:
        parts.append("Listed as closed at this time, kept because you pinned it")
    parts.append(_leg_phrase(stop))
    if stop.place.category in intent.explicit_categories:
        parts.append("exactly the kind of place you asked for")
    if tags.get("cuisine"):
        parts.append(f"{tags['cuisine'].replace(';', ', ').replace('_', ' ')} on the menu")
    if "outdoor" in intent.constraints and tags.get("outdoor_seating") == "yes":
        parts.append("seating outside")
    if "wifi" in intent.constraints and tags.get("internet_access") in ("wlan", "yes"):
        parts.append("wifi listed")
    if "wheelchair" in intent.constraints and tags.get("wheelchair") == "yes":
        parts.append("marked wheelchair accessible")
    if sunset and stop.arrive <= sunset <= stop.depart and stop.place.category in ("viewpoint", "park", "nature", "attraction", "monument"):
        parts.append(f"you will be there for sunset at {sunset.strftime('%H:%M')}")
    if stop.place.landmark:
        parts.append("a documented landmark")
    if stop.place.confidence >= 0.75:
        parts.append("a well-documented listing")
    elif stop.place.confidence < 0.4:
        parts.append("a thin listing, so details may be missing")
    sentence = ", ".join(parts)
    return sentence[0].upper() + sentence[1:] + "."


def _names(itinerary: Itinerary) -> list[str]:
    return [s.place.name for s in itinerary.stops]


def counterfactuals(intent: IntentSpec, itinerary: Itinerary, candidates: list[Place], origin: tuple[float, float]) -> list[Counterfactual]:
    results: list[Counterfactual] = []
    base_names = _names(itinerary)

    extra = 45
    longer = plan(intent.model_copy(update={"duration_min": min(720, intent.duration_min + extra)}), candidates, origin)
    added = [n for n in _names(longer) if n not in base_names]
    if added:
        results.append(Counterfactual(kind="more_time", label=f"With {extra} more minutes", outcome=f"We would add {added[0]}."))
    elif len(longer.stops) == len(itinerary.stops):
        results.append(Counterfactual(kind="more_time", label=f"With {extra} more minutes", outcome="The plan would not change. Time is not the constraint here."))

    shift = 120
    later = plan(intent.model_copy(update={"start_time": intent.start_time + timedelta(minutes=shift)}), candidates, origin)
    lost = [n for n in base_names if n not in _names(later)]
    if lost:
        results.append(Counterfactual(kind="later_start", label="Leaving two hours later", outcome=f"{lost[0]} would drop out, likely closed by then."))
    else:
        results.append(Counterfactual(kind="later_start", label="Leaving two hours later", outcome="Every stop still works."))

    if intent.transport == "walk":
        other = plan(intent.model_copy(update={"transport": "bike"}), candidates, origin)
        saved = itinerary.travel_min - other.travel_min
        if saved > 8:
            results.append(Counterfactual(kind="other_mode", label="On a bike", outcome=f"You would spend {saved} fewer minutes in transit."))
    return results
