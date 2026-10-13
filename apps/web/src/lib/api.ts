import type { ApiError, GeoHit, Meta, PlanRequest, PlanResponse, WeatherSummary } from "./types";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export class RequestFailed extends Error {
  code: string;
  status: number;
  constructor(status: number, body: Partial<ApiError>) {
    super(body.detail ?? "The request failed.");
    this.code = body.error ?? "unknown";
    this.status = status;
  }
}

async function parseError(response: Response): Promise<RequestFailed> {
  let body: Partial<ApiError> = {};
  try {
    body = (await response.json()) as Partial<ApiError>;
  } catch {
    body = { error: "http_error", detail: response.statusText };
  }
  return new RequestFailed(response.status, body);
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { signal });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export function fetchMeta(): Promise<Meta> {
  return getJson<Meta>("/api/meta");
}

export async function searchPlaces(query: string, near: { lat: number; lon: number } | null, signal?: AbortSignal): Promise<GeoHit[]> {
  const params = new URLSearchParams({ q: query, lang: navigator.language.slice(0, 2) || "en" });
  if (near) {
    params.set("lat", near.lat.toFixed(3));
    params.set("lon", near.lon.toFixed(3));
  }
  const body = await getJson<{ hits: GeoHit[] }>(`/api/geocode?${params.toString()}`, signal);
  return body.hits;
}

export async function reverseLabel(lat: number, lon: number): Promise<string | null> {
  const params = new URLSearchParams({ lat: lat.toFixed(5), lon: lon.toFixed(5), lang: navigator.language.slice(0, 2) || "en" });
  const body = await getJson<{ label: string | null }>(`/api/geocode/reverse?${params.toString()}`);
  return body.label;
}

export async function savePlan(plan: PlanResponse): Promise<{ id: string; path: string }> {
  const response = await fetch(`${BASE}/api/plans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(plan),
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as { id: string; path: string };
}

export function loadPlan(id: string): Promise<PlanResponse> {
  return getJson<PlanResponse>(`/api/plans/${encodeURIComponent(id)}`);
}

export function exportUrl(id: string, kind: "calendar.ics" | "route.gpx"): string {
  return `${BASE}/api/plans/${encodeURIComponent(id)}/${kind}`;
}

export interface StreamHandlers {
  onStage: (stage: { key: string; label: string; detail?: string }) => void;
  onIntent: (intent: PlanResponse["intent"]) => void;
  onWeather: (weather: WeatherSummary) => void;
  onCandidates: (info: { count: number; radius_km: number; from_cache: boolean }) => void;
}

/** POST the request and consume the server-sent event stream until `done` or `error`. */
export async function streamPlan(request: PlanRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<PlanResponse> {
  const response = await fetch(`${BASE}/api/plan/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok || !response.body) throw await parseError(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: PlanResponse | null = null;

  const dispatch = (event: string, raw: string) => {
    const data = raw ? (JSON.parse(raw) as unknown) : {};
    switch (event) {
      case "stage":
        handlers.onStage(data as { key: string; label: string; detail?: string });
        break;
      case "intent":
        handlers.onIntent(data as PlanResponse["intent"]);
        break;
      case "weather":
        handlers.onWeather(data as WeatherSummary);
        break;
      case "candidates":
        handlers.onCandidates(data as { count: number; radius_km: number; from_cache: boolean });
        break;
      case "plan":
        result = data as PlanResponse;
        break;
      case "error":
        throw new RequestFailed(502, data as ApiError);
      default:
        break;
    }
  };

  const consume = (chunk: string) => {
    buffer += chunk;
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
      }
      dispatch(event, dataLines.join("\n"));
      boundary = buffer.indexOf("\n\n");
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }
  if (!result) throw new RequestFailed(502, { error: "stream_ended", detail: "The plan never arrived. Try again." });
  return result;
}
