import { getMapHandle } from "../map/handle";
import { PALETTES, type StyleKey } from "../map/styles";
import { useStore } from "../state/store";

export function TopBar() {
  const plan = useStore((s) => s.plan);
  const setShareOpen = useStore((s) => s.setShareOpen);
  const reset = useStore((s) => s.reset);
  const meta = useStore((s) => s.meta);
  const styleKey = useStore((s) => s.styleKey);
  const setStyle = useStore((s) => s.setStyle);

  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={reset} aria-label="Intentra, start over">
        <span className="brand__mark" aria-hidden="true" />
        <span className="brand__name">Intentra</span>
      </button>
      <div className="topbar__right">
        {meta && <span className="topbar__status">{meta.llm.ready ? `Reading with ${meta.llm.provider === "gemini" ? "Gemini" : "Claude"}` : "Reading with rules only"}</span>}
        <div className="styles" role="group" aria-label="Map look">
          {(Object.keys(PALETTES) as StyleKey[]).map((key) => (
            <button key={key} type="button" className="styles__swatch" aria-pressed={styleKey === key} onClick={() => setStyle(key)} title={PALETTES[key].label} style={{ "--swatch-a": PALETTES[key].background, "--swatch-b": PALETTES[key].routeCore } as React.CSSProperties}>
              <span />
              {PALETTES[key].label}
            </button>
          ))}
        </div>
        {plan && (
          <button type="button" className="button button--primary" onClick={() => setShareOpen(true)}>
            Share
          </button>
        )}
      </div>
    </header>
  );
}

export function MapTools() {
  const plan = useStore((s) => s.plan);
  const pulse = useStore((s) => s.pulse);
  const relief = useStore((s) => s.relief);
  const togglePulse = useStore((s) => s.togglePulse);
  const toggleRelief = useStore((s) => s.toggleRelief);
  const requestTour = useStore((s) => s.requestTour);
  const requestFit = useStore((s) => s.requestFit);
  const tourActive = useStore((s) => s.tourActive);
  const playing = useStore((s) => s.playback.playing);
  const setPlayback = useStore((s) => s.setPlayback);
  const playbackMinute = useStore((s) => s.playback.minute);

  const toggleTilt = () => {
    const map = getMapHandle();
    if (!map) return;
    const flat = map.getPitch() < 10;
    map.easeTo({ pitch: flat ? 60 : 0, bearing: flat ? -18 : 0, duration: 700 });
  };
  const recenter = () => {
    const map = getMapHandle();
    const { origin } = useStore.getState();
    map?.easeTo({ center: [origin.lon, origin.lat], zoom: Math.max(map.getZoom(), 14.5), pitch: 55, duration: 900 });
  };

  return (
    <nav className="maptools" aria-label="Map tools">
      {plan && (
        <>
          <button type="button" className="tool" onClick={requestTour} aria-pressed={tourActive} title="Fly through the route">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 18 9 6l4 8 3-4 4 8" />
            </svg>
            <span>Fly through</span>
          </button>
          <button type="button" className="tool" onClick={() => setPlayback({ playing: !playing, follow: true, minute: playbackMinute >= (plan.itinerary.total_min || 1) - 0.5 ? 0 : playbackMinute })} aria-pressed={playing} title="Walk the route in fast time">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="13" cy="4.5" r="1.5" />
              <path d="M10 21l2-6 3 2v4M8 13l3-5 3 1 3 3M11 8l-3 1-2 3" />
            </svg>
            <span>{playing ? "Pause" : "Walk it"}</span>
          </button>
          <button type="button" className="tool" onClick={togglePulse} aria-pressed={pulse} title="Show every place that was considered">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <circle cx="12" cy="12" r="8" />
            </svg>
            <span>Pulse</span>
          </button>
          <button type="button" className="tool" onClick={requestFit} title="Fit the whole route">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
            </svg>
            <span>Fit route</span>
          </button>
        </>
      )}
      <button type="button" className="tool" onClick={toggleRelief} aria-pressed={relief} title="Raise hills and valleys">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 18l5-8 3 4 3-6 7 10z" />
        </svg>
        <span>Relief</span>
      </button>
      <button type="button" className="tool" onClick={toggleTilt} title="Tilt the city">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 17 12 4l9 13zM7 17v3M17 17v3" />
        </svg>
        <span>Tilt</span>
      </button>
      <button type="button" className="tool" onClick={recenter} title="Back to your start">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="6" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
        <span>Start</span>
      </button>
    </nav>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <button key={toast.id} type="button" className={`toast toast--${toast.tone}`} onClick={() => dismiss(toast.id)}>
          {toast.text}
        </button>
      ))}
    </div>
  );
}
