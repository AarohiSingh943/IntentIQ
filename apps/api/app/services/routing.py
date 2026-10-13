"""Real route geometry and durations from OSRM (FOSSGIS public instance), with an honest
straight-line fallback when routing is unavailable."""

from __future__ import annotations

import httpx

from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.planner import Itinerary, retime

logger = get_logger("routing")

PROFILE = {"walk": "routed-foot", "bike": "routed-bike", "drive": "routed-car"}


async def attach_routes(itinerary: Itinerary, origin: tuple[float, float], settings: Settings) -> tuple[Itinerary, str]:
    """Returns the itinerary with leg geometry filled and times adjusted, plus the route source."""
    if not itinerary.stops:
        return itinerary, "none"

    points = [(origin[1], origin[0])] + [(s.place.lon, s.place.lat) for s in itinerary.stops]
    fallback = _straight_lines(itinerary, points)
    if not settings.routing_enabled:
        return fallback, "estimate"

    mode = itinerary.stops[0].leg.mode
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for lon, lat in points)
    url = f"{settings.routing_base_url}/{PROFILE[mode]}/route/v1/driving/{coords}"
    params = {"overview": "full", "geometries": "geojson", "steps": "false"}
    try:
        async with httpx.AsyncClient(timeout=settings.routing_timeout_seconds, headers={"user-agent": settings.user_agent}) as client:
            response = await client.get(url, params=params)
        response.raise_for_status()
        body = response.json()
        route = body["routes"][0]
        legs = route["legs"]
        if len(legs) != len(itinerary.stops):
            raise ValueError("leg count mismatch")
    except Exception as exc:  # noqa: BLE001
        logger.warning("routing unavailable, using estimates: %s", str(exc)[:160])
        return fallback, "estimate"

    geometry = route["geometry"]["coordinates"]
    # Split the full geometry into per-leg pieces using cumulative step counts is not available
    # without steps; approximate by nearest vertex to each waypoint.
    boundaries = [0]
    cursor = 0
    for lon, lat in points[1:]:
        best_index, best_dist = cursor, float("inf")
        for i in range(cursor, len(geometry)):
            d = (geometry[i][0] - lon) ** 2 + (geometry[i][1] - lat) ** 2
            if d < best_dist:
                best_dist, best_index = d, i
        boundaries.append(best_index)
        cursor = best_index
    boundaries[-1] = len(geometry) - 1

    minutes: list[int] = []
    stops = []
    for index, (stop, leg) in enumerate(zip(itinerary.stops, legs, strict=True)):
        piece = geometry[boundaries[index] : boundaries[index + 1] + 1]
        duration_min = max(1, int(round(leg["duration"] / 60)) + (1 if mode == "walk" else 4))
        minutes.append(duration_min)
        stops.append(
            stop.model_copy(
                update={
                    "leg": stop.leg.model_copy(
                        update={"minutes": duration_min, "km": round(leg["distance"] / 1000, 2), "source": "osrm", "geometry": [[round(p[0], 6), round(p[1], 6)] for p in piece]}
                    )
                }
            )
        )
    routed = itinerary.model_copy(update={"stops": stops, "distance_km": round(route["distance"] / 1000, 2)})
    return retime(routed, minutes), "osrm"


def _straight_lines(itinerary: Itinerary, points: list[tuple[float, float]]) -> Itinerary:
    stops = []
    for index, stop in enumerate(itinerary.stops):
        a, b = points[index], points[index + 1]
        stops.append(stop.model_copy(update={"leg": stop.leg.model_copy(update={"geometry": [[a[0], a[1]], [b[0], b[1]]], "source": "estimate"})}))
    return itinerary.model_copy(update={"stops": stops})
