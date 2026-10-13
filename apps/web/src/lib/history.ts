import type { PlanResponse } from "./types";

const KEY = "intentra.history";
const LIMIT = 8;

export interface HistoryEntry {
  at: string;
  query: string;
  label: string | null;
  origin: [number, number];
  stops: { name: string; category: string }[];
  startsAt: string;
  totalMin: number;
  shareId: string | null;
  timezone: string;
}

export function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as HistoryEntry[]).filter((e) => e && typeof e.query === "string" && Array.isArray(e.origin)).slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberPlan(plan: PlanResponse, shareId: string | null): HistoryEntry[] {
  const entry: HistoryEntry = {
    at: new Date().toISOString(),
    query: plan.intent.query,
    label: plan.start_label,
    origin: plan.origin,
    stops: plan.itinerary.stops.map((s) => ({ name: s.place.name, category: s.place.category })),
    startsAt: plan.itinerary.starts_at,
    totalMin: plan.itinerary.total_min,
    shareId,
    timezone: plan.meta.timezone,
  };
  const rest = readHistory().filter((e) => !(e.query === entry.query && Math.abs(e.origin[0] - entry.origin[0]) < 0.001 && Math.abs(e.origin[1] - entry.origin[1]) < 0.001));
  const next = [entry, ...rest].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  return next;
}

export function attachShareId(query: string, shareId: string): HistoryEntry[] {
  const next = readHistory().map((e) => (e.query === query && !e.shareId ? { ...e, shareId } : e));
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
