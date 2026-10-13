import { colorOf, glyphOf } from "../lib/categories";
import { relativeTime } from "../lib/history";
import { formatDuration } from "../lib/time";
import { useStore } from "../state/store";
import { Controls } from "./Controls";
import { EngineTrace } from "./EngineTrace";
import { IntentSummary } from "./IntentSummary";
import { Itinerary } from "./Itinerary";
import { LocationSearch } from "./LocationSearch";
import { Prompt } from "./Prompt";

function History() {
  const history = useStore((s) => s.history);
  const openHistory = useStore((s) => s.openHistory);
  const busy = useStore((s) => s.status === "planning" || s.status === "locating");
  if (history.length === 0) return null;
  return (
    <section className="history" aria-label="Your recent plans">
      <h2 className="history__title">Pick up where you left off</h2>
      <ul>
        {history.slice(0, 4).map((entry) => (
          <li key={`${entry.at}-${entry.query}`}>
            <button type="button" className="history__item" onClick={() => void openHistory(entry)} disabled={busy}>
              <span className="history__query">{entry.query}</span>
              <span className="history__meta">
                {entry.label ? `${entry.label.split(",")[0]}, ` : ""}
                {formatDuration(entry.totalMin)}, {relativeTime(entry.at)}
              </span>
              <span className="history__stops" aria-hidden="true">
                {entry.stops.slice(0, 5).map((s, i) => (
                  <svg key={i} viewBox="0 0 24 24" style={{ color: colorOf(s.category) }}>
                    <path d={glyphOf(s.category)} />
                  </svg>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Panel() {
  const status = useStore((s) => s.status);
  const plan = useStore((s) => s.plan);
  const error = useStore((s) => s.error);
  const expanded = useStore((s) => s.panelExpanded);
  const setPanelExpanded = useStore((s) => s.setPanelExpanded);
  const compose = useStore((s) => s.compose);
  const reset = useStore((s) => s.reset);

  const hasPlan = plan !== null && (status === "ready" || status === "planning");
  const working = (status === "planning" || status === "locating") && !plan;

  return (
    <aside className={`panel ${expanded ? "is-expanded" : "is-collapsed"} ${hasPlan ? "has-plan" : ""}`} aria-label="Plan">
      <button type="button" className="panel__handle" onClick={() => setPanelExpanded(!expanded)} aria-label={expanded ? "Collapse the plan" : "Expand the plan"}>
        <span />
      </button>
      <div className="panel__scroll">
        {!hasPlan && !working && (
          <>
            <h1 className="hero">
              Where should the <em>next few hours</em> go?
            </h1>
            <p className="hero__lede">Anywhere on Earth. One sentence in, a timed route through real streets out, every stop explained.</p>
            <LocationSearch />
          </>
        )}
        <Prompt compact={hasPlan} />
        {working && <EngineTrace />}
        {status === "planning" && plan && (
          <div className="replanning" role="status">
            Recomposing
          </div>
        )}
        {status === "error" && error && (
          <div className="error" role="alert">
            <p className="error__title">{errorTitle(error.code)}</p>
            <p>{error.detail}</p>
            <div className="error__actions">
              <button type="button" className="button button--primary" onClick={() => void compose()}>
                Try again
              </button>
              <button type="button" className="button button--ghost" onClick={reset}>
                Start over
              </button>
            </div>
          </div>
        )}
        {!hasPlan && !working && <History />}
        {hasPlan && (
          <>
            <IntentSummary />
            <LocationSearch compact />
            <Controls />
            <Itinerary />
          </>
        )}
      </div>
    </aside>
  );
}

function errorTitle(code: string): string {
  switch (code) {
    case "map_data_unavailable":
      return "The map servers are busy";
    case "nothing_nearby":
      return "Nothing of that kind nearby";
    case "nothing_open":
      return "Nothing open in that window";
    case "rate_limited":
      return "Too many plans too quickly";
    case "not_found":
      return "That plan does not exist";
    default:
      return "The plan could not be made";
  }
}
