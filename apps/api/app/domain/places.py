from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.domain.hours import OpeningHours, parse_opening_hours
from app.domain.taxonomy import CATEGORIES, category_for_tags

# Tags that make a listing trustworthy: each adds to the data-confidence score.
_CONFIDENCE_TAGS = {
    "name": 0.28,
    "opening_hours": 0.22,
    "website": 0.12,
    "phone": 0.08,
    "contact:phone": 0.08,
    "cuisine": 0.08,
    "addr:street": 0.08,
    "wheelchair": 0.05,
    "wikidata": 0.12,
    "brand": 0.05,
    "outdoor_seating": 0.03,
    "internet_access": 0.03,
}
_KEPT_TAGS = (
    "cuisine",
    "diet:vegetarian",
    "diet:vegan",
    "outdoor_seating",
    "internet_access",
    "wheelchair",
    "website",
    "contact:website",
    "phone",
    "contact:phone",
    "brand",
    "level",
    "addr:street",
    "addr:housenumber",
    "wikidata",
    "description",
    "smoking",
    "live_music",
    "reservation",
    "takeaway",
)


class HoursState(BaseModel):
    state: str = "unknown"  # open | closed | unknown
    rule: str | None = None
    next_change: datetime | None = None


class Place(BaseModel):
    id: str
    name: str
    lat: float
    lon: float
    category: str
    category_label: str
    tags: dict[str, str] = Field(default_factory=dict)
    confidence: float = 0.3
    landmark: bool = False
    hours: HoursState = Field(default_factory=HoursState)

    _parsed_hours: OpeningHours | None = None

    def opening(self) -> OpeningHours:
        if self._parsed_hours is None:
            self._parsed_hours = parse_opening_hours(self.tags.get("opening_hours"))
        return self._parsed_hours

    def hours_at(self, moment: datetime) -> HoursState:
        state, next_change = self.opening().state_at(moment)
        return HoursState(state=state, rule=self.tags.get("opening_hours"), next_change=next_change)


def confidence_from_tags(tags: dict[str, str]) -> float:
    score = 0.18
    for key, weight in _CONFIDENCE_TAGS.items():
        if tags.get(key):
            score += weight
    return round(min(1.0, score), 2)


def place_from_osm(element: dict[str, Any], wanted: list[str]) -> Place | None:
    tags = element.get("tags") or {}
    name = (tags.get("name") or tags.get("name:en") or tags.get("brand") or "").strip()
    if not name:
        return None  # nameless features are useless as destinations
    lat = element.get("lat")
    lon = element.get("lon")
    if lat is None or lon is None:
        center = element.get("center") or {}
        lat, lon = center.get("lat"), center.get("lon")
    if lat is None or lon is None:
        return None
    category = category_for_tags(tags, wanted)
    if category is None:
        return None
    kept = {
        k: str(v)[:160] for k, v in tags.items() if k in _KEPT_TAGS or k == "opening_hours"
    }
    return Place(
        id=f"{element.get('type', 'n')[0]}{element.get('id')}",
        name=name[:80],
        lat=float(lat),
        lon=float(lon),
        category=category,
        category_label=CATEGORIES[category].label,
        tags=kept,
        confidence=confidence_from_tags(tags),
        landmark=bool(tags.get("wikidata") or tags.get("wikipedia")),
    )
