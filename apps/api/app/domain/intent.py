"""Intent compilation: a sentence becomes a structured, time-aware plan specification.

Two compilers cooperate. The deterministic rules compiler always runs and is the source of
truth for time, duration and explicit category mentions. A language model, when configured,
refines mood, companions and constraints; its output is validated and merged, never trusted
blindly.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.domain.taxonomy import CATEGORIES, CATEGORY_SYNONYMS

Mood = Literal[
    "unwind",
    "focus",
    "date",
    "celebrate",
    "nightlife",
    "explore",
    "culture",
    "family",
    "move",
    "quick_bite",
]
Transport = Literal["walk", "bike", "drive"]
Budget = Literal["low", "mid", "high"]
Companions = Literal["solo", "partner", "friends", "family"]
Energy = Literal["low", "mid", "high"]

MOODS: list[Mood] = [
    "unwind",
    "focus",
    "date",
    "celebrate",
    "nightlife",
    "explore",
    "culture",
    "family",
    "move",
    "quick_bite",
]


class Phase(BaseModel):
    key: str
    label: str
    categories: list[str]
    dwell_min: int = Field(ge=10, le=300)
    optional: bool = False


class IntentSpec(BaseModel):
    query: str
    summary: str
    mood: Mood
    arc: list[Phase]
    duration_min: int = Field(ge=30, le=720)
    start_time: datetime
    transport: Transport = "walk"
    budget: Budget | None = None
    companions: Companions | None = None
    energy: Energy = "mid"
    constraints: list[str] = Field(default_factory=list)
    explicit_categories: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1, default=0.5)
    source: Literal["rules", "llm+rules"] = "rules"
    query_start_was_now: bool = True

    @field_validator("constraints", "explicit_categories")
    @classmethod
    def _dedupe(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(v for v in value if v))


MOOD_LABELS: dict[str, str] = {
    "unwind": "Unwind",
    "focus": "Focus",
    "date": "Date",
    "celebrate": "Celebrate",
    "nightlife": "Night out",
    "explore": "Explore",
    "culture": "Culture",
    "family": "Family",
    "move": "Move",
    "quick_bite": "Quick bite",
}

MOOD_EXAMPLES: dict[str, str] = {
    "unwind": "A slow, quiet afternoon with a good coffee and somewhere green to sit",
    "focus": "Three hours of deep work somewhere with wifi, then a short walk to reset",
    "date": "First date tonight at 7, dinner then a walk with a view, nothing loud",
    "celebrate": "Birthday dinner for six, then cocktails, then wherever the night goes",
    "nightlife": "Bars from 9pm, somewhere to dance after, food at the end",
    "explore": "New in town with the whole afternoon, show me what this city is about",
    "culture": "A museum I would actually enjoy, a bookshop, then coffee to talk it over",
    "family": "Two kids under ten, a playground, lunch nearby and an ice cream",
    "move": "Morning swim or gym, then a proper breakfast",
    "quick_bite": "Twenty minutes, something good and fast near me",
}

_DEFAULT_DURATION: dict[str, int] = {
    "unwind": 120,
    "focus": 150,
    "date": 180,
    "celebrate": 240,
    "nightlife": 240,
    "explore": 210,
    "culture": 180,
    "family": 180,
    "move": 150,
    "quick_bite": 40,
}

_DEFAULT_ENERGY: dict[str, Energy] = {
    "unwind": "low",
    "focus": "low",
    "date": "mid",
    "celebrate": "high",
    "nightlife": "high",
    "explore": "mid",
    "culture": "low",
    "family": "mid",
    "move": "high",
    "quick_bite": "mid",
}


def _p(key: str, label: str, categories: list[str], dwell: int, optional: bool = False) -> Phase:
    return Phase(key=key, label=label, categories=categories, dwell_min=dwell, optional=optional)


MOOD_ARCS: dict[str, list[Phase]] = {
    "unwind": [
        _p("settle", "Settle in", ["cafe", "park"], 50),
        _p("breathe", "Take some air", ["park", "viewpoint", "nature"], 40, True),
        _p("sweet", "Something sweet", ["ice_cream", "dessert", "cafe"], 25, True),
    ],
    "focus": [
        _p("work", "Deep work", ["coworking", "library", "cafe"], 120),
        _p("reset", "Reset", ["park", "cafe"], 25, True),
    ],
    "date": [
        _p("open", "Ease in", ["cafe", "bar", "viewpoint"], 40, True),
        _p("dinner", "Dinner", ["restaurant"], 80),
        _p("stroll", "Walk it off", ["park", "viewpoint", "monument"], 30, True),
        _p("sweet", "Dessert", ["ice_cream", "dessert", "bar"], 30, True),
    ],
    "celebrate": [
        _p("dinner", "Dinner", ["restaurant"], 90),
        _p("drinks", "Drinks", ["bar", "nightclub"], 90),
        _p("late", "Late night", ["nightclub", "bar"], 90, True),
    ],
    "nightlife": [
        _p("warmup", "Warm up", ["bar"], 60),
        _p("main", "Main event", ["nightclub", "bar", "arcade"], 120),
        _p("refuel", "Refuel", ["fast_food", "restaurant"], 30, True),
    ],
    "explore": [
        _p("landmark", "A landmark", ["attraction", "monument", "viewpoint"], 40),
        _p("inside", "Step inside", ["museum", "market", "bookshop"], 70),
        _p("pause", "Pause", ["cafe", "park"], 40),
        _p("eat", "Eat local", ["restaurant", "market", "fast_food"], 60, True),
    ],
    "culture": [
        _p("see", "See something", ["museum", "monument", "attraction"], 90),
        _p("browse", "Browse", ["bookshop", "market"], 40, True),
        _p("talk", "Talk it over", ["cafe", "bar"], 45),
    ],
    "family": [
        _p("play", "Play", ["playground", "zoo", "park"], 80),
        _p("eat", "Eat together", ["restaurant", "fast_food", "food_court"], 60),
        _p("treat", "A treat", ["ice_cream", "dessert"], 25, True),
    ],
    "move": [
        _p("sweat", "Move", ["gym", "swimming", "park"], 70),
        _p("refuel", "Refuel", ["cafe", "restaurant"], 45, True),
        _p("recover", "Recover", ["spa", "park"], 45, True),
    ],
    "quick_bite": [
        _p("eat", "Eat", ["fast_food", "cafe", "restaurant", "food_court"], 30),
    ],
}

_MOOD_KEYWORDS: dict[str, list[str]] = {
    "unwind": ["unwind", "relax", "chill", "quiet", "calm", "slow", "peaceful", "lazy", "rest", "low key", "decompress", "tired", "sad", "down", "alone time"],
    "focus": ["work", "focus", "study", "laptop", "wifi", "deep work", "productive", "meeting", "write", "read", "deadline"],
    "date": ["date", "romantic", "anniversary", "partner", "girlfriend", "boyfriend", "wife", "husband", "candle", "first date"],
    "celebrate": ["celebrate", "birthday", "party", "promotion", "cheers", "anniversary dinner", "toast", "big night"],
    "nightlife": ["night out", "clubbing", "club", "dance", "bars", "bar hop", "drinks", "cocktails", "late night", "pub crawl"],
    "explore": ["explore", "new in town", "tourist", "wander", "discover", "show me", "what this city", "sightseeing", "landmark", "first time"],
    "culture": ["museum", "gallery", "art", "history", "culture", "exhibition", "bookshop", "theatre", "theater", "architecture"],
    "family": ["kids", "children", "family", "toddler", "playground", "zoo", "stroller", "son", "daughter"],
    "move": ["gym", "workout", "run", "swim", "exercise", "sweat", "hike", "active", "yoga", "fitness", "climb"],
    "quick_bite": ["quick bite", "quick", "fast", "grab", "snack", "hungry", "twenty minutes", "20 minutes", "on the go", "takeaway"],
}

_BUDGET_WORDS: dict[str, list[str]] = {
    "low": ["cheap", "budget", "broke", "affordable", "student", "low cost", "inexpensive", "no money"],
    "high": ["fancy", "luxury", "splurge", "expensive", "upscale", "fine dining", "treat myself", "posh", "premium"],
    "mid": ["mid range", "moderate", "reasonable"],
}
_COMPANION_WORDS: dict[str, list[str]] = {
    "family": ["kids", "children", "family", "parents", "toddler", "son", "daughter", "mom", "dad"],
    "partner": ["date", "partner", "girlfriend", "boyfriend", "wife", "husband", "romantic", "two of us"],
    "friends": ["friends", "mates", "group", "crew", "gang", "the boys", "the girls", "for six", "for four", "colleagues", "team"],
    "solo": ["alone", "solo", "by myself", "me time", "on my own"],
}
_TRANSPORT_WORDS: dict[str, list[str]] = {
    "drive": ["drive", "driving", "car", "cab", "taxi", "uber"],
    "bike": ["bike", "cycle", "cycling", "bicycle", "scooter"],
    "walk": ["walk", "walking", "on foot", "stroll"],
}
_CONSTRAINT_WORDS: dict[str, list[str]] = {
    "quiet": ["quiet", "calm", "not loud", "nothing loud", "peaceful", "silence"],
    "outdoor": ["outdoor", "outside", "open air", "fresh air", "terrace", "rooftop", "garden", "sunset"],
    "wifi": ["wifi", "wi-fi", "laptop", "internet", "outlets"],
    "vegetarian": ["vegetarian", "veg ", "veggie", "meat free"],
    "vegan": ["vegan", "plant based"],
    "wheelchair": ["wheelchair", "accessible", "step free", "step-free", "mobility"],
    "live_music": ["live music", "gig", "band"],
    "rain": ["rain", "raining", "wet", "indoor", "indoors"],
    "coffee": ["coffee", "espresso", "latte"],
    "late": ["late", "after midnight", "all night"],
}

_DURATION_RE = re.compile(
    r"(?:(?:for|have|got|about|around|roughly|next|with|in)\s+)?"
    r"(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|half an|a couple of|couple of)\s*"
    r"(hours?|hrs?|h\b|minutes?|mins?)"
)
_WORD_NUMBERS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "half an": 0.5, "a couple of": 2, "couple of": 2}
_TIME_RE = re.compile(
    r"\b(?:at|from|around|by|after)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b"
    r"|\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b"
)


def _contains_any(text: str, words: list[str]) -> int:
    return sum(1 for w in words if w in text)


def _parse_duration(text: str) -> int | None:
    m = _DURATION_RE.search(text)
    if not m:
        if "all day" in text or "whole day" in text:
            return 480
        if "all afternoon" in text or "whole afternoon" in text:
            return 240
        if "all evening" in text or "whole evening" in text or "the evening" in text:
            return 200
        if "all morning" in text or "whole morning" in text:
            return 180
        return None
    amount_raw, unit = m.group(1), m.group(2)
    amount = _WORD_NUMBERS.get(amount_raw)
    if amount is None:
        try:
            amount = float(amount_raw)
        except ValueError:
            return None
    minutes = amount * 60 if unit.startswith("h") else amount
    return int(max(30, min(720, minutes)))


def _parse_start_time(text: str, now: datetime) -> datetime | None:
    def build(hour: int, minute: int) -> datetime:
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if "tomorrow" in text or candidate < now - timedelta(minutes=20):
            candidate += timedelta(days=1)
        return candidate

    m = _TIME_RE.search(text)
    if m:
        hour = int(m.group(1) or m.group(4))
        minute = int(m.group(2) or m.group(5) or 0)
        meridiem = (m.group(3) or m.group(6) or "").replace(".", "")
        if meridiem == "pm" and hour < 12:
            hour += 12
        if meridiem == "am" and hour == 12:
            hour = 0
        if not meridiem and hour <= 7 and ("tonight" in text or "evening" in text or "pm" in text):
            hour += 12
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return build(hour, minute)
    if "tonight" in text or "this evening" in text:
        return build(19, 0) if now.hour < 18 else None
    if "tomorrow morning" in text:
        return build(10, 0)
    if "tomorrow evening" in text or "tomorrow night" in text:
        return build(19, 0)
    if "tomorrow" in text:
        return build(11, 0)
    if "this afternoon" in text and now.hour < 13:
        return build(14, 0)
    if "this morning" in text and now.hour < 9:
        return build(9, 30)
    return None


def _explicit_categories(text: str) -> list[str]:
    found: list[tuple[int, str]] = []
    for phrase, category in CATEGORY_SYNONYMS.items():
        pattern = r"\b" + re.escape(phrase) + r"s?\b"
        m = re.search(pattern, text)
        if m:
            found.append((m.start(), category))
    ordered = [c for _, c in sorted(found)]
    return list(dict.fromkeys(ordered))


def _round_up(now: datetime, step: int = 5) -> datetime:
    extra = (-now.minute) % step
    return (now + timedelta(minutes=extra)).replace(second=0, microsecond=0)


def _arc_for(mood: str, explicit: list[str], duration_min: int) -> list[Phase]:
    arc = [phase.model_copy(deep=True) for phase in MOOD_ARCS[mood]]
    unplaced: list[str] = []
    for category in explicit:
        placed = False
        for phase in arc:
            if category in phase.categories:
                phase.categories.remove(category)
                phase.categories.insert(0, category)
                phase.optional = False
                placed = True
                break
        if not placed:
            unplaced.append(category)
    for category in reversed(unplaced):
        cat = CATEGORIES[category]
        arc.insert(0, Phase(key=f"asked_{category}", label=cat.label, categories=[category], dwell_min=cat.dwell_min))
    if duration_min <= 60:
        arc = [phase for phase in arc if not phase.optional][:2]
    return arc


def build_arc(mood: str, explicit: list[str], duration_min: int) -> list[Phase]:
    return _arc_for(mood, explicit, duration_min)


def compile_with_rules(query: str, now: datetime) -> IntentSpec:
    text = " " + re.sub(r"\s+", " ", query.lower().strip()) + " "
    scores = {mood: _contains_any(text, words) for mood, words in _MOOD_KEYWORDS.items()}
    explicit = _explicit_categories(text)
    for category in explicit:
        for mood, phases in MOOD_ARCS.items():
            if any(category in phase.categories for phase in phases):
                scores[mood] += 0.35
    best_mood: str = max(scores, key=lambda m: (scores[m], -MOODS.index(m)))
    if scores[best_mood] == 0:
        best_mood = "explore"
    matched = scores[best_mood]
    confidence = 0.35 if matched == 0 else min(0.9, 0.55 + 0.12 * matched)

    duration = _parse_duration(text) or _DEFAULT_DURATION[best_mood]
    parsed_start = _parse_start_time(text, now)
    start = parsed_start or _round_up(now)
    transport: Transport = "walk"
    for mode, words in _TRANSPORT_WORDS.items():
        if _contains_any(text, words):
            transport = mode  # type: ignore[assignment]
            break
    budget = next((b for b, words in _BUDGET_WORDS.items() if _contains_any(text, words)), None)
    companions = next((c for c, words in _COMPANION_WORDS.items() if _contains_any(text, words)), None)
    constraints = [c for c, words in _CONSTRAINT_WORDS.items() if _contains_any(text, words)]
    energy = _DEFAULT_ENERGY[best_mood]
    if "quiet" in constraints or "tired" in text:
        energy = "low"

    arc = _arc_for(best_mood, explicit, duration)
    return IntentSpec(
        query=query.strip(),
        summary=_summarise(best_mood, duration, start, companions, constraints),
        mood=best_mood,  # type: ignore[arg-type]
        arc=arc,
        duration_min=duration,
        start_time=start,
        transport=transport,
        budget=budget,  # type: ignore[arg-type]
        companions=companions,  # type: ignore[arg-type]
        energy=energy,
        constraints=constraints,
        explicit_categories=explicit,
        confidence=round(confidence, 2),
        source="rules",
        query_start_was_now=parsed_start is None,
    )


def _summarise(mood: str, duration: int, start: datetime, companions: str | None, constraints: list[str]) -> str:
    hours = duration / 60
    length = f"{int(hours)}h" if hours.is_integer() else f"{hours:.1f}h".replace(".0h", "h")
    who = {"partner": "for two", "friends": "with friends", "family": "with family", "solo": "solo"}.get(companions or "", "")
    extras = ", ".join(c.replace("_", " ") for c in constraints[:3])
    pieces = [f"{MOOD_LABELS[mood]} for about {length}", f"starting {start.strftime('%H:%M')}"]
    if who:
        pieces.append(who)
    if extras:
        pieces.append(f"keeping it {extras}")
    return ", ".join(pieces) + "."


LLM_SCHEMA_HINT = {
    "mood": "one of " + ", ".join(MOODS),
    "duration_min": "integer minutes, null if not stated",
    "start_hour": "0-23 local hour if a start time is stated, else null",
    "start_minute": "0-59, else null",
    "transport": "walk | bike | drive | null",
    "budget": "low | mid | high | null",
    "companions": "solo | partner | friends | family | null",
    "energy": "low | mid | high",
    "constraints": "subset of " + ", ".join(_CONSTRAINT_WORDS),
    "categories": "ordered subset of " + ", ".join(CATEGORIES),
    "summary": "one warm sentence restating the plan in the second person, max 20 words",
    "confidence": "0..1",
}


def merge_llm(base: IntentSpec, llm: dict[str, Any] | None, now: datetime) -> IntentSpec:
    """Fold validated model output into the rules result. Rules keep priority for anything explicit."""
    if not llm:
        return base
    data = base.model_dump()
    text = base.query.lower()

    mood = llm.get("mood")
    if mood in MOODS and float(llm.get("confidence") or 0) >= 0.4:
        data["mood"] = mood
    if isinstance(llm.get("duration_min"), int | float) and _parse_duration(" " + text + " ") is None:
        data["duration_min"] = int(max(30, min(720, llm["duration_min"])))
    if _parse_start_time(" " + text + " ", now) is None and isinstance(llm.get("start_hour"), int):
        hour = llm["start_hour"]
        minute = llm.get("start_minute") if isinstance(llm.get("start_minute"), int) else 0
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if candidate < now - timedelta(minutes=20):
                candidate += timedelta(days=1)
            data["start_time"] = candidate
            data["query_start_was_now"] = False
    for field_name, allowed in (("transport", ("walk", "bike", "drive")), ("budget", ("low", "mid", "high")), ("companions", ("solo", "partner", "friends", "family")), ("energy", ("low", "mid", "high"))):
        value = llm.get(field_name)
        if value in allowed and (data.get(field_name) in (None, "mid", "walk") or field_name == "energy"):
            data[field_name] = value
    constraints = [c for c in (llm.get("constraints") or []) if isinstance(c, str) and c in _CONSTRAINT_WORDS]
    data["constraints"] = list(dict.fromkeys(list(data["constraints"]) + constraints))
    categories = [c for c in (llm.get("categories") or []) if isinstance(c, str) and c in CATEGORIES]
    explicit = list(dict.fromkeys(list(data["explicit_categories"]) + categories))[:4]
    data["explicit_categories"] = explicit
    data["arc"] = [p.model_dump() for p in _arc_for(data["mood"], explicit, data["duration_min"])]
    summary = llm.get("summary")
    if isinstance(summary, str) and 8 <= len(summary.strip()) <= 160:
        data["summary"] = summary.strip()
    else:
        data["summary"] = _summarise(data["mood"], data["duration_min"], data["start_time"], data["companions"], data["constraints"])
    data["confidence"] = round(max(base.confidence, min(1.0, float(llm.get("confidence") or 0.6))), 2)
    data["source"] = "llm+rules"
    return IntentSpec(**data)
