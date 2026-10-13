"""Weather and daylight for the plan window, from Open-Meteo (no key needed)."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from pydantic import BaseModel

from app.core.config import Settings
from app.core.logging import get_logger
from app.utils.cache import TTLCache

logger = get_logger("weather")

# WMO weather interpretation codes, condensed to what a person needs to know.
_CODE_LABELS: list[tuple[range, str, str]] = [
    (range(0, 1), "Clear sky", "clear"),
    (range(1, 3), "Mostly clear", "partly"),
    (range(3, 4), "Overcast", "cloudy"),
    (range(45, 49), "Foggy", "fog"),
    (range(51, 58), "Drizzle", "drizzle"),
    (range(61, 68), "Rain", "rain"),
    (range(71, 78), "Snow", "snow"),
    (range(80, 83), "Rain showers", "rain"),
    (range(85, 87), "Snow showers", "snow"),
    (range(95, 100), "Thunderstorms", "storm"),
]


def describe_code(code: int) -> tuple[str, str]:
    for span, label, icon in _CODE_LABELS:
        if code in span:
            return label, icon
    return "Changeable", "partly"


class HourlyPoint(BaseModel):
    time: datetime
    temp_c: float
    precip_prob: int
    code: int


class Forecast(BaseModel):
    hourly: list[HourlyPoint]
    sunrise: list[datetime]
    sunset: list[datetime]


class WeatherSummary(BaseModel):
    temp_c: float
    feels: str  # cold | cool | mild | warm | hot
    precip_prob: int
    code: int
    label: str
    icon: str
    rain_expected: bool
    rain_from: datetime | None = None
    sunrise: datetime | None = None
    sunset: datetime | None = None
    sunset_in_window: bool = False
    dark_at_start: bool = False
    advice: list[str]


def _feels(temp: float) -> str:
    if temp < 8:
        return "cold"
    if temp < 16:
        return "cool"
    if temp < 25:
        return "mild"
    if temp < 32:
        return "warm"
    return "hot"


def summarise(forecast: Forecast, start: datetime, end: datetime) -> WeatherSummary | None:
    window = [p for p in forecast.hourly if start - timedelta(hours=1) <= p.time <= end + timedelta(minutes=30)]
    if not window:
        return None
    at_start = min(window, key=lambda p: abs((p.time - start).total_seconds()))
    wettest = max(window, key=lambda p: p.precip_prob)
    rain_expected = wettest.precip_prob >= 45 or any(p.code >= 51 for p in window)
    rain_from = next((p.time for p in window if p.precip_prob >= 45 or p.code >= 51), None) if rain_expected else None
    if rain_expected:
        wet_codes = [p.code for p in window if p.code >= 51]
        label, icon = describe_code(max(wet_codes)) if wet_codes else ("Rain likely", "rain")
    else:
        label, icon = describe_code(at_start.code)

    sunrise = next((s for s in forecast.sunrise if s.date() == start.date()), None)
    sunset = next((s for s in forecast.sunset if s.date() == start.date()), None)
    sunset_in_window = bool(sunset and start <= sunset <= end)
    dark_at_start = bool(sunset and sunrise and (start > sunset or start < sunrise))

    advice: list[str] = []
    if rain_expected and rain_from:
        advice.append(f"Rain likely from {rain_from.strftime('%H:%M')}, so indoor stops rank higher.")
    elif rain_expected:
        advice.append("Rain likely during the plan, so indoor stops rank higher.")
    if sunset_in_window and sunset:
        advice.append(f"Sunset at {sunset.strftime('%H:%M')} falls inside the plan. Viewpoints and parks are timed around it where possible.")
    feels = _feels(at_start.temp_c)
    if feels == "hot":
        advice.append(f"Around {round(at_start.temp_c)}°C at the start. Expect shade and air-conditioning to matter.")
    elif feels == "cold":
        advice.append(f"Around {round(at_start.temp_c)}°C at the start. Dress warm for the walks between stops.")

    return WeatherSummary(
        temp_c=round(at_start.temp_c, 1),
        feels=feels,
        precip_prob=wettest.precip_prob,
        code=max((p.code for p in window if p.code >= 51), default=wettest.code) if rain_expected else at_start.code,
        label=label,
        icon=icon,
        rain_expected=rain_expected,
        rain_from=rain_from,
        sunrise=sunrise,
        sunset=sunset,
        sunset_in_window=sunset_in_window,
        dark_at_start=dark_at_start,
        advice=advice,
    )


class WeatherClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.cache: TTLCache[Forecast] = TTLCache(ttl_seconds=1800, max_entries=512)

    async def forecast(self, lat: float, lon: float, zone: ZoneInfo) -> Forecast | None:
        key = f"{lat:.2f},{lon:.2f},{zone.key}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        params = {
            "latitude": f"{lat:.4f}",
            "longitude": f"{lon:.4f}",
            "hourly": "temperature_2m,precipitation_probability,weather_code",
            "daily": "sunrise,sunset",
            "timezone": zone.key,
            "forecast_days": 3,
        }
        try:
            async with httpx.AsyncClient(timeout=self.settings.weather_timeout_seconds, headers={"user-agent": self.settings.user_agent}) as client:
                response = await client.get(f"{self.settings.weather_base_url}/v1/forecast", params=params)
            response.raise_for_status()
            body = response.json()
        except Exception as exc:  # noqa: BLE001
            logger.warning("weather unavailable: %s", type(exc).__name__)
            return None
        try:
            hourly = body["hourly"]
            points = [
                HourlyPoint(
                    time=datetime.fromisoformat(t).replace(tzinfo=zone),
                    temp_c=float(temp if temp is not None else 20.0),
                    precip_prob=int(prob if prob is not None else 0),
                    code=int(code if code is not None else 0),
                )
                for t, temp, prob, code in zip(hourly["time"], hourly["temperature_2m"], hourly["precipitation_probability"], hourly["weather_code"], strict=True)
            ]
            daily = body.get("daily", {})
            forecast = Forecast(
                hourly=points,
                sunrise=[datetime.fromisoformat(t).replace(tzinfo=zone) for t in daily.get("sunrise", [])],
                sunset=[datetime.fromisoformat(t).replace(tzinfo=zone) for t in daily.get("sunset", [])],
            )
        except (KeyError, ValueError, TypeError) as exc:
            logger.warning("weather payload unreadable: %s", type(exc).__name__)
            return None
        self.cache.set(key, forecast)
        return forecast
