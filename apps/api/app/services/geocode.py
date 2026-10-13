"""Worldwide place search and reverse lookup through Photon (komoot), backed by OpenStreetMap."""

from __future__ import annotations

import httpx
from pydantic import BaseModel

from app.core.config import Settings
from app.core.logging import get_logger
from app.utils.cache import TTLCache

logger = get_logger("geocode")

_KIND_LABELS = {
    "city": "City",
    "town": "Town",
    "village": "Village",
    "suburb": "Neighbourhood",
    "neighbourhood": "Neighbourhood",
    "quarter": "Neighbourhood",
    "borough": "District",
    "district": "District",
    "county": "County",
    "state": "Region",
    "country": "Country",
    "station": "Station",
    "airport": "Airport",
    "university": "University",
    "attraction": "Landmark",
    "museum": "Museum",
    "park": "Park",
    "hotel": "Hotel",
}


class GeoHit(BaseModel):
    label: str
    name: str
    lat: float
    lon: float
    kind: str
    country: str | None = None


def _describe(props: dict) -> tuple[str, str]:
    name = props.get("name") or props.get("street") or props.get("city") or "Unnamed place"
    parts: list[str] = []
    for key in ("district", "city", "state", "country"):
        value = props.get(key)
        if value and value != name and value not in parts:
            parts.append(value)
    kind = _KIND_LABELS.get(props.get("osm_value", ""), _KIND_LABELS.get(props.get("type", ""), (props.get("osm_value") or "place").replace("_", " ").title()))
    label = ", ".join([name, *parts[:3]])
    return label, kind


class GeocodeClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.base = settings.geocode_base_url.rstrip("/")
        self.search_cache: TTLCache[list[GeoHit]] = TTLCache(ttl_seconds=3600, max_entries=2000)
        self.reverse_cache: TTLCache[str] = TTLCache(ttl_seconds=86400, max_entries=2000)

    async def search(self, query: str, lang: str = "en", limit: int = 6, near: tuple[float, float] | None = None) -> list[GeoHit]:
        query = " ".join(query.split())[:120]
        if len(query) < 2:
            return []
        key = f"{lang}|{limit}|{query.lower()}|{near[0]:.1f},{near[1]:.1f}" if near else f"{lang}|{limit}|{query.lower()}"
        cached = self.search_cache.get(key)
        if cached is not None:
            return cached
        params: dict[str, str | int | float] = {"q": query, "limit": limit, "lang": lang}
        if near:
            params["lat"], params["lon"] = near
        try:
            async with httpx.AsyncClient(timeout=self.settings.geocode_timeout_seconds, headers={"user-agent": self.settings.user_agent}) as client:
                response = await client.get(f"{self.base}/api/", params=params)
            response.raise_for_status()
            features = response.json().get("features", [])
        except Exception as exc:  # noqa: BLE001
            logger.warning("geocode search failed: %s", type(exc).__name__)
            return []
        hits: list[GeoHit] = []
        seen: set[str] = set()
        for feature in features:
            props = feature.get("properties", {})
            coords = feature.get("geometry", {}).get("coordinates")
            if not coords or len(coords) < 2:
                continue
            label, kind = _describe(props)
            if label in seen:
                continue
            seen.add(label)
            hits.append(GeoHit(label=label, name=props.get("name") or label.split(",")[0], lat=float(coords[1]), lon=float(coords[0]), kind=kind, country=props.get("country")))
        self.search_cache.set(key, hits)
        return hits

    async def reverse(self, lat: float, lon: float, lang: str = "en") -> str | None:
        key = f"{lang}|{lat:.3f},{lon:.3f}"
        cached = self.reverse_cache.get(key)
        if cached is not None:
            return cached
        try:
            async with httpx.AsyncClient(timeout=self.settings.geocode_timeout_seconds, headers={"user-agent": self.settings.user_agent}) as client:
                response = await client.get(f"{self.base}/reverse", params={"lat": lat, "lon": lon, "lang": lang})
            response.raise_for_status()
            features = response.json().get("features", [])
        except Exception as exc:  # noqa: BLE001
            logger.warning("reverse geocode failed: %s", type(exc).__name__)
            return None
        if not features:
            return None
        props = features[0].get("properties", {})
        parts: list[str] = []
        for key_name in ("name", "district", "city", "country"):
            value = props.get(key_name)
            if value and value not in parts:
                parts.append(value)
        label = ", ".join(parts[:3]) if parts else None
        if label:
            self.reverse_cache.set(key, label)
        return label
