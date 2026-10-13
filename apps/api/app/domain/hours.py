"""A pragmatic parser for the common subset of the OpenStreetMap `opening_hours` syntax.

The goal is honesty rather than completeness: anything we cannot interpret is reported as
"unknown", never guessed. Supported: `24/7`, weekday ranges and lists (`Mo-Fr`, `Sa,Su`),
multiple time ranges per rule, ranges past midnight (`22:00-02:00`, `10:00-26:00`),
`off`/`closed`, rules separated by `;`, `PH`/`SH` (ignored), and fallback groups (`||`).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta

DAY_KEYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
_DAY_INDEX = {d: i for i, d in enumerate(DAY_KEYS)}
_TIME_RE = re.compile(r"^(\d{1,2})(?::(\d{2}))?$")
_RANGE_RE = re.compile(r"^(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)$")
_DAY_TOKEN_RE = re.compile(r"^(Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


@dataclass
class Rule:
    days: set[int]  # 0=Mo .. 6=Su
    ranges: list[tuple[int, int]]  # minutes from local midnight; end may exceed 1440
    closed: bool = False


@dataclass
class OpeningHours:
    raw: str
    rules: list[Rule] = field(default_factory=list)
    always_open: bool = False
    parseable: bool = False

    def intervals_for(self, weekday: int) -> list[tuple[int, int]]:
        """Open intervals (start, end) in minutes for a weekday, per OSM override semantics."""
        if self.always_open:
            return [(0, 1440)]
        selected: list[tuple[int, int]] | None = None
        for rule in self.rules:
            if weekday in rule.days:
                selected = [] if rule.closed else list(rule.ranges)
        return selected or []

    def state_at(self, moment: datetime) -> tuple[str, datetime | None]:
        """Return ("open"|"closed"|"unknown", next_change)."""
        if not self.parseable:
            return "unknown", None
        if self.always_open:
            return "open", None
        minute = moment.hour * 60 + moment.minute
        weekday = moment.weekday()
        midnight = moment.replace(hour=0, minute=0, second=0, microsecond=0)

        # Today's intervals plus yesterday's spilling past midnight.
        covering: list[tuple[int, int]] = []
        for start, end in self.intervals_for(weekday):
            covering.append((start, end))
        for start, end in self.intervals_for((weekday - 1) % 7):
            if end > 1440:
                covering.append((start - 1440, end - 1440))

        for start, end in covering:
            if start <= minute < end:
                return "open", midnight + timedelta(minutes=end)

        # Closed now: find the next opening within a week.
        for day_offset in range(0, 8):
            day = (weekday + day_offset) % 7
            for start, _end in sorted(self.intervals_for(day)):
                candidate = start + day_offset * 1440
                if candidate > minute:
                    return "closed", midnight + timedelta(minutes=candidate)
        return "closed", None


def _parse_time(token: str) -> int | None:
    m = _TIME_RE.match(token.strip())
    if not m:
        return None
    hour = int(m.group(1))
    minute = int(m.group(2) or 0)
    if hour > 48 or minute > 59:
        return None
    return hour * 60 + minute


def _parse_days(token: str) -> set[int] | None:
    days: set[int] = set()
    for part in token.split(","):
        part = part.strip()
        if not part:
            continue
        m = _DAY_TOKEN_RE.match(part)
        if not m:
            return None
        start, end = m.group(1), m.group(2)
        if start in ("PH", "SH"):
            continue  # public/school holidays are not modelled
        if end is None:
            days.add(_DAY_INDEX[start])
            continue
        i, j = _DAY_INDEX[start], _DAY_INDEX[end]
        if i <= j:
            days.update(range(i, j + 1))
        else:
            days.update(list(range(i, 7)) + list(range(0, j + 1)))
    return days


def _parse_rule(text: str) -> Rule | None:
    text = text.strip()
    if not text:
        return None
    if any(text.startswith(month) for month in _MONTHS) or re.search(r"\b(19|20)\d{2}\b", text):
        return None  # month/year selectors are outside the supported subset
    text = re.sub(r"\s*,\s*", ",", text)
    parts = text.split(" ", 1)
    days: set[int] | None = None
    rest = text
    if _DAY_TOKEN_RE.match(parts[0].split(",")[0]):
        days = _parse_days(parts[0])
        if days is None:
            return None
        rest = parts[1] if len(parts) > 1 else ""
    if days is None:
        days = set(range(7))
    rest = rest.strip()
    if rest.lower() in ("off", "closed"):
        return Rule(days=days, ranges=[], closed=True)
    if rest.lower() in ("open", "24/7"):
        return Rule(days=days, ranges=[(0, 1440)])
    if not rest:
        return None
    ranges: list[tuple[int, int]] = []
    for chunk in rest.split(","):
        m = _RANGE_RE.match(chunk.strip())
        if not m:
            return None
        start, end = _parse_time(m.group(1)), _parse_time(m.group(2))
        if start is None or end is None:
            return None
        if end <= start:
            end += 1440
        ranges.append((start, end))
    return Rule(days=days, ranges=ranges)


def parse_opening_hours(raw: str | None) -> OpeningHours:
    if not raw or not raw.strip():
        return OpeningHours(raw=raw or "", parseable=False)
    text = raw.strip()
    primary = text.split("||")[0].strip()
    if primary == "24/7":
        return OpeningHours(raw=text, always_open=True, parseable=True)
    rules: list[Rule] = []
    for segment in primary.split(";"):
        segment = segment.strip()
        if not segment:
            continue
        rule = _parse_rule(segment)
        if rule is None:
            return OpeningHours(raw=text, parseable=False)
        rules.append(rule)
    if not rules:
        return OpeningHours(raw=text, parseable=False)
    return OpeningHours(raw=text, rules=rules, parseable=True)
