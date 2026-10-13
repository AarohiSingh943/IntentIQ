import { describe, expect, it } from "vitest";
import { addMinutes, formatDuration, formatKm, roundUp, toNaiveLocalIso } from "./time";

describe("time helpers", () => {
  it("formats durations for people", () => {
    expect(formatDuration(25)).toBe("25 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(135)).toBe("2 h 15 min");
  });

  it("formats distances at a sensible precision", () => {
    expect(formatKm(0.42)).toBe("420 m");
    expect(formatKm(3.26)).toBe("3.3 km");
    expect(formatKm(12.4)).toBe("12 km");
  });

  it("rounds up to the next step and serialises without an offset", () => {
    const date = new Date(2026, 8, 23, 15, 3, 40);
    const rounded = roundUp(date, 5);
    expect(rounded.getMinutes()).toBe(5);
    expect(rounded.getSeconds()).toBe(0);
    expect(toNaiveLocalIso(rounded)).toBe("2026-09-23T15:05:00");
    expect(toNaiveLocalIso(addMinutes(rounded, 90))).toBe("2026-09-23T16:35:00");
  });
});
