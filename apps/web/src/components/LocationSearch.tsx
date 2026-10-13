import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { searchPlaces } from "../lib/api";
import type { GeoHit } from "../lib/types";
import { useStore } from "../state/store";

export function LocationSearch({ compact = false }: { compact?: boolean }) {
  const origin = useStore((s) => s.origin);
  const startLabel = useStore((s) => s.startLabel);
  const chooseStart = useStore((s) => s.chooseStart);
  const useMyLocation = useStore((s) => s.useMyLocation);
  const status = useStore((s) => s.status);
  const [text, setText] = useState("");
  const [hits, setHits] = useState<GeoHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = text.trim();
    if (query.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setSearching(true);
      try {
        const found = await searchPlaces(query, { lat: origin.lat, lon: origin.lon }, controller.signal);
        if (!controller.signal.aborted) {
          setHits(found);
          setActive(0);
          setOpen(true);
        }
      } catch {
        if (!controller.signal.aborted) setHits([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 240);
    return () => window.clearTimeout(timer);
  }, [text, origin.lat, origin.lon]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (hit: GeoHit) => {
    chooseStart(hit);
    setText("");
    setHits([]);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open || hits.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(hits[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const current = startLabel ?? (origin.source === "default" ? "New Delhi (default)" : `${origin.lat.toFixed(4)}, ${origin.lon.toFixed(4)}`);
  const sourceNote = { gps: "your location", map: "a pin you placed", search: "your search", saved: "last time", default: "the default", shared: "the shared plan", history: "a recent plan" }[origin.source];

  return (
    <div className={`start ${compact ? "start--compact" : ""}`} ref={wrapRef}>
      <div className="start__current">
        <span className="start__pin" aria-hidden="true" />
        <span className="start__text">
          <span className="start__label">Starting from</span>
          <span className="start__value" title={`From ${sourceNote}`}>
            {current}
          </span>
        </span>
        <button type="button" className="button button--ghost button--small" onClick={() => void useMyLocation()} disabled={status === "locating"}>
          {status === "locating" ? "Locating" : "Use my location"}
        </button>
      </div>
      <div className="start__search">
        <input
          type="search"
          className="start__input"
          value={text}
          placeholder="Search any city, neighbourhood or landmark on Earth"
          aria-label="Search for a starting place"
          autoComplete="off"
          onChange={(event) => setText(event.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {searching && <span className="start__spinner" aria-hidden="true" />}
        {open && hits.length > 0 && (
          <ul className="start__results" role="listbox">
            {hits.map((hit, index) => (
              <li key={`${hit.lat},${hit.lon}`} role="option" aria-selected={index === active}>
                <button type="button" className={`start__hit ${index === active ? "is-active" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => pick(hit)}>
                  <span className="start__hit-name">{hit.name}</span>
                  <span className="start__hit-meta">
                    {hit.kind}
                    {hit.label.includes(",") ? `, ${hit.label.split(",").slice(1).join(",").trim()}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && hits.length === 0 && text.trim().length >= 2 && !searching && <div className="start__empty">Nothing found for that. Try the city name.</div>}
      </div>
    </div>
  );
}
