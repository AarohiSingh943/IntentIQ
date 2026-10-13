import { colorOf, glyphOf } from "../lib/categories";
import { formatClock, formatDayLabel, formatDuration, formatKm } from "../lib/time";
import type { Factors, HoursState, Place, Stop, Transport } from "../lib/types";
import { useStore } from "../state/store";

const MODE_VERB: Record<Transport, string> = { walk: "walk", bike: "ride", drive: "drive" };
const FACTOR_LABEL: Record<keyof Factors, string> = { fit: "Fits the wish", timing: "Open when you arrive", proximity: "Close to the last stop", confidence: "Listing detail" };

function osmUrl(id: string): string {
  const kind = { n: "node", w: "way", r: "relation" }[id[0]] ?? "node";
  return `https://www.openstreetmap.org/${kind}/${id.slice(1)}`;
}

function directionsUrl(place: Place, mode: Transport): string {
  const travel = { walk: "walking", bike: "bicycling", drive: "driving" }[mode];
  return `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}&travelmode=${travel}`;
}

function Glyph({ category, size = 16 }: { category: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={glyphOf(category)} />
    </svg>
  );
}

function HoursPill({ hours, tz, from }: { hours: HoursState; tz: string; from?: string }) {
  if (hours.state === "open") {
    if (!hours.next_change) return <span className="pill pill--open">Open all hours</span>;
    const nextDay = from ? formatDayLabel(hours.next_change, tz) !== formatDayLabel(from, tz) : false;
    return <span className="pill pill--open">{`Open until ${formatClock(hours.next_change, tz)}${nextDay ? " tomorrow" : ""}`}</span>;
  }
  if (hours.state === "closed") return <span className="pill pill--closed">Closed then</span>;
  return <span className="pill pill--unknown">Hours not listed</span>;
}

function DetailChips({ place }: { place: Place }) {
  const t = place.tags;
  const chips: { key: string; text: string; href?: string }[] = [];
  if (t.cuisine) chips.push({ key: "cuisine", text: t.cuisine.split(";").slice(0, 2).join(", ").replace(/_/g, " ") });
  if (t.outdoor_seating === "yes") chips.push({ key: "outdoor", text: "Seats outside" });
  if (t.internet_access === "wlan" || t.internet_access === "yes") chips.push({ key: "wifi", text: "Wifi" });
  if (t.wheelchair === "yes") chips.push({ key: "wheelchair", text: "Step-free" });
  if (t["diet:vegetarian"] === "yes" || t["diet:vegetarian"] === "only") chips.push({ key: "veg", text: "Vegetarian options" });
  if (t["diet:vegan"] === "yes" || t["diet:vegan"] === "only") chips.push({ key: "vegan", text: "Vegan options" });
  if (t.live_music === "yes") chips.push({ key: "music", text: "Live music" });
  if (t.takeaway === "yes") chips.push({ key: "takeaway", text: "Takeaway" });
  if (t.reservation === "yes" || t.reservation === "recommended") chips.push({ key: "res", text: "Book ahead" });
  const site = t.website ?? t["contact:website"];
  if (site) chips.push({ key: "web", text: "Website", href: site.startsWith("http") ? site : `https://${site}` });
  const phone = t.phone ?? t["contact:phone"];
  if (phone) chips.push({ key: "phone", text: phone, href: `tel:${phone.replace(/\s+/g, "")}` });
  if (place.landmark) chips.push({ key: "landmark", text: "Landmark" });
  if (chips.length === 0) return null;
  return (
    <ul className="chips-inline">
      {chips.map((chip) => (
        <li key={chip.key}>{chip.href ? <a href={chip.href} target="_blank" rel="noopener noreferrer">{chip.text}</a> : chip.text}</li>
      ))}
    </ul>
  );
}

function FactorBars({ factors }: { factors: Factors }) {
  return (
    <ul className="factors" aria-label="Why this scored well">
      {(Object.keys(FACTOR_LABEL) as (keyof Factors)[]).map((key) => (
        <li key={key} className="factors__row">
          <span className="factors__label">{FACTOR_LABEL[key]}</span>
          <span className="factors__track" aria-hidden="true">
            <span className="factors__fill" style={{ width: `${Math.round(factors[key] * 100)}%` }} />
          </span>
          <span className="factors__value">{Math.round(factors[key] * 100)}</span>
        </li>
      ))}
    </ul>
  );
}

function StopRow({ stop, tz, mode, isFirst }: { stop: Stop; tz: string; mode: Transport; isFirst: boolean }) {
  const selected = useStore((s) => s.selectedStop === stop.order);
  const hovered = useStore((s) => s.hoverStop === stop.order);
  const selectStop = useStore((s) => s.selectStop);
  const setHoverStop = useStore((s) => s.setHoverStop);
  const pins = useStore((s) => s.overrides.pins);
  const pinAlternative = useStore((s) => s.pinAlternative);
  const unpin = useStore((s) => s.unpin);
  const skipPlace = useStore((s) => s.skipPlace);
  const busy = useStore((s) => s.status === "planning");
  const pinned = pins[stop.phase_key] === stop.place.id;
  const color = colorOf(stop.place.category);

  return (
    <li className={`stop ${selected ? "is-selected" : ""} ${hovered ? "is-hover" : ""}`} style={{ "--stop-color": color } as React.CSSProperties} onMouseEnter={() => setHoverStop(stop.order)} onMouseLeave={() => setHoverStop(null)}>
      <div className="leg">
        <span className="leg__thread" aria-hidden="true" />
        <span className="leg__text">
          {stop.leg.minutes} min {MODE_VERB[stop.leg.mode]}, {formatKm(stop.leg.km)}
          {isFirst ? " from your start" : ""}
        </span>
      </div>
      <button type="button" className="stop__head" onClick={() => selectStop(selected ? null : stop.order)} aria-expanded={selected}>
        <span className="stop__disc" aria-hidden="true">
          <span className="stop__num">{stop.order}</span>
          <span className="stop__glyph">
            <Glyph category={stop.place.category} size={13} />
          </span>
        </span>
        <span className="stop__main">
          <span className="stop__phase">{stop.phase_label}</span>
          <span className="stop__name">{stop.place.name}</span>
          <span className="stop__meta">
            <span>{stop.place.category_label}</span>
            <HoursPill hours={stop.hours_at_arrival} tz={tz} from={stop.arrive} />
            {pinned && <span className="pill pill--pinned">Pinned</span>}
          </span>
        </span>
        <span className="stop__time">
          <span>{formatClock(stop.arrive, tz)}</span>
          <span className="stop__time-sep" aria-hidden="true" />
          <span>{formatClock(stop.depart, tz)}</span>
        </span>
      </button>
      {selected && (
        <div className="stop__detail">
          <p className="stop__why">{stop.why}</p>
          <DetailChips place={stop.place} />
          {stop.notes.length > 0 && (
            <ul className="stop__notes">
              {stop.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          <FactorBars factors={stop.factors} />
          <div className="stop__actions">
            <a className="button button--ghost" href={directionsUrl(stop.place, mode)} target="_blank" rel="noopener noreferrer">
              Directions
            </a>
            <a className="button button--ghost" href={osmUrl(stop.place.id)} target="_blank" rel="noopener noreferrer">
              Listing
            </a>
            {pinned ? (
              <button type="button" className="button button--ghost" onClick={() => void unpin(stop.phase_key)} disabled={busy}>
                Unpin
              </button>
            ) : (
              <button type="button" className="button button--ghost" onClick={() => void pinAlternative(stop.phase_key, stop.place.id)} disabled={busy}>
                Keep this one
              </button>
            )}
            <button type="button" className="button button--ghost button--danger" onClick={() => void skipPlace(stop.place.id)} disabled={busy}>
              Not this place
            </button>
          </div>
          {stop.alternatives.length > 0 && (
            <div className="alternatives">
              <span className="alternatives__title">Instead, you could</span>
              <ul>
                {stop.alternatives.map((alt) => (
                  <li key={alt.id} className="alternative" style={{ "--stop-color": colorOf(alt.category) } as React.CSSProperties}>
                    <span className="alternative__glyph">
                      <Glyph category={alt.category} size={14} />
                    </span>
                    <span className="alternative__name">{alt.name}</span>
                    <span className="alternative__meta">
                      {alt.category_label}
                      <HoursPill hours={alt.hours} tz={tz} from={stop.arrive} />
                    </span>
                    <button type="button" className="button button--small" onClick={() => void pinAlternative(stop.phase_key, alt.id)} disabled={busy}>
                      Swap in
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function Itinerary() {
  const plan = useStore((s) => s.plan);
  if (!plan) return null;
  const { itinerary, intent, meta, counterfactuals } = plan;
  const tz = meta.timezone;

  return (
    <section className="itinerary" aria-label="Your itinerary">
      <ol className="stops">
        {itinerary.stops.map((stop, index) => (
          <StopRow key={`${stop.order}-${stop.place.id}`} stop={stop} tz={tz} mode={intent.transport} isFirst={index === 0} />
        ))}
      </ol>
      <p className="itinerary__summary">
        Ends {formatClock(itinerary.ends_at, tz)}, {formatDuration(itinerary.total_min)} in total with {formatDuration(itinerary.travel_min)} on the move over {formatKm(itinerary.distance_km)}.{" "}
        {meta.route_source === "osrm" ? "Streets from real routing." : "Distances are straight-line estimates."}
      </p>
      {itinerary.gaps.length > 0 && (
        <ul className="gaps" aria-label="Parts that could not be filled">
          {itinerary.gaps.map((gap) => (
            <li key={gap.phase_key}>
              <strong>{gap.phase_label}</strong> {gap.reason}
            </li>
          ))}
        </ul>
      )}
      {counterfactuals.length > 0 && (
        <div className="whatif">
          <h3 className="whatif__title">If things were different</h3>
          <ul>
            {counterfactuals.map((item) => (
              <li key={item.kind}>
                <span className="whatif__label">{item.label}</span>
                <span className="whatif__outcome">{item.outcome}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
