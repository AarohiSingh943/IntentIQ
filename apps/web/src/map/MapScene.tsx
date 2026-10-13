import type { FeatureCollection } from "geojson";
import { AttributionControl, LngLatBounds, Map as MapLibreMap, Marker, Popup, type GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./worker";
import { useEffect, useRef, useState } from "react";
import { categoryColorExpression, colorOf, glyphSvg } from "../lib/categories";
import { buildTimedPath, lerpBearing, positionAt, type TimedPath } from "../lib/playback";
import type { PlanResponse } from "../lib/types";
import { useStore } from "../state/store";
import { REDUCED_MOTION, fitToPlan, flyThrough, panelPadding } from "./camera";
import { setMapHandle } from "./handle";
import { PALETTES, buildStyle, type Palette } from "./styles";

const DASH_SEQUENCE: number[][] = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
];
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const PLAN_MINUTES_PER_SECOND = 4; // at speed 1, a three-hour plan plays in 45 seconds

function planBounds(plan: PlanResponse, origin: [number, number]): LngLatBounds {
  const bounds = new LngLatBounds(origin, origin);
  for (const stop of plan.itinerary.stops) {
    bounds.extend([stop.place.lon, stop.place.lat]);
    for (const point of stop.leg.geometry) bounds.extend(point as [number, number]);
  }
  return bounds;
}

function routeFeatures(plan: PlanResponse): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: plan.itinerary.stops.map((stop) => ({
      type: "Feature",
      properties: { order: stop.order, source: stop.leg.source },
      geometry: { type: "LineString", coordinates: stop.leg.geometry },
    })),
  };
}

function candidateFeatures(plan: PlanResponse): FeatureCollection {
  const chosen = new Set(plan.itinerary.stops.map((s) => s.place.id));
  return {
    type: "FeatureCollection",
    features: plan.candidates
      .filter((c) => !chosen.has(c.id))
      .map((c) => ({
        type: "Feature",
        properties: { id: c.id, name: c.name, category: c.category, category_label: c.category_label, state: c.state, confidence: c.confidence },
        geometry: { type: "Point", coordinates: [c.lon, c.lat] },
      })),
  };
}

function addPlanLayers(map: MapLibreMap, palette: Palette) {
  if (!map.getSource("candidates")) map.addSource("candidates", { type: "geojson", data: EMPTY });
  if (!map.getSource("route")) map.addSource("route", { type: "geojson", data: EMPTY });
  const [h1, h2, h3, h4] = palette.heat;
  map.addLayer({
    id: "pulse-heat",
    type: "heatmap",
    source: "candidates",
    maxzoom: 18,
    paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["get", "confidence"], 0.2, 0.25, 1, 1],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 11, 0.5, 16, 1.3],
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.15, h1, 0.4, h2, 0.7, h3, 1, h4],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 11, 12, 14, 26, 17, 48],
      "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.8, 17, 0.35],
    },
  });
  map.addLayer({
    id: "candidate-dots",
    type: "circle",
    source: "candidates",
    minzoom: 13,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2.2, 17, 5],
      "circle-color": categoryColorExpression("category") as never,
      "circle-opacity": ["match", ["get", "state"], "closed", 0.35, 0.9],
      "circle-stroke-color": palette.halo,
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: "route-glow",
    type: "line",
    source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": palette.routeGlow, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 6, 17, 16], "line-blur": 10, "line-opacity": 0.38 },
  });
  map.addLayer({
    id: "route-core",
    type: "line",
    source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": palette.routeCore, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 17, 4.5], "line-opacity": 0.95 },
  });
  map.addLayer({
    id: "route-dash",
    type: "line",
    source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": palette.routeDash, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.2, 17, 2.4], "line-dasharray": [0, 4, 3], "line-opacity": 0.9 },
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

export function MapScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const originMarkerRef = useRef<Marker | null>(null);
  const travellerRef = useRef<Marker | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const tourAbortRef = useRef<AbortController | null>(null);
  const spinningRef = useRef(false);
  const pathRef = useRef<TimedPath | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [layersVersion, setLayersVersion] = useState(0);

  const plan = useStore((s) => s.plan);
  const status = useStore((s) => s.status);
  const origin = useStore((s) => s.origin);
  const selectedStop = useStore((s) => s.selectedStop);
  const hoverStop = useStore((s) => s.hoverStop);
  const pulse = useStore((s) => s.pulse);
  const relief = useStore((s) => s.relief);
  const styleKey = useStore((s) => s.styleKey);
  const tourRequested = useStore((s) => s.tourRequested);
  const fitRequested = useStore((s) => s.fitRequested);
  const flyToOriginRequested = useStore((s) => s.flyToOriginRequested);
  const tourActive = useStore((s) => s.tourActive);
  const playing = useStore((s) => s.playback.playing);
  const playbackMinute = useStore((s) => s.playback.minute);
  const playbackSpeed = useStore((s) => s.playback.speed);
  const follow = useStore((s) => s.playback.follow);

  const stopSpin = () => {
    spinningRef.current = false;
  };

  // Create the map once: a slowly turning globe until a start is chosen.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const { origin: initialOrigin, styleKey: initialStyle } = useStore.getState();
    const palette = PALETTES[initialStyle];
    document.documentElement.dataset.theme = palette.theme;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: buildStyle(palette),
      center: [initialOrigin.lon, 18],
      zoom: 1.6,
      pitch: 0,
      bearing: 0,
      maxPitch: 75,
      canvasContextAttributes: { antialias: true },
      attributionControl: false,
      fadeDuration: 200,
    });
    map.addControl(new AttributionControl({ compact: true }), "bottom-left");
    map.on("load", () => {
      addPlanLayers(map, palette);
      setLoaded(true);
    });
    map.on("error", (event: { error?: unknown }) => {
      if (event.error && !/AbortError/.test(String(event.error))) console.warn("map", event.error);
    });
    const interrupt = () => {
      tourAbortRef.current?.abort();
      stopSpin();
      const store = useStore.getState();
      if (store.playback.playing && store.playback.follow) store.setPlayback({ follow: false });
    };
    map.on("dragstart", interrupt);
    map.on("wheel", interrupt);
    map.on("touchstart", interrupt);
    map.on("click", () => useStore.getState().setContextMenu(null));
    map.on("contextmenu", (event: MapMouseEvent) => {
      event.preventDefault();
      useStore.getState().setContextMenu({ x: event.point.x, y: event.point.y, lat: event.lngLat.lat, lon: event.lngLat.lng });
    });

    map.on("mouseenter", "candidate-dots", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "candidate-dots", () => (map.getCanvas().style.cursor = ""));
    map.on("click", "candidate-dots", (event: MapMouseEvent) => {
      const feature = map.queryRenderedFeatures(event.point, { layers: ["candidate-dots"] })[0];
      if (!feature) return;
      const props = feature.properties as { id: string; name: string; category: string; category_label: string; state: string };
      const state = props.state === "open" ? "Open at your start time" : props.state === "closed" ? "Closed at your start time" : "Hours not listed";
      popupRef.current?.remove();
      popupRef.current = new Popup({ closeButton: false, className: "intentra-popup", offset: 10 })
        .setLngLat(event.lngLat)
        .setHTML(
          `<div class="intentra-popup__row"><span class="intentra-popup__glyph" style="color:${colorOf(props.category)}">${glyphSvg(props.category, 16)}</span><strong>${escapeHtml(props.name)}</strong></div><span>${escapeHtml(props.category_label)}</span><em data-state="${props.state}">${state}</em>`,
        )
        .addTo(map);
    });

    mapRef.current = map;
    setMapHandle(map);
    return () => {
      tourAbortRef.current?.abort();
      stopSpin();
      setMapHandle(null);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Idle: keep the globe turning until there is somewhere to go.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const shouldSpin = !plan && status === "idle" && (origin.source === "default" || origin.source === "saved") && !REDUCED_MOTION;
    if (!shouldSpin) {
      stopSpin();
      return;
    }
    spinningRef.current = true;
    const spin = () => {
      if (!spinningRef.current || !mapRef.current) return;
      const center = map.getCenter();
      map.easeTo({ center: [center.lng + 24, 18], zoom: 1.6, pitch: 0, bearing: 0, duration: 14000, easing: (t) => t, essential: true });
    };
    const onMoveEnd = () => {
      if (spinningRef.current) spin();
    };
    map.on("moveend", onMoveEnd);
    spin();
    return () => {
      map.off("moveend", onMoveEnd);
      spinningRef.current = false;
      map.stop();
    };
  }, [loaded, plan, status, origin.source]);

  // Fly from wherever we are to a newly chosen start.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || flyToOriginRequested === 0) return;
    stopSpin();
    tourAbortRef.current?.abort();
    const { origin: target } = useStore.getState();
    map.flyTo({ center: [target.lon, target.lat], zoom: 13.8, pitch: 52, bearing: -18, duration: REDUCED_MOTION ? 0 : 3200, curve: 1.3, essential: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToOriginRequested, loaded]);

  // Switch cartography; plan layers come back after the new style loads.
  const initialStyleRef = useRef(styleKey);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || initialStyleRef.current === styleKey) return;
    initialStyleRef.current = styleKey;
    const palette = PALETTES[styleKey];
    document.documentElement.dataset.theme = palette.theme;
    map.once("style.load", () => {
      addPlanLayers(map, palette);
      if (useStore.getState().relief) map.setTerrain({ source: "terrain", exaggeration: 1.4 });
      setLayersVersion((v) => v + 1);
    });
    map.setStyle(buildStyle(palette));
  }, [styleKey, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    map.setTerrain(relief ? { source: "terrain", exaggeration: 1.4 } : null);
  }, [relief, loaded, layersVersion]);

  // Draggable origin pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!originMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "origin-marker";
      el.setAttribute("title", "Where your plan starts. Drag to move.");
      const marker = new Marker({ element: el, draggable: true, anchor: "center" }).setLngLat([origin.lon, origin.lat]).addTo(map);
      marker.on("dragstart", stopSpin);
      marker.on("dragend", () => {
        const { lng, lat } = marker.getLngLat();
        const store = useStore.getState();
        store.setOrigin(lat, lng, "map");
        if (store.plan) void store.replan({});
        else store.toast("Start moved. Your plan will begin here.");
      });
      originMarkerRef.current = marker;
    } else {
      originMarkerRef.current.setLngLat([origin.lon, origin.lat]);
    }
  }, [origin]);

  // Route, candidates and stop markers follow the plan.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];
    popupRef.current?.remove();
    travellerRef.current?.remove();
    travellerRef.current = null;

    const routeSource = map.getSource("route") as GeoJSONSource | undefined;
    const candidateSource = map.getSource("candidates") as GeoJSONSource | undefined;
    if (!plan) {
      routeSource?.setData(EMPTY);
      candidateSource?.setData(EMPTY);
      pathRef.current = null;
      return;
    }
    routeSource?.setData(routeFeatures(plan));
    candidateSource?.setData(candidateFeatures(plan));
    pathRef.current = buildTimedPath(plan.itinerary, [plan.origin[1], plan.origin[0]]);

    for (const stop of plan.itinerary.stops) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "stop-marker";
      el.dataset.order = String(stop.order);
      el.style.setProperty("--marker-color", colorOf(stop.place.category));
      el.setAttribute("aria-label", `Stop ${stop.order}: ${stop.place.name}`);
      el.innerHTML = `<span class="stop-marker__disc"><span class="stop-marker__num">${stop.order}</span></span><span class="stop-marker__label">${glyphSvg(stop.place.category, 12)}<span>${escapeHtml(stop.place.name)}</span></span>`;
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        const store = useStore.getState();
        store.selectStop(store.selectedStop === stop.order ? null : stop.order);
      });
      el.addEventListener("mouseenter", () => useStore.getState().setHoverStop(stop.order));
      el.addEventListener("mouseleave", () => useStore.getState().setHoverStop(null));
      const marker = new Marker({ element: el, anchor: "bottom" }).setLngLat([stop.place.lon, stop.place.lat]).addTo(map);
      markersRef.current.push(marker);
    }

    const traveller = document.createElement("div");
    traveller.className = "traveller";
    traveller.innerHTML = '<span class="traveller__dot"></span>';
    travellerRef.current = new Marker({ element: traveller, anchor: "center" }).setLngLat([plan.origin[1], plan.origin[0]]).addTo(map);
    traveller.style.display = "none";
  }, [plan, loaded, layersVersion]);

  // Selection and hover highlight, with a camera nudge on selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !plan) return;
    for (const marker of markersRef.current) {
      const el = marker.getElement();
      const order = Number(el.dataset.order);
      el.classList.toggle("is-selected", order === selectedStop);
      el.classList.toggle("is-hover", order === hoverStop && order !== selectedStop);
    }
    if (selectedStop === null || tourActive || playing) return;
    const stop = plan.itinerary.stops.find((s) => s.order === selectedStop);
    if (!stop) return;
    const narrow = window.innerWidth < 900;
    map.easeTo({
      center: [stop.place.lon, stop.place.lat],
      zoom: Math.max(map.getZoom(), 16),
      pitch: 60,
      duration: REDUCED_MOTION ? 0 : 900,
      offset: narrow ? [0, -window.innerHeight * 0.18] : [200, -30],
    });
  }, [selectedStop, hoverStop, plan, tourActive, playing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !map.getLayer("pulse-heat")) return;
    const visibility = pulse ? "visible" : "none";
    map.setLayoutProperty("pulse-heat", "visibility", visibility);
    map.setLayoutProperty("candidate-dots", "visibility", visibility);
  }, [pulse, loaded, layersVersion]);

  // The one orchestrated moment: a flight down from the globe and through the route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !plan || tourRequested === 0) return;
    tourAbortRef.current?.abort();
    stopSpin();
    const controller = new AbortController();
    tourAbortRef.current = controller;
    const store = useStore.getState();
    const originPoint: [number, number] = [plan.origin[1], plan.origin[0]];
    const bounds = planBounds(plan, originPoint);
    if (REDUCED_MOTION) {
      fitToPlan(map, bounds, false);
      return;
    }
    store.setTourActive(true);
    void flyThrough(map, originPoint, plan.itinerary.stops, controller.signal, (order) => useStore.getState().selectStop(order)).finally(() => {
      useStore.getState().setTourActive(false);
      if (!controller.signal.aborted) fitToPlan(map, bounds);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourRequested, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !plan || fitRequested === 0) return;
    tourAbortRef.current?.abort();
    fitToPlan(map, planBounds(plan, [plan.origin[1], plan.origin[0]]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequested, loaded]);

  // Animated dashes travelling along the route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !plan || REDUCED_MOTION) return;
    let frame = 0;
    let step = 0;
    let last = 0;
    const tick = (time: number) => {
      if (time - last > 60) {
        step = (step + 1) % DASH_SEQUENCE.length;
        if (map.getLayer("route-dash")) map.setPaintProperty("route-dash", "line-dasharray", DASH_SEQUENCE[step]);
        last = time;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [plan, loaded, layersVersion]);

  // Route playback: the traveller walks the plan while the camera follows.
  useEffect(() => {
    const map = mapRef.current;
    const traveller = travellerRef.current;
    const path = pathRef.current;
    if (!map || !traveller || !path || !plan) return;
    const el = traveller.getElement();
    const place = (minute: number) => {
      const pos = positionAt(path, minute);
      if (!pos) return null;
      traveller.setLngLat([pos.lon, pos.lat]);
      el.style.display = "";
      el.classList.toggle("is-dwelling", pos.stopOrder !== null);
      return pos;
    };
    if (!playing) {
      if (playbackMinute > 0) place(playbackMinute);
      else el.style.display = "none";
      return;
    }
    tourAbortRef.current?.abort();
    stopSpin();
    let frame = 0;
    let last = performance.now();
    let minute = playbackMinute;
    let lastPublish = 0;
    let bearing = map.getBearing();
    const tick = (time: number) => {
      const dt = (time - last) / 1000;
      last = time;
      minute += dt * PLAN_MINUTES_PER_SECOND * playbackSpeed;
      const pos = place(minute);
      if (pos && useStore.getState().playback.follow) {
        bearing = lerpBearing(bearing, pos.bearing, 0.06);
        map.jumpTo({ center: [pos.lon, pos.lat], zoom: 16.9, pitch: 64, bearing, padding: panelPadding() });
      }
      if (time - lastPublish > 120) {
        useStore.getState().setPlayback({ minute });
        lastPublish = time;
      }
      if (minute >= path.totalMinutes) {
        useStore.getState().setPlayback({ playing: false, minute: path.totalMinutes });
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, playbackSpeed, follow, plan, loaded]);

  // Scrubbing the timeline while paused.
  useEffect(() => {
    const traveller = travellerRef.current;
    const path = pathRef.current;
    if (playing || !traveller || !path) return;
    const pos = positionAt(path, playbackMinute);
    const el = traveller.getElement();
    if (!pos || playbackMinute <= 0) {
      el.style.display = "none";
      return;
    }
    traveller.setLngLat([pos.lon, pos.lat]);
    el.style.display = "";
    el.classList.toggle("is-dwelling", pos.stopOrder !== null);
  }, [playbackMinute, playing]);

  return <div ref={containerRef} className="map-scene" role="application" aria-label="City map" />;
}
