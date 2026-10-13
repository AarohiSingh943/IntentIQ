import { describe, expect, it } from "vitest";
import { buildTimedPath, lerpBearing, positionAt } from "./playback";
import type { Itinerary, Stop } from "./types";

function stop(order: number, lon: number, lat: number, arrive: string, depart: string, geometry: [number, number][]): Stop {
  return {
    order,
    phase_key: `p${order}`,
    phase_label: "Phase",
    place: { id: `n${order}`, name: `Stop ${order}`, lat, lon, category: "cafe", category_label: "Café", tags: {}, confidence: 0.5, landmark: false, hours: { state: "open", rule: null, next_change: null } },
    arrive,
    depart,
    dwell_min: 30,
    leg: { from_id: null, to_id: `n${order}`, mode: "walk", minutes: 10, km: 1, source: "estimate", geometry },
    score: 0.8,
    factors: { fit: 1, timing: 1, proximity: 1, confidence: 0.5 },
    hours_at_arrival: { state: "open", rule: null, next_change: null },
    why: "",
    notes: [],
    alternatives: [],
  };
}

const itinerary: Itinerary = {
  stops: [
    stop(1, 77.21, 28.63, "2026-09-25T19:10:00+05:30", "2026-09-25T19:40:00+05:30", [
      [77.2, 28.63],
      [77.21, 28.63],
    ]),
    stop(2, 77.21, 28.64, "2026-09-25T19:50:00+05:30", "2026-09-25T20:20:00+05:30", [
      [77.21, 28.63],
      [77.21, 28.64],
    ]),
  ],
  gaps: [],
  starts_at: "2026-09-25T19:00:00+05:30",
  ends_at: "2026-09-25T20:20:00+05:30",
  total_min: 80,
  travel_min: 20,
  distance_km: 2,
  score: 1,
};

describe("timed playback path", () => {
  const path = buildTimedPath(itinerary, [77.2, 28.63]);

  it("spans the whole plan", () => {
    expect(path.totalMinutes).toBe(80);
    expect(path.points[0].minute).toBe(0);
    expect(path.points[path.points.length - 1].minute).toBe(80);
  });

  it("is halfway along the first leg at minute 5", () => {
    const pos = positionAt(path, 5)!;
    expect(pos.lon).toBeCloseTo(77.205, 4);
    expect(pos.stopOrder).toBeNull();
    expect(Math.round(pos.bearing)).toBe(90);
  });

  it("dwells at the stop between arrival and departure", () => {
    expect(positionAt(path, 20)!.stopOrder).toBe(1);
    expect(positionAt(path, 45)!.stopOrder).toBeNull();
    expect(positionAt(path, 60)!.stopOrder).toBe(2);
  });

  it("clamps outside the window", () => {
    expect(positionAt(path, -10)!.minute).toBe(0);
    expect(positionAt(path, 500)!.minute).toBe(80);
  });
});

describe("bearing interpolation", () => {
  it("takes the short way around", () => {
    expect(lerpBearing(350, 10, 0.5)).toBeCloseTo(0, 5);
    expect(lerpBearing(10, 350, 0.5)).toBeCloseTo(0, 5);
    expect(lerpBearing(0, 90, 0.5)).toBe(45);
  });
});
