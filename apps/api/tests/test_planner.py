from datetime import datetime, timedelta

from app.domain.explain import counterfactuals, explain_stop
from app.domain.intent import compile_with_rules
from app.domain.planner import plan

ORIGIN = (28.6139, 77.2090)


def test_closed_places_never_appear(now: datetime, sample_places):
    intent = compile_with_rules("a quiet cafe for 2 hours", now)
    itinerary = plan(intent, sample_places, ORIGIN)
    names = [s.place.name for s in itinerary.stops]
    assert "Closed Cafe" not in names
    assert "Night Owl Cafe" not in names
    assert itinerary.stops[0].place.category == "cafe"
    assert itinerary.stops[0].hours_at_arrival.state == "open"


def test_plan_respects_time_budget_and_orders_time(now: datetime, sample_places):
    intent = compile_with_rules("unwind for 3 hours", now)
    itinerary = plan(intent, sample_places, ORIGIN)
    assert itinerary.stops
    assert itinerary.ends_at <= intent.start_time + timedelta(minutes=intent.duration_min)
    for earlier, later in zip(itinerary.stops, itinerary.stops[1:], strict=False):
        assert later.arrive >= earlier.depart


def test_pins_force_a_place(now: datetime, sample_places):
    intent = compile_with_rules("unwind for 3 hours", now)
    itinerary = plan(intent, sample_places, ORIGIN, pins={"settle": "n2"})
    assert itinerary.stops[0].place.id == "n2"
    assert itinerary.stops[0].notes


def test_deterministic(now: datetime, sample_places):
    intent = compile_with_rules("date night dinner", now)
    a = plan(intent, sample_places, ORIGIN)
    b = plan(intent, sample_places, ORIGIN)
    assert [s.place.id for s in a.stops] == [s.place.id for s in b.stops]


def test_unknown_hours_are_flagged_not_hidden(now: datetime, sample_places):
    intent = compile_with_rules("unwind for 4 hours", now)
    itinerary = plan(intent, sample_places, ORIGIN)
    for stop in itinerary.stops:
        if stop.place.id == "n5":
            assert any("not listed" in n for n in stop.notes)


def test_explanations_and_counterfactuals(now: datetime, sample_places):
    intent = compile_with_rules("quiet cafe with wifi outside for 2 hours", now)
    itinerary = plan(intent, sample_places, ORIGIN)
    first = itinerary.stops[0]
    why = explain_stop(first, intent)
    assert why.endswith(".")
    assert "Open until" in why
    what_ifs = counterfactuals(intent, itinerary, sample_places, ORIGIN)
    kinds = {c.kind for c in what_ifs}
    assert "later_start" in kinds
