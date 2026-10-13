import json


def _plan_payload(**extra):
    return {"query": "a quiet cafe for 2 hours", "lat": 28.6139, "lon": 77.2090, "timezone": "Asia/Kolkata", "leave_at": "2026-09-23T15:00:00", **extra}


def test_health_and_meta(client):
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert "x-request-id" in health.headers
    meta = client.get("/api/meta").json()
    assert any(m["key"] == "date" for m in meta["moods"])


def test_plan_contract(client):
    response = client.post("/api/plan", json=_plan_payload())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["intent"]["mood"] in ("unwind", "focus")
    assert body["itinerary"]["stops"]
    stop = body["itinerary"]["stops"][0]
    assert stop["place"]["category"] == "cafe"
    assert stop["why"]
    assert stop["leg"]["geometry"]
    assert body["meta"]["route_source"] == "estimate"
    assert body["candidates"]


def test_plan_stream_emits_ordered_events(client):
    with client.stream("POST", "/api/plan/stream", json=_plan_payload()) as response:
        assert response.status_code == 200
        raw = "".join(response.iter_text())
    events = [line.split(": ", 1)[1] for line in raw.splitlines() if line.startswith("event: ")]
    assert events[0] == "stage"
    assert "intent" in events
    assert "candidates" in events
    assert events[-2:] == ["plan", "done"]
    plan_line = next(line for line in raw.splitlines() if line.startswith("data: ") and '"itinerary"' in line)
    assert json.loads(plan_line[6:])["itinerary"]["stops"]


def test_validation_errors_are_readable(client):
    response = client.post("/api/plan", json={"query": "hi", "lat": 1, "lon": 2})
    assert response.status_code == 422
    assert response.json()["error"] == "invalid_request"
    bad_zone = client.post("/api/plan", json=_plan_payload(timezone="Mars/Olympus"))
    assert bad_zone.status_code == 422


def test_save_share_and_export(client):
    plan = client.post("/api/plan", json=_plan_payload()).json()
    saved = client.post("/api/plans", json=plan)
    assert saved.status_code == 200
    plan_id = saved.json()["id"]
    fetched = client.get(f"/api/plans/{plan_id}")
    assert fetched.status_code == 200
    assert fetched.json()["plan_id"] == plan_id
    ics = client.get(f"/api/plans/{plan_id}/calendar.ics")
    assert ics.status_code == 200
    assert "BEGIN:VEVENT" in ics.text
    gpx = client.get(f"/api/plans/{plan_id}/route.gpx")
    assert gpx.status_code == 200
    assert "<wpt" in gpx.text
    assert client.get("/api/plans/doesnotexist").status_code == 404
    assert client.get("/api/plans/../etc").status_code == 404


def test_closed_phases_become_visible_gaps(client):
    # Sunday 03:00: every cafe, library and coworking space in the fixture is shut; only the park is open.
    response = client.post("/api/plan", json=_plan_payload(query="a library for 2 hours", leave_at="2026-09-27T03:00:00"))
    assert response.status_code == 200, response.text
    body = response.json()
    assert [g["phase_key"] for g in body["itinerary"]["gaps"]] == ["work"]
    assert all(s["place"]["category"] != "library" for s in body["itinerary"]["stops"])


def test_nothing_nearby_is_an_honest_error(client):
    client.app.state.overpass.places = []
    response = client.post("/api/plan", json=_plan_payload(query="gym workout then swim"))
    assert response.status_code == 404
    assert response.json()["error"] in ("nothing_open", "nothing_nearby")
