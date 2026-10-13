from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.domain.places import Place
from app.main import create_app
from app.services.overpass import CandidateSet

ZONE = ZoneInfo("Asia/Kolkata")


def make_place(pid: str, name: str, category: str, lat: float, lon: float, hours: str | None = None, **tags: str) -> Place:
    all_tags = dict(tags)
    if hours:
        all_tags["opening_hours"] = hours
    from app.domain.places import confidence_from_tags
    from app.domain.taxonomy import CATEGORIES

    return Place(
        id=pid,
        name=name,
        lat=lat,
        lon=lon,
        category=category,
        category_label=CATEGORIES[category].label,
        tags=all_tags,
        confidence=confidence_from_tags({"name": name, **all_tags}),
    )


@pytest.fixture
def now() -> datetime:
    # A Wednesday afternoon.
    return datetime(2026, 9, 23, 15, 0, tzinfo=ZONE)


@pytest.fixture
def sample_places() -> list[Place]:
    base_lat, base_lon = 28.6139, 77.2090
    return [
        make_place("n1", "Blue Tokai", "cafe", base_lat + 0.003, base_lon + 0.002, "Mo-Su 08:00-22:00", internet_access="wlan", outdoor_seating="yes"),
        make_place("n2", "Night Owl Cafe", "cafe", base_lat + 0.004, base_lon - 0.003, "Mo-Su 18:00-02:00"),
        make_place("n3", "Closed Cafe", "cafe", base_lat + 0.001, base_lon + 0.001, "Mo-Su 08:00-12:00"),
        make_place("n4", "Lodhi Garden", "park", base_lat - 0.006, base_lon + 0.004, "24/7", wikidata="Q1"),
        make_place("n5", "Mystery Park", "park", base_lat + 0.01, base_lon + 0.01),
        make_place("n6", "Gelato Bar", "ice_cream", base_lat - 0.002, base_lon - 0.002, "Mo-Su 11:00-23:00"),
        make_place("n7", "Indian Accent", "restaurant", base_lat + 0.005, base_lon + 0.006, "Mo-Su 12:00-15:00,19:00-23:30", cuisine="indian"),
        make_place("n8", "Khan Market Library", "library", base_lat - 0.004, base_lon - 0.005, "Mo-Sa 09:00-20:00"),
    ]


class FakeOverpass:
    def __init__(self, places: list[Place]):
        self.places = places
        self.calls = 0

        class _Cache:
            def stats(self):
                return {"entries": 0, "hits": 0, "misses": 0}

        self.cache = _Cache()

    async def candidates(self, lat, lon, transport, duration_min, categories):
        self.calls += 1
        return CandidateSet([p for p in self.places if p.category in categories], 1.6, categories, False, "fake")


class FakeGeocode:
    async def search(self, query, lang="en", limit=6, near=None):
        from app.services.geocode import GeoHit

        if "nowhere" in query:
            return []
        return [GeoHit(label="Connaught Place, New Delhi, India", name="Connaught Place", lat=28.6315, lon=77.2167, kind="Neighbourhood", country="India")]

    async def reverse(self, lat, lon, lang="en"):
        return "Connaught Place, New Delhi, India"


class FakeWeather:
    """A rainy evening with sunset at 18:14, so plans lean indoors and mention golden hour."""

    async def forecast(self, lat, lon, zone):
        from datetime import datetime, timedelta

        from app.services.weather import Forecast, HourlyPoint

        day = datetime(2026, 9, 23, 0, 0, tzinfo=zone)
        hours = [HourlyPoint(time=day + timedelta(hours=h), temp_c=29.0, precip_prob=70 if 18 <= h <= 21 else 5, code=61 if 18 <= h <= 21 else 1) for h in range(0, 72)]
        return Forecast(hourly=hours, sunrise=[day.replace(hour=6, minute=10)], sunset=[day.replace(hour=18, minute=14)])


@pytest.fixture
def client(sample_places, tmp_path) -> TestClient:
    settings = Settings(
        llm_provider="none",
        routing_enabled=False,
        weather_enabled=False,
        database_path=str(tmp_path / "test.db"),
        web_dist_dir=str(tmp_path / "nope"),
        rate_limit_per_minute=1000,
    )
    app = create_app(settings)
    with TestClient(app) as test_client:
        app.state.overpass = FakeOverpass(sample_places)
        app.state.composer.overpass = app.state.overpass
        app.state.geocode = FakeGeocode()
        app.state.composer.geocode = app.state.geocode
        app.state.composer.weather = FakeWeather()
        yield test_client
