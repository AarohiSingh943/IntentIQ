import type { Itinerary } from "./types";

/**
 * A timed path through the itinerary: every vertex knows the plan-minute at which the
 * traveller passes it, so playback and the timeline can agree on where you are at any time.
 */
export interface TimedPoint {
  lon: number;
  lat: number;
  minute: number; // minutes after the plan start
  stopOrder: number | null; // set while dwelling at a stop
}

export interface TimedPath {
  points: TimedPoint[];
  totalMinutes: number;
}

function minutesBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60_000;
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371.0088;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function buildTimedPath(itinerary: Itinerary, origin: [number, number]): TimedPath {
  const points: TimedPoint[] = [];
  const start = itinerary.starts_at;
  let cursor: [number, number] = origin;
  let lastMinute = 0;

  for (const stop of itinerary.stops) {
    const arrive = minutesBetween(start, stop.arrive);
    const depart = minutesBetween(start, stop.depart);
    const geometry = stop.leg.geometry.length >= 2 ? stop.leg.geometry : [cursor, [stop.place.lon, stop.place.lat] as [number, number]];
    const lengths: number[] = [];
    let total = 0;
    for (let i = 1; i < geometry.length; i++) {
      const d = haversineKm(geometry[i - 1], geometry[i]);
      lengths.push(d);
      total += d;
    }
    let travelled = 0;
    for (let i = 0; i < geometry.length; i++) {
      if (i > 0) travelled += lengths[i - 1];
      const fraction = total > 0 ? travelled / total : i / Math.max(1, geometry.length - 1);
      points.push({ lon: geometry[i][0], lat: geometry[i][1], minute: lastMinute + (arrive - lastMinute) * fraction, stopOrder: null });
    }
    points.push({ lon: stop.place.lon, lat: stop.place.lat, minute: arrive, stopOrder: stop.order });
    points.push({ lon: stop.place.lon, lat: stop.place.lat, minute: depart, stopOrder: stop.order });
    cursor = [stop.place.lon, stop.place.lat];
    lastMinute = depart;
  }
  return { points, totalMinutes: Math.max(lastMinute, minutesBetween(start, itinerary.ends_at)) };
}

export interface Position {
  lon: number;
  lat: number;
  bearing: number;
  stopOrder: number | null;
  minute: number;
}

function bearingBetween(a: TimedPoint, b: TimedPoint): number {
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Where the traveller is at a given plan-minute, interpolated along the path. */
export function positionAt(path: TimedPath, minute: number): Position | null {
  const pts = path.points;
  if (pts.length === 0) return null;
  const clamped = Math.max(0, Math.min(path.totalMinutes, minute));
  if (clamped <= pts[0].minute) return { lon: pts[0].lon, lat: pts[0].lat, bearing: pts.length > 1 ? bearingBetween(pts[0], pts[1]) : 0, stopOrder: pts[0].stopOrder, minute: clamped };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (clamped <= b.minute) {
      const span = b.minute - a.minute;
      const t = span > 0 ? (clamped - a.minute) / span : 1;
      let bearing = bearingBetween(a, b);
      if (a.lon === b.lon && a.lat === b.lat) {
        const next = pts.slice(i).find((p) => p.lon !== b.lon || p.lat !== b.lat);
        bearing = next ? bearingBetween(b, next) : 0;
      }
      return { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t, bearing, stopOrder: a.stopOrder !== null && b.stopOrder === a.stopOrder ? a.stopOrder : null, minute: clamped };
    }
  }
  const last = pts[pts.length - 1];
  return { lon: last.lon, lat: last.lat, bearing: 0, stopOrder: last.stopOrder, minute: clamped };
}

/** Shortest-arc interpolation for compass bearings, so the camera never spins the long way. */
export function lerpBearing(from: number, to: number, t: number): number {
  let delta = ((to - from + 540) % 360) - 180;
  if (Math.abs(delta) < 0.01) delta = 0;
  return (from + delta * t + 360) % 360;
}
