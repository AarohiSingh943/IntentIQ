"""Overpass client: one combined query per plan, mirror failover, and a shared cache keyed on a
coarse location so that re-planning (new start time, pins, transport) never refetches."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

import httpx

from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.places import Place, place_from_osm
from app.domain.taxonomy import CATEGORIES
from app.utils.cache import TTLCache

logger = get_logger("overpass")


class OverpassUnavailable(Exception):
    """Every mirror failed. Callers must surface this honestly, never fabricate results."""


@dataclass
class CandidateSet:
    places: list[Place]
    radius_km: float
    categories: list[str]
    cached: bool
    mirror: str | None


def radius_for(transport: str, duration_min: int) -> float:
    base = {"walk": 1.6, "bike": 3.5, "drive": 7.0}[transport]
    scale = min(1.8, max(0.7, duration_min / 150))
    return round(base * scale, 2)


def build_query(lat: float, lon: float, radius_m: int, categories: list[str], per_category: int, timeout_s: int) -> str:
    blocks: list[str] = []
    for key in categories:
        cat = CATEGORIES[key]
        union = "".join(f"nwr{f.overpass()}(around:{radius_m},{lat:.5f},{lon:.5f});" for f in cat.filters)
        blocks.append(f"({union})->.{key};.{key} out center tags {per_category};")
    return f"[out:json][timeout:{timeout_s}];" + "".join(blocks)


class OverpassClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.cache: TTLCache[list[dict]] = TTLCache(settings.overpass_cache_ttl_seconds, max_entries=256)
        self._inflight: dict[str, asyncio.Future] = {}

    def _cache_key(self, lat: float, lon: float, radius_km: float, categories: list[str]) -> str:
        return f"{lat:.3f}:{lon:.3f}:{radius_km}:{','.join(sorted(categories))}"

    async def _fetch(self, query: str) -> tuple[list[dict], str]:
        timeout = self.settings.overpass_timeout_seconds
        headers = {"user-agent": self.settings.user_agent}
        last_error: Exception | None = None
        async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
            for mirror in self.settings.overpass_mirror_list:
                try:
                    response = await client.post(mirror, data={"data": query})
                    if response.status_code == 429 or response.status_code >= 500:
                        raise httpx.HTTPStatusError(f"{response.status_code} from mirror", request=response.request, response=response)
                    response.raise_for_status()
                    body = response.json()
                    if "remark" in body and "error" in str(body.get("remark", "")).lower():
                        raise RuntimeError(body["remark"])
                    return body.get("elements", []), mirror
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    logger.warning("mirror failed %s: %s", mirror, str(exc)[:160])
        raise OverpassUnavailable(str(last_error) if last_error else "no mirrors configured")

    async def candidates(self, lat: float, lon: float, transport: str, duration_min: int, categories: list[str]) -> CandidateSet:
        categories = [c for c in dict.fromkeys(categories) if c in CATEGORIES]
        radius_km = radius_for(transport, duration_min)
        key = self._cache_key(lat, lon, radius_km, categories)
        cached = self.cache.get(key)
        if cached is not None:
            return CandidateSet(self._to_places(cached, categories), radius_km, categories, True, None)

        loop = asyncio.get_running_loop()
        if key in self._inflight:
            elements, mirror = await self._inflight[key]
            return CandidateSet(self._to_places(elements, categories), radius_km, categories, True, mirror)

        future: asyncio.Future = loop.create_future()
        self._inflight[key] = future
        try:
            query = build_query(lat, lon, int(radius_km * 1000), categories, self.settings.max_candidates_per_category, int(self.settings.overpass_timeout_seconds) - 2)
            elements, mirror = await self._fetch(query)
            self.cache.set(key, elements)
            future.set_result((elements, mirror))
        except BaseException as exc:
            future.set_exception(exc)
            raise
        finally:
            self._inflight.pop(key, None)
        return CandidateSet(self._to_places(elements, categories), radius_km, categories, False, mirror)

    @staticmethod
    def _to_places(elements: list[dict], categories: list[str]) -> list[Place]:
        seen: set[tuple[str, float, float]] = set()
        places: list[Place] = []
        for element in elements:
            place = place_from_osm(element, categories)
            if place is None:
                continue
            dedupe_key = (place.name.lower(), round(place.lat, 4), round(place.lon, 4))
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            places.append(place)
        return places
