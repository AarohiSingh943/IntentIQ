import { formatClock, formatDayLabel, formatDuration } from "../lib/time";
import type { WeatherSummary } from "../lib/types";
import { useStore } from "../state/store";

const COMPANIONS: Record<string, string> = { solo: "on your own", partner: "for two", friends: "with friends", family: "with family" };
const BUDGET: Record<string, string> = { low: "keeping it cheap", mid: "mid-range", high: "no expense spared" };

const WEATHER_GLYPH: Record<WeatherSummary["icon"], string> = {
  clear: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  partly: "M6 15a4 4 0 0 1 .5-8A5 5 0 0 1 16 8a3.5 3.5 0 0 1 1 6.9H6zM16 4l.7 1.7M19.5 6l-1.5 1",
  cloudy: "M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4 4 0 0 1 0 9z",
  fog: "M4 10h16M6 14h12M8 18h8M7 7a5 5 0 0 1 10 0",
  drizzle: "M7 14a4 4 0 0 1-.5-8A6 6 0 0 1 18 5a4 4 0 0 1 0 9zM9 17l-1 2M13 17l-1 2M17 17l-1 2",
  rain: "M7 13a4 4 0 0 1-.5-8A6 6 0 0 1 18 4a4 4 0 0 1 0 9zM8 16l-2 4M12 16l-2 4M16 16l-2 4",
  snow: "M7 13a4 4 0 0 1-.5-8A6 6 0 0 1 18 4a4 4 0 0 1 0 9zM8 17h.01M12 19h.01M16 17h.01M10 21h.01M14 21h.01",
  storm: "M7 13a4 4 0 0 1-.5-8A6 6 0 0 1 18 4a4 4 0 0 1 0 9zM13 12l-3 5h4l-3 5",
};

function WeatherCard({ weather, tz }: { weather: WeatherSummary; tz: string }) {
  return (
    <div className={`weather weather--${weather.icon}`}>
      <svg className="weather__glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d={WEATHER_GLYPH[weather.icon]} />
      </svg>
      <div className="weather__main">
        <span className="weather__temp">{Math.round(weather.temp_c)}°</span>
        <span className="weather__label">
          {weather.label}
          {weather.precip_prob >= 20 ? `, ${weather.precip_prob}% chance of rain` : ""}
        </span>
        {weather.sunset && (
          <span className="weather__sun">
            {weather.dark_at_start ? "After dark" : `Sunset ${formatClock(weather.sunset, tz)}`}
            {weather.sunset_in_window ? ", inside your plan" : ""}
          </span>
        )}
      </div>
      {weather.advice.length > 0 && (
        <ul className="weather__advice">
          {weather.advice.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IntentSummary() {
  const plan = useStore((s) => s.plan);
  const meta = useStore((s) => s.meta);
  const startLabel = useStore((s) => s.startLabel);
  if (!plan) return null;
  const { intent } = plan;
  const tz = plan.meta.timezone;
  const moodLabel = meta?.moods.find((m) => m.key === intent.mood)?.label ?? intent.mood;
  const facts = [
    moodLabel,
    `${formatClock(intent.start_time, tz)} ${formatDayLabel(intent.start_time, tz)}`,
    formatDuration(intent.duration_min),
    intent.transport === "walk" ? "on foot" : intent.transport === "bike" ? "by bike" : "by car",
    intent.companions ? COMPANIONS[intent.companions] : null,
    intent.budget ? BUDGET[intent.budget] : null,
    ...intent.constraints.map((c) => (c === "rain" ? "indoors preferred" : c.replace("_", " "))),
  ].filter((x): x is string => Boolean(x));

  return (
    <header className="intent">
      <p className="intent__summary">{intent.summary}</p>
      {(plan.start_label ?? startLabel) && <p className="intent__start">From {plan.start_label ?? startLabel}</p>}
      <ul className="intent__facts">
        {facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      {plan.weather && <WeatherCard weather={plan.weather} tz={tz} />}
      <p className="intent__source">
        {plan.meta.llm ? `Understood with ${plan.meta.llm === "gemini" ? "Gemini" : "Claude"} and rules` : "Understood with rules"}, {plan.meta.candidate_count} places considered within {plan.meta.radius_km} km
        {plan.meta.from_cache ? ", from cache" : ""}.
      </p>
    </header>
  );
}
