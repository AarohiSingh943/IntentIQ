import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { exportUrl } from "../lib/api";
import { formatClock } from "../lib/time";
import type { PlanResponse } from "../lib/types";
import { useStore } from "../state/store";

function planAsText(plan: PlanResponse, url: string | null): string {
  const tz = plan.meta.timezone;
  const lines = [plan.intent.summary, plan.start_label ? `Starting from ${plan.start_label}` : "", ""];
  for (const stop of plan.itinerary.stops) {
    lines.push(`${formatClock(stop.arrive, tz)}  ${stop.phase_label}: ${stop.place.name} (${stop.place.category_label})`);
    lines.push(`       ${stop.leg.minutes} min ${stop.leg.mode} from the previous point. ${stop.why}`);
  }
  lines.push("", `Ends ${formatClock(plan.itinerary.ends_at, tz)}.`);
  if (url) lines.push(url);
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}

function googleMapsUrl(plan: PlanResponse): string {
  const mode = { walk: "walking", bike: "bicycling", drive: "driving" }[plan.intent.transport];
  const stops = plan.itinerary.stops;
  if (stops.length === 0) return "https://www.google.com/maps";
  const last = stops[stops.length - 1];
  const waypoints = stops
    .slice(0, -1)
    .map((s) => `${s.place.lat},${s.place.lon}`)
    .join("|");
  const params = new URLSearchParams({ api: "1", origin: `${plan.origin[0]},${plan.origin[1]}`, destination: `${last.place.lat},${last.place.lon}`, travelmode: mode });
  if (waypoints) params.set("waypoints", waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function ShareSheet() {
  const open = useStore((s) => s.shareOpen);
  const setOpen = useStore((s) => s.setShareOpen);
  const plan = useStore((s) => s.plan);
  const shareId = useStore((s) => s.shareId);
  const share = useStore((s) => s.share);
  const sharing = useStore((s) => s.sharing);
  const toast = useStore((s) => s.toast);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !plan) return;
    if (!shareId) void share();
  }, [open, plan, shareId, share]);

  const url = shareId ? `${window.location.origin}/p/${shareId}` : null;

  useEffect(() => {
    if (!url) {
      setQr(null);
      return;
    }
    const dark = getComputedStyle(document.documentElement).getPropertyValue("--bone").trim() || "#ece7dc";
    void QRCode.toDataURL(url, { margin: 1, width: 232, color: { dark, light: "#00000000" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open || !plan) return null;

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done, "good");
    } catch {
      toast("Copy failed. Select the text and copy it yourself.", "bad");
    }
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Share this plan" onClick={() => setOpen(false)}>
      <div className="sheet__card" onClick={(event) => event.stopPropagation()}>
        <div className="sheet__head">
          <h2>Share this plan</h2>
          <button type="button" className="sheet__close" onClick={() => setOpen(false)} aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <p className="sheet__lede">Anyone with the link sees exactly this route, these times and these reasons. Point a phone at the code to carry it with you.</p>
        <div className="sheet__body">
          <div className="sheet__qr">{qr ? <img src={qr} alt="QR code for this plan" width={232} height={232} /> : <span className="sheet__qr-wait">{sharing ? "Making the link" : "Link unavailable"}</span>}</div>
          <div className="sheet__actions">
            <label className="sheet__link">
              <span>Link</span>
              <input type="text" readOnly value={url ?? "Creating"} onFocus={(event) => event.target.select()} />
            </label>
            <div className="sheet__buttons">
              <button type="button" className="button button--primary" disabled={!url} onClick={() => url && void copy(url, "Link copied.")}>
                Copy link
              </button>
              <button type="button" className="button button--ghost" onClick={() => void copy(planAsText(plan, url), "Itinerary copied as text.")}>
                Copy as text
              </button>
              {shareId && (
                <>
                  <a className="button button--ghost" href={exportUrl(shareId, "calendar.ics")}>
                    Add to calendar
                  </a>
                  <a className="button button--ghost" href={exportUrl(shareId, "route.gpx")}>
                    GPX for a watch
                  </a>
                </>
              )}
              <a className="button button--ghost" href={googleMapsUrl(plan)} target="_blank" rel="noopener noreferrer">
                Open route in Google Maps
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
