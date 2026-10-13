from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.services.weather import Forecast, HourlyPoint, describe_code, summarise

ZONE = ZoneInfo("Asia/Kolkata")


def _forecast(rain_hours: range) -> Forecast:
    day = datetime(2026, 9, 23, 0, 0, tzinfo=ZONE)
    hours = [HourlyPoint(time=day + timedelta(hours=h), temp_c=31.0, precip_prob=80 if h in rain_hours else 0, code=63 if h in rain_hours else 0) for h in range(48)]
    return Forecast(hourly=hours, sunrise=[day.replace(hour=6)], sunset=[day.replace(hour=18, minute=14)])


def test_summary_flags_rain_and_sunset_inside_window():
    start = datetime(2026, 9, 23, 17, 0, tzinfo=ZONE)
    summary = summarise(_forecast(range(19, 21)), start, start + timedelta(hours=3))
    assert summary is not None
    assert summary.rain_expected
    assert summary.rain_from == datetime(2026, 9, 23, 19, 0, tzinfo=ZONE)
    assert summary.sunset_in_window
    assert summary.feels == "warm"
    assert any("Rain likely from 19:00" in a for a in summary.advice)
    assert any("Sunset at 18:14" in a for a in summary.advice)


def test_summary_is_calm_when_dry():
    start = datetime(2026, 9, 23, 10, 0, tzinfo=ZONE)
    summary = summarise(_forecast(range(0)), start, start + timedelta(hours=2))
    assert summary is not None
    assert not summary.rain_expected
    assert not summary.sunset_in_window
    assert summary.label == "Clear sky"


def test_summary_none_outside_forecast():
    start = datetime(2026, 10, 30, 10, 0, tzinfo=ZONE)
    assert summarise(_forecast(range(0)), start, start + timedelta(hours=2)) is None


def test_code_descriptions():
    assert describe_code(0) == ("Clear sky", "clear")
    assert describe_code(95)[1] == "storm"
    assert describe_code(999)[0] == "Changeable"


def test_geocode_routes(client):
    hits = client.get("/api/geocode", params={"q": "connaught"}).json()["hits"]
    assert hits[0]["name"] == "Connaught Place"
    assert client.get("/api/geocode", params={"q": "nowhere"}).json()["hits"] == []
    assert client.get("/api/geocode", params={"q": "a"}).status_code == 422
    assert client.get("/api/geocode/reverse", params={"lat": 28.6, "lon": 77.2}).json()["label"].startswith("Connaught")


def test_plan_carries_weather_start_label_and_exclusions(client):
    payload = {"query": "a quiet cafe for 2 hours", "lat": 28.6139, "lon": 77.2090, "timezone": "Asia/Kolkata", "leave_at": "2026-09-23T17:30:00"}
    body = client.post("/api/plan", json=payload).json()
    assert body["start_label"].startswith("Connaught")
    assert body["weather"]["rain_expected"] is True
    assert "rain" in body["intent"]["constraints"]
    assert body["origin"] == [28.6139, 77.2090]
    first = body["itinerary"]["stops"][0]["place"]["id"]
    again = client.post("/api/plan", json={**payload, "exclude": [first]}).json()
    assert all(s["place"]["id"] != first for s in again["itinerary"]["stops"])
