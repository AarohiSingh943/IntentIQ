const RECENT_KEY = "intentra.recent";
const ORIGIN_KEY = "intentra.origin";

export function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function pushRecent(query: string): string[] {
  const next = [query, ...readRecent().filter((q) => q !== query)].slice(0, 5);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage may be unavailable */
  }
  return next;
}

export function readOrigin(): { lat: number; lon: number } | null {
  try {
    const raw = localStorage.getItem(ORIGIN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { lat?: unknown; lon?: unknown };
    if (typeof value.lat === "number" && typeof value.lon === "number") return { lat: value.lat, lon: value.lon };
    return null;
  } catch {
    return null;
  }
}

export function writeOrigin(origin: { lat: number; lon: number }): void {
  try {
    localStorage.setItem(ORIGIN_KEY, JSON.stringify(origin));
  } catch {
    /* ignore */
  }
}
