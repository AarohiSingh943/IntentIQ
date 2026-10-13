import type { Map as MapLibreMap } from "maplibre-gl";

let current: MapLibreMap | null = null;

export function setMapHandle(map: MapLibreMap | null): void {
  current = map;
  if (import.meta.env.DEV) (window as unknown as { __intentraMap?: MapLibreMap | null }).__intentraMap = map;
}

export function getMapHandle(): MapLibreMap | null {
  return current;
}
