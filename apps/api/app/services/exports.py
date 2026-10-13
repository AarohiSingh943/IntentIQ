"""Calendar (.ics) and GPX exports of a stored plan."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from xml.sax.saxutils import escape


def _ics_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _utc_stamp(value: str) -> str:
    moment = datetime.fromisoformat(value)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def plan_to_ics(plan_id: str, payload: dict[str, Any]) -> str:
    stops = payload.get("itinerary", {}).get("stops", [])
    summary = payload.get("intent", {}).get("summary", "Intentra plan")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Intentra//Plan//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    for stop in stops:
        place = stop["place"]
        description = stop.get("why", "")
        lines += [
            "BEGIN:VEVENT",
            f"UID:{plan_id}-{stop['order']}@intentra",
            f"DTSTAMP:{_utc_stamp(stop['arrive'])}",
            f"DTSTART:{_utc_stamp(stop['arrive'])}",
            f"DTEND:{_utc_stamp(stop['depart'])}",
            f"SUMMARY:{_ics_escape(stop['phase_label'] + ': ' + place['name'])}",
            f"LOCATION:{_ics_escape(place['name'])}",
            f"GEO:{place['lat']:.6f};{place['lon']:.6f}",
            f"DESCRIPTION:{_ics_escape(summary + ' ' + description)}",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def plan_to_gpx(plan_id: str, payload: dict[str, Any]) -> str:
    stops = payload.get("itinerary", {}).get("stops", [])
    name = escape(payload.get("intent", {}).get("summary", "Intentra plan"))
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="Intentra" xmlns="http://www.topografix.com/GPX/1/1">',
        f"<metadata><name>{name}</name></metadata>",
    ]
    for stop in stops:
        place = stop["place"]
        parts.append(
            f'<wpt lat="{place["lat"]:.6f}" lon="{place["lon"]:.6f}"><name>{escape(str(stop["order"]) + ". " + place["name"])}</name>'
            f"<desc>{escape(stop.get('why', ''))}</desc></wpt>"
        )
    parts.append(f"<trk><name>{escape(plan_id)}</name><trkseg>")
    for stop in stops:
        for lon, lat in stop.get("leg", {}).get("geometry", []):
            parts.append(f'<trkpt lat="{lat:.6f}" lon="{lon:.6f}"></trkpt>')
    parts.append("</trkseg></trk></gpx>")
    return "\n".join(parts)
