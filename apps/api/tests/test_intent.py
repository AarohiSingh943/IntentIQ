from datetime import datetime, timedelta

from app.domain.intent import compile_with_rules, merge_llm


def test_quiet_cafe_for_two_hours(now: datetime):
    intent = compile_with_rules("a quiet cafe to read for 2 hours", now)
    assert intent.duration_min == 120
    assert "cafe" in intent.explicit_categories
    assert "quiet" in intent.constraints
    assert intent.arc[0].categories[0] == "cafe"
    assert intent.start_time == now


def test_first_date_tonight_at_seven(now: datetime):
    intent = compile_with_rules("First date tonight at 7, dinner then a walk with a view, nothing loud", now)
    assert intent.mood == "date"
    assert intent.start_time.hour == 19
    assert intent.companions == "partner"
    assert "quiet" in intent.constraints
    assert "viewpoint" in intent.explicit_categories


def test_time_in_the_past_rolls_to_tomorrow(now: datetime):
    intent = compile_with_rules("brunch at 10am", now)
    assert intent.start_time.date() == (now + timedelta(days=1)).date()


def test_quick_bite_is_short(now: datetime):
    intent = compile_with_rules("twenty minutes, something fast and cheap near me", now)
    assert intent.mood == "quick_bite"
    assert intent.budget == "low"
    assert len(intent.arc) == 1


def test_unknown_text_falls_back_to_explore(now: datetime):
    intent = compile_with_rules("hmm not sure honestly", now)
    assert intent.mood == "explore"
    assert intent.confidence < 0.5


def test_llm_merge_respects_explicit_rules(now: datetime):
    base = compile_with_rules("dinner at 8pm for 2 hours", now)
    merged = merge_llm(
        base,
        {"mood": "celebrate", "confidence": 0.9, "duration_min": 400, "start_hour": 12, "companions": "friends", "constraints": ["outdoor", "bogus"], "categories": ["bar"], "summary": "Dinner and drinks with friends at eight."},
        now,
    )
    assert merged.mood == "celebrate"
    assert merged.duration_min == 120  # rules win on explicit duration
    assert merged.start_time.hour == 20  # rules win on explicit time
    assert merged.companions == "friends"
    assert merged.constraints == ["outdoor"]
    assert "bar" in merged.explicit_categories
    assert merged.source == "llm+rules"


def test_llm_merge_ignores_garbage(now: datetime):
    base = compile_with_rules("quiet afternoon", now)
    merged = merge_llm(base, {"mood": "nonsense", "duration_min": "long", "start_hour": 99, "summary": ""}, now)
    assert merged.mood == base.mood
    assert merged.duration_min == base.duration_min
    assert merged.start_time == base.start_time
