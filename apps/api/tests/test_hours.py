from datetime import datetime

from app.domain.hours import parse_opening_hours

WED_10 = datetime(2026, 9, 23, 10, 0)
WED_19 = datetime(2026, 9, 23, 19, 0)
SUN_11 = datetime(2026, 9, 27, 11, 0)
THU_01 = datetime(2026, 9, 24, 1, 0)


def test_weekday_rules_open_and_closed():
    hours = parse_opening_hours("Mo-Fr 09:00-18:00; Sa 10:00-14:00")
    assert hours.parseable
    state, next_change = hours.state_at(WED_10)
    assert state == "open"
    assert next_change == datetime(2026, 9, 23, 18, 0)
    state, next_change = hours.state_at(WED_19)
    assert state == "closed"
    assert next_change == datetime(2026, 9, 24, 9, 0)
    assert hours.state_at(SUN_11)[0] == "closed"


def test_always_open():
    hours = parse_opening_hours("24/7")
    assert hours.state_at(SUN_11) == ("open", None)


def test_range_past_midnight_counts_for_previous_day():
    hours = parse_opening_hours("Mo-Su 22:00-02:00")
    state, next_change = hours.state_at(THU_01)
    assert state == "open"
    assert next_change == datetime(2026, 9, 24, 2, 0)
    assert hours.state_at(WED_10)[0] == "closed"


def test_multiple_ranges_and_off_days():
    hours = parse_opening_hours("Mo-Sa 12:00-15:00,19:00-23:30; Su off")
    assert hours.state_at(datetime(2026, 9, 23, 13, 0))[0] == "open"
    assert hours.state_at(datetime(2026, 9, 23, 16, 0))[0] == "closed"
    assert hours.state_at(SUN_11)[0] == "closed"


def test_unsupported_syntax_is_unknown_not_guessed():
    for raw in ("sunrise-sunset", "Mo-Fr 09:00-18:00; Dec 25 off", "", None, "by appointment"):
        assert parse_opening_hours(raw).state_at(WED_10)[0] == "unknown"


def test_public_holiday_selector_ignored():
    hours = parse_opening_hours("Mo-Fr,PH 09:00-17:00")
    assert hours.state_at(WED_10)[0] == "open"
