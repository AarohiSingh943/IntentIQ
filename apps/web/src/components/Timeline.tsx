import { useMemo, useRef } from "react";
import { colorOf, glyphOf } from "../lib/categories";
import { formatClock } from "../lib/time";
import { useStore } from "../state/store";

const SPEEDS = [1, 2, 4];

function minutesFrom(start: string, iso: string): number {
  return (new Date(iso).getTime() - new Date(start).getTime()) / 60_000;
}

export function Timeline() {
  const plan = useStore((s) => s.plan);
  const playback = useStore((s) => s.playback);
  const setPlayback = useStore((s) => s.setPlayback);
  const selectedStop = useStore((s) => s.selectedStop);
  const selectStop = useStore((s) => s.selectStop);
  const setHoverStop = useStore((s) => s.setHoverStop);
  const ribbonRef = useRef<HTMLDivElement>(null);

  const model = useMemo(() => {
    if (!plan) return null;
    const start = plan.itinerary.starts_at;
    const total = Math.max(1, plan.itinerary.total_min);
    const pct = (minute: number) => `${Math.max(0, Math.min(100, (minute / total) * 100))}%`;
    const stops = plan.itinerary.stops.map((s) => ({ stop: s, left: minutesFrom(start, s.arrive), width: minutesFrom(s.arrive, s.depart) }));
    const hours: number[] = [];
    for (let m = 60 - (new Date(start).getMinutes() % 60); m < total; m += 60) hours.push(m);
    const sunset = plan.weather?.sunset ? minutesFrom(start, plan.weather.sunset) : null;
    const rainFrom = plan.weather?.rain_from ? Math.max(0, minutesFrom(start, plan.weather.rain_from)) : null;
    const now = minutesFrom(start, new Date().toISOString());
    return { start, total, pct, stops, hours, sunset: sunset !== null && sunset > 0 && sunset < total ? sunset : null, rainFrom: rainFrom !== null && rainFrom < total ? rainFrom : null, now: now > 0 && now < total ? now : null };
  }, [plan]);

  if (!plan || !model) return null;
  const tz = plan.meta.timezone;
  const clock = new Date(new Date(model.start).getTime() + playback.minute * 60_000).toISOString();

  const scrubTo = (clientX: number) => {
    const el = ribbonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setPlayback({ minute: fraction * model.total, playing: false });
  };

  return (
    <section className="timeline" aria-label="Plan timeline">
      <div className="timeline__controls">
        <button type="button" className="timeline__play" onClick={() => setPlayback({ playing: !playback.playing, minute: playback.minute >= model.total - 0.5 ? 0 : playback.minute, follow: true })} aria-pressed={playback.playing} title={playback.playing ? "Pause the walk" : "Walk the route"}>
          {playback.playing ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5h3v14H8zM13 5h3v14h-3z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4l13 8-13 8z" />
            </svg>
          )}
        </button>
        <span className="timeline__clock">{formatClock(clock, tz)}</span>
        <div className="timeline__speeds" role="group" aria-label="Playback speed">
          {SPEEDS.map((speed) => (
            <button key={speed} type="button" className="timeline__speed" aria-pressed={playback.speed === speed} onClick={() => setPlayback({ speed })}>
              {speed}x
            </button>
          ))}
        </div>
        <button type="button" className="timeline__follow" aria-pressed={playback.follow} onClick={() => setPlayback({ follow: !playback.follow })} title="Camera follows the walk">
          Follow
        </button>
      </div>
      <div
        className="timeline__ribbon"
        ref={ribbonRef}
        onPointerDown={(event) => {
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          scrubTo(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) scrubTo(event.clientX);
        }}
        role="slider"
        aria-label="Scrub through the plan"
        aria-valuemin={0}
        aria-valuemax={model.total}
        aria-valuenow={Math.round(playback.minute)}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") setPlayback({ minute: Math.min(model.total, playback.minute + 5), playing: false });
          if (event.key === "ArrowLeft") setPlayback({ minute: Math.max(0, playback.minute - 5), playing: false });
        }}
      >
        {model.rainFrom !== null && <div className="timeline__rain" style={{ left: model.pct(model.rainFrom) }} title="Rain likely from here" />}
        <div className="timeline__travel" />
        {model.hours.map((m) => (
          <span key={m} className="timeline__hour" style={{ left: model.pct(m) }}>
            {formatClock(new Date(new Date(model.start).getTime() + m * 60_000).toISOString(), tz)}
          </span>
        ))}
        {model.stops.map(({ stop, left, width }) => (
          <button
            key={stop.order}
            type="button"
            className={`timeline__stop ${selectedStop === stop.order ? "is-selected" : ""}`}
            style={{ left: model.pct(left), width: model.pct(width), background: colorOf(stop.place.category) }}
            onClick={(event) => {
              event.stopPropagation();
              selectStop(selectedStop === stop.order ? null : stop.order);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseEnter={() => setHoverStop(stop.order)}
            onMouseLeave={() => setHoverStop(null)}
            title={`${stop.place.name}, ${formatClock(stop.arrive, tz)} to ${formatClock(stop.depart, tz)}`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={glyphOf(stop.place.category)} />
            </svg>
            <span>{stop.place.name}</span>
          </button>
        ))}
        {model.sunset !== null && (
          <span className="timeline__sunset" style={{ left: model.pct(model.sunset) }} title={`Sunset ${formatClock(plan.weather!.sunset!, tz)}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 17h16M7 13a5 5 0 0 1 10 0M12 3v4M5 8l2 2M19 8l-2 2" />
            </svg>
          </span>
        )}
        {model.now !== null && <span className="timeline__now" style={{ left: model.pct(model.now) }} title="Now" />}
        <span className="timeline__head" style={{ left: model.pct(playback.minute) }} />
      </div>
    </section>
  );
}
