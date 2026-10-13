export type Transport = "walk" | "bike" | "drive";
export type HoursStateKind = "open" | "closed" | "unknown";

export interface Phase {
  key: string;
  label: string;
  categories: string[];
  dwell_min: number;
  optional: boolean;
}

export interface IntentSpec {
  query: string;
  summary: string;
  mood: string;
  arc: Phase[];
  duration_min: number;
  start_time: string;
  transport: Transport;
  budget: "low" | "mid" | "high" | null;
  companions: "solo" | "partner" | "friends" | "family" | null;
  energy: "low" | "mid" | "high";
  constraints: string[];
  explicit_categories: string[];
  confidence: number;
  source: "rules" | "llm+rules";
  query_start_was_now?: boolean;
}

export interface HoursState {
  state: HoursStateKind;
  rule: string | null;
  next_change: string | null;
}

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  category_label: string;
  tags: Record<string, string>;
  confidence: number;
  landmark: boolean;
  hours: HoursState;
}

export interface Leg {
  from_id: string | null;
  to_id: string;
  mode: Transport;
  minutes: number;
  km: number;
  source: "estimate" | "osrm";
  geometry: [number, number][];
}

export interface Factors {
  fit: number;
  timing: number;
  proximity: number;
  confidence: number;
}

export interface Stop {
  order: number;
  phase_key: string;
  phase_label: string;
  place: Place;
  arrive: string;
  depart: string;
  dwell_min: number;
  leg: Leg;
  score: number;
  factors: Factors;
  hours_at_arrival: HoursState;
  why: string;
  notes: string[];
  alternatives: Place[];
}

export interface Gap {
  phase_key: string;
  phase_label: string;
  reason: string;
}

export interface Itinerary {
  stops: Stop[];
  gaps: Gap[];
  starts_at: string;
  ends_at: string;
  total_min: number;
  travel_min: number;
  distance_km: number;
  score: number;
}

export interface Counterfactual {
  kind: "more_time" | "later_start" | "other_mode";
  label: string;
  outcome: string;
}

export interface CandidateLite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  category_label: string;
  state: HoursStateKind;
  confidence: number;
}

export interface WeatherSummary {
  temp_c: number;
  feels: "cold" | "cool" | "mild" | "warm" | "hot";
  precip_prob: number;
  code: number;
  label: string;
  icon: "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";
  rain_expected: boolean;
  rain_from: string | null;
  sunrise: string | null;
  sunset: string | null;
  sunset_in_window: boolean;
  dark_at_start: boolean;
  advice: string[];
}

export interface PlanMeta {
  radius_km: number;
  candidate_count: number;
  from_cache: boolean;
  route_source: "osrm" | "estimate" | "none";
  llm: string | null;
  compiled_ms: number;
  timezone: string;
}

export interface PlanResponse {
  plan_id: string | null;
  intent: IntentSpec;
  itinerary: Itinerary;
  counterfactuals: Counterfactual[];
  candidates: CandidateLite[];
  weather: WeatherSummary | null;
  start_label: string | null;
  origin: [number, number];
  meta: PlanMeta;
}

export interface PlanRequest {
  query: string;
  lat: number;
  lon: number;
  timezone: string;
  leave_at?: string | null;
  duration_min?: number | null;
  transport?: Transport | null;
  pins?: Record<string, string>;
  exclude?: string[];
  lang?: string;
}

export interface GeoHit {
  label: string;
  name: string;
  lat: number;
  lon: number;
  kind: string;
  country: string | null;
}

export interface MoodInfo {
  key: string;
  label: string;
  example: string;
  phases: string[];
}

export interface Meta {
  version: string;
  moods: MoodInfo[];
  categories: { key: string; label: string; dwell_min: number; indoor: boolean }[];
  transports: Transport[];
  llm: { provider: string; ready: boolean };
  limits: { plans_per_minute: number; max_alternatives: number };
}

export interface ApiError {
  error: string;
  detail: string;
}

export interface Stage {
  key: string;
  label: string;
  detail?: string;
  done: boolean;
}
