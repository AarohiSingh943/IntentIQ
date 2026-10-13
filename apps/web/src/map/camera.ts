import type { LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
import type { Stop } from "../lib/types";

export const REDUCED_MOTION = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function panelPadding(): { top: number; bottom: number; left: number; right: number } {
  const narrow = window.innerWidth < 900;
  return narrow ? { top: 90, bottom: Math.round(window.innerHeight * 0.48), left: 24, right: 24 } : { top: 80, bottom: 150, left: 520, right: 120 };
}

export function fitToPlan(map: MapLibreMap, bounds: LngLatBoundsLike, animate = true): void {
  map.fitBounds(bounds, { padding: panelPadding(), pitch: 55, bearing: map.getBearing(), duration: animate && !REDUCED_MOTION ? 1400 : 0, maxZoom: 16.2 });
}

function waitForMoveEnd(map: MapLibreMap, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      map.off("moveend", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    map.once("moveend", done);
    signal.addEventListener("abort", done, { once: true });
  });
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * One orchestrated flight through the itinerary: origin, then each stop in order,
 * each from a slightly different bearing so the city turns under the camera.
 */
export async function flyThrough(map: MapLibreMap, origin: [number, number], stops: Stop[], signal: AbortSignal, onStop: (order: number | null) => void): Promise<void> {
  if (REDUCED_MOTION || stops.length === 0) return;
  const startBearing = map.getBearing();
  const padding = panelPadding();
  const offset: [number, number] = [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2];

  map.flyTo({ center: origin, zoom: 15.4, pitch: 60, bearing: startBearing - 15, duration: 1800, offset, essential: true });
  await waitForMoveEnd(map, signal);
  await pause(350, signal);

  for (const [index, stop] of stops.entries()) {
    if (signal.aborted) return;
    onStop(stop.order);
    map.flyTo({
      center: [stop.place.lon, stop.place.lat],
      zoom: 16.6,
      pitch: 63,
      bearing: startBearing + 35 * (index + 1),
      duration: 2600,
      curve: 1.25,
      offset,
      essential: true,
    });
    await waitForMoveEnd(map, signal);
    await pause(1100, signal);
  }
  if (!signal.aborted) onStop(null);
}
