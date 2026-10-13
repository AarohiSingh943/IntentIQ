import { create } from "zustand";
import { RequestFailed, fetchMeta, loadPlan, reverseLabel, savePlan, streamPlan } from "../lib/api";
import { attachShareId, readHistory, rememberPlan, type HistoryEntry } from "../lib/history";
import { pushRecent, readOrigin, readRecent, writeOrigin } from "../lib/storage";
import { localTimeZone } from "../lib/time";
import type { GeoHit, IntentSpec, Meta, PlanResponse, Stage, Transport, WeatherSummary } from "../lib/types";
import type { StyleKey } from "../map/styles";

export type Status = "idle" | "locating" | "planning" | "ready" | "error";
export type OriginSource = "gps" | "map" | "saved" | "default" | "shared" | "search" | "history";

export interface Origin {
  lat: number;
  lon: number;
  source: OriginSource;
}

export interface Overrides {
  leaveAt: string | null; // naive local ISO
  durationMin: number | null;
  transport: Transport | null;
  pins: Record<string, string>;
  exclude: string[];
}

export interface Toast {
  id: number;
  text: string;
  tone: "neutral" | "good" | "bad";
}

export interface ContextMenu {
  x: number;
  y: number;
  lat: number;
  lon: number;
}

interface State {
  status: Status;
  query: string;
  origin: Origin;
  startLabel: string | null;
  stages: Stage[];
  candidateCount: number | null;
  intent: IntentSpec | null;
  weather: WeatherSummary | null;
  plan: PlanResponse | null;
  error: { code: string; detail: string } | null;
  selectedStop: number | null;
  hoverStop: number | null;
  overrides: Overrides;
  pulse: boolean;
  relief: boolean;
  styleKey: StyleKey;
  tourActive: boolean;
  tourRequested: number;
  fitRequested: number;
  flyToOriginRequested: number;
  playback: { playing: boolean; minute: number; speed: number; follow: boolean };
  panelExpanded: boolean;
  shareOpen: boolean;
  contextMenu: ContextMenu | null;
  meta: Meta | null;
  recent: string[];
  history: HistoryEntry[];
  shareId: string | null;
  sharing: boolean;
  toasts: Toast[];
  timezone: string;

  setQuery: (query: string) => void;
  setOrigin: (lat: number, lon: number, source: OriginSource, label?: string | null) => void;
  chooseStart: (hit: GeoHit) => void;
  useMyLocation: () => Promise<void>;
  loadMeta: () => Promise<void>;
  compose: (query?: string) => Promise<void>;
  replan: (patch: Partial<Overrides>) => Promise<void>;
  pinAlternative: (phaseKey: string, placeId: string) => Promise<void>;
  unpin: (phaseKey: string) => Promise<void>;
  skipPlace: (placeId: string) => Promise<void>;
  selectStop: (order: number | null) => void;
  setHoverStop: (order: number | null) => void;
  togglePulse: () => void;
  toggleRelief: () => void;
  setStyle: (key: StyleKey) => void;
  requestTour: () => void;
  setTourActive: (active: boolean) => void;
  requestFit: () => void;
  setPlayback: (patch: Partial<State["playback"]>) => void;
  setPanelExpanded: (expanded: boolean) => void;
  setShareOpen: (open: boolean) => void;
  setContextMenu: (menu: ContextMenu | null) => void;
  share: () => Promise<string | null>;
  openShared: (id: string) => Promise<void>;
  openHistory: (entry: HistoryEntry) => Promise<void>;
  reset: () => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
}

const DEFAULT_ORIGIN: Origin = { lat: 28.6315, lon: 77.2167, source: "default" };
const EMPTY_OVERRIDES: Overrides = { leaveAt: null, durationMin: null, transport: null, pins: {}, exclude: [] };
const STYLE_KEY = "intentra.style";
let toastSeq = 1;
let activeController: AbortController | null = null;

function initialOrigin(): Origin {
  const saved = readOrigin();
  return saved ? { ...saved, source: "saved" } : DEFAULT_ORIGIN;
}

function initialStyle(): StyleKey {
  try {
    const value = localStorage.getItem(STYLE_KEY);
    if (value === "night" || value === "dawn" || value === "blueprint") return value;
  } catch {
    /* ignore */
  }
  return "night";
}

function locate(timeoutMs = 9000): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        resolve({ lat: position.coords.latitude, lon: position.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 120_000 },
    );
  });
}

export const useStore = create<State>((set, get) => ({
  status: "idle",
  query: "",
  origin: initialOrigin(),
  startLabel: null,
  stages: [],
  candidateCount: null,
  intent: null,
  weather: null,
  plan: null,
  error: null,
  selectedStop: null,
  hoverStop: null,
  overrides: EMPTY_OVERRIDES,
  pulse: true,
  relief: false,
  styleKey: initialStyle(),
  tourActive: false,
  tourRequested: 0,
  fitRequested: 0,
  flyToOriginRequested: 0,
  playback: { playing: false, minute: 0, speed: 1, follow: true },
  panelExpanded: true,
  shareOpen: false,
  contextMenu: null,
  meta: null,
  recent: readRecent(),
  history: readHistory(),
  shareId: null,
  sharing: false,
  toasts: [],
  timezone: localTimeZone(),

  setQuery: (query) => set({ query }),

  setOrigin: (lat, lon, source, label) => {
    writeOrigin({ lat, lon });
    set({ origin: { lat, lon, source }, startLabel: label === undefined ? null : label, contextMenu: null });
    if (label === undefined) {
      void reverseLabel(lat, lon)
        .then((found) => {
          const current = get().origin;
          if (current.lat === lat && current.lon === lon) set({ startLabel: found });
        })
        .catch(() => undefined);
    }
  },

  chooseStart: (hit) => {
    get().setOrigin(hit.lat, hit.lon, "search", hit.label);
    set((s) => ({ flyToOriginRequested: s.flyToOriginRequested + 1 }));
    if (get().plan) void get().replan({});
  },

  useMyLocation: async () => {
    set({ status: get().plan ? get().status : "locating", stages: get().plan ? get().stages : [{ key: "locate", label: "Finding where you are", done: false }] });
    const found = await locate();
    if (found) {
      get().setOrigin(found.lat, found.lon, "gps");
      set((s) => ({ flyToOriginRequested: s.flyToOriginRequested + 1, status: s.plan ? s.status : "idle", stages: s.plan ? s.stages : [] }));
      if (get().plan) void get().replan({});
    } else {
      set((s) => ({ status: s.plan ? s.status : "idle", stages: s.plan ? s.stages : [] }));
      get().toast("Location is off or blocked. Search for a place or right-click the map to set your start.", "bad");
    }
  },

  loadMeta: async () => {
    try {
      set({ meta: await fetchMeta() });
    } catch {
      /* the app still works without meta; examples are just fewer */
    }
  },

  compose: async (queryArg) => {
    const query = (queryArg ?? get().query).trim();
    if (query.length < 3) {
      get().toast("Say a little more about what you want.");
      return;
    }
    set({ query, overrides: EMPTY_OVERRIDES, shareId: null, playback: { playing: false, minute: 0, speed: 1, follow: true } });

    let origin = get().origin;
    if (origin.source === "default" || origin.source === "saved") {
      set({ status: "locating", stages: [{ key: "locate", label: "Finding where you are", done: false }] });
      const found = await locate();
      if (found) {
        get().setOrigin(found.lat, found.lon, "gps");
        origin = get().origin;
      } else if (origin.source === "default") {
        get().toast("Location is off, so the plan starts from the map pin. Search a place or right-click the map to move it.");
      }
    }
    await runPlan(query);
  },

  replan: async (patch) => {
    const { plan, query } = get();
    if (!plan && !query) return;
    set({ overrides: { ...get().overrides, ...patch, pins: patch.pins ?? get().overrides.pins, exclude: patch.exclude ?? get().overrides.exclude }, shareId: null });
    await runPlan(query || plan!.intent.query, { quiet: true });
  },

  pinAlternative: async (phaseKey, placeId) => {
    const pins = { ...get().overrides.pins, [phaseKey]: placeId };
    await get().replan({ pins });
  },

  unpin: async (phaseKey) => {
    const pins = { ...get().overrides.pins };
    delete pins[phaseKey];
    await get().replan({ pins });
  },

  skipPlace: async (placeId) => {
    const pins = Object.fromEntries(Object.entries(get().overrides.pins).filter(([, id]) => id !== placeId));
    const exclude = [...new Set([...get().overrides.exclude, placeId])];
    set({ selectedStop: null });
    await get().replan({ pins, exclude });
  },

  selectStop: (order) => set({ selectedStop: order, panelExpanded: order !== null ? true : get().panelExpanded, contextMenu: null }),
  setHoverStop: (order) => set({ hoverStop: order }),
  togglePulse: () => set((s) => ({ pulse: !s.pulse })),
  toggleRelief: () => set((s) => ({ relief: !s.relief })),
  setStyle: (key) => {
    try {
      localStorage.setItem(STYLE_KEY, key);
    } catch {
      /* ignore */
    }
    set({ styleKey: key });
  },
  requestTour: () => set((s) => ({ tourRequested: s.tourRequested + 1, selectedStop: null, playback: { ...s.playback, playing: false } })),
  setTourActive: (active) => set({ tourActive: active }),
  requestFit: () => set((s) => ({ fitRequested: s.fitRequested + 1, playback: { ...s.playback, playing: false } })),
  setPlayback: (patch) => set((s) => ({ playback: { ...s.playback, ...patch } })),
  setPanelExpanded: (expanded) => set({ panelExpanded: expanded }),
  setShareOpen: (open) => set({ shareOpen: open }),
  setContextMenu: (menu) => set({ contextMenu: menu }),

  share: async () => {
    const { plan, shareId } = get();
    if (!plan) return null;
    if (shareId) return shareId;
    set({ sharing: true });
    try {
      const saved = await savePlan(plan);
      set({ shareId: saved.id, history: attachShareId(plan.intent.query, saved.id) });
      if (window.location.pathname !== `/p/${saved.id}`) window.history.replaceState(null, "", `/p/${saved.id}`);
      return saved.id;
    } catch (error) {
      get().toast(error instanceof RequestFailed ? error.message : "Could not create a link.", "bad");
      return null;
    } finally {
      set({ sharing: false });
    }
  },

  openShared: async (id) => {
    set({ status: "planning", stages: [{ key: "load", label: "Opening the shared plan", done: false }] });
    try {
      const plan = await loadPlan(id);
      const origin: Origin = { lat: plan.origin[0], lon: plan.origin[1], source: "shared" };
      set({
        plan,
        intent: plan.intent,
        weather: plan.weather,
        query: plan.intent.query,
        origin,
        startLabel: plan.start_label,
        status: "ready",
        stages: [],
        shareId: id,
        candidateCount: plan.meta.candidate_count,
        overrides: EMPTY_OVERRIDES,
        tourRequested: get().tourRequested + 1,
      });
    } catch (error) {
      set({ status: "error", error: { code: "not_found", detail: error instanceof RequestFailed ? error.message : "That link does not point to a plan." }, stages: [] });
    }
  },

  openHistory: async (entry) => {
    if (entry.shareId) {
      window.history.replaceState(null, "", `/p/${entry.shareId}`);
      await get().openShared(entry.shareId);
      return;
    }
    get().setOrigin(entry.origin[0], entry.origin[1], "history", entry.label);
    set({ query: entry.query });
    await runPlan(entry.query);
  },

  reset: () => {
    activeController?.abort();
    set({
      status: "idle",
      plan: null,
      intent: null,
      weather: null,
      stages: [],
      error: null,
      selectedStop: null,
      hoverStop: null,
      overrides: EMPTY_OVERRIDES,
      shareId: null,
      shareOpen: false,
      candidateCount: null,
      tourActive: false,
      playback: { playing: false, minute: 0, speed: 1, follow: true },
    });
    if (window.location.pathname !== "/") window.history.replaceState(null, "", "/");
  },

  toast: (text, tone = "neutral") => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => get().dismissToast(id), 5600);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

async function runPlan(query: string, options: { quiet?: boolean } = {}) {
  const { origin, overrides, timezone } = useStore.getState();
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;

  useStore.setState({
    status: "planning",
    error: null,
    stages: options.quiet ? [{ key: "replan", label: "Recomposing", done: false }] : [],
    ...(options.quiet ? {} : { selectedStop: null, candidateCount: null, weather: null }),
    playback: { ...useStore.getState().playback, playing: false },
  });

  try {
    const plan = await streamPlan(
      {
        query,
        lat: origin.lat,
        lon: origin.lon,
        timezone,
        leave_at: overrides.leaveAt,
        duration_min: overrides.durationMin,
        transport: overrides.transport,
        pins: overrides.pins,
        exclude: overrides.exclude,
        lang: navigator.language.slice(0, 2) || "en",
      },
      {
        onStage: (stage) =>
          useStore.setState((s) => ({
            stages: [...s.stages.map((x) => ({ ...x, done: true })), { ...stage, done: false }],
          })),
        onIntent: (intent) => useStore.setState({ intent }),
        onWeather: (weather) => useStore.setState({ weather }),
        onCandidates: (info) => useStore.setState({ candidateCount: info.count }),
      },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    const recent = pushRecent(query);
    const history = rememberPlan(plan, null);
    useStore.setState((s) => ({
      plan,
      intent: plan.intent,
      weather: plan.weather,
      startLabel: plan.start_label ?? s.startLabel,
      status: "ready",
      stages: s.stages.map((x) => ({ ...x, done: true })),
      recent,
      history,
      selectedStop: options.quiet && s.selectedStop && plan.itinerary.stops.some((st) => st.order === s.selectedStop) ? s.selectedStop : null,
      tourRequested: options.quiet ? s.tourRequested : s.tourRequested + 1,
      fitRequested: options.quiet ? s.fitRequested + 1 : s.fitRequested,
      playback: { playing: false, minute: 0, speed: 1, follow: true },
    }));
    if (plan.itinerary.gaps.length && !options.quiet) {
      useStore.getState().toast(`${plan.itinerary.gaps.length === 1 ? "One part" : `${plan.itinerary.gaps.length} parts`} of the plan could not be filled. See the notes below the route.`);
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    const detail = error instanceof RequestFailed ? error.message : "The planner could not be reached.";
    const code = error instanceof RequestFailed ? error.code : "network";
    useStore.setState({ status: "error", error: { code, detail }, stages: [] });
  }
}
