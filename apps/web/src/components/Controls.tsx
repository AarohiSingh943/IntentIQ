import { useEffect, useMemo, useRef, useState } from "react";
import { addMinutes, formatClock, formatDayLabel, roundUp, toNaiveLocalIso } from "../lib/time";
import type { Transport } from "../lib/types";
import { useStore } from "../state/store";

const STEP_MIN = 5;
const STEPS = (36 * 60) / STEP_MIN; // a day and a half ahead
const DURATIONS = [60, 120, 180, 240, 360];
const TRANSPORT: { key: Transport; label: string }[] = [
  { key: "walk", label: "Walk" },
  { key: "bike", label: "Bike" },
  { key: "drive", label: "Drive" },
];

export function Controls() {
  const plan = useStore((s) => s.plan);
  const status = useStore((s) => s.status);
  const replan = useStore((s) => s.replan);
  const overrides = useStore((s) => s.overrides);
  const [base] = useState(() => {
    const now = roundUp(new Date(), STEP_MIN);
    now.setMinutes(now.getMinutes() - (now.getMinutes() % 15));
    return now;
  });
  const busy = status === "planning";

  const startIso = plan?.intent.start_time;
  const currentStep = useMemo(() => {
    if (!startIso) return 0;
    const diff = (new Date(startIso).getTime() - base.getTime()) / 60_000;
    return Math.max(0, Math.min(STEPS, Math.round(diff / STEP_MIN)));
  }, [startIso, base]);

  const [step, setStep] = useState(currentStep);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setStep(currentStep);
  }, [currentStep]);

  const timer = useRef<number | null>(null);
  const commit = (value: number) => {
    setStep(value);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      dragging.current = false;
      void replan({ leaveAt: toNaiveLocalIso(addMinutes(base, value * STEP_MIN)) });
    }, 450);
  };

  const leaveAt = addMinutes(base, step * STEP_MIN);
  const duration = overrides.durationMin ?? plan?.intent.duration_min ?? 0;
  const transport = overrides.transport ?? plan?.intent.transport ?? "walk";

  return (
    <section className="controls" aria-label="Adjust the plan">
      <div className="controls__row controls__row--time">
        <label htmlFor="leave-at" className="controls__label">
          Leave at <strong>{formatClock(leaveAt.toISOString())}</strong> <span>{formatDayLabel(leaveAt.toISOString())}</span>
        </label>
        <input
          id="leave-at"
          className="ruler"
          type="range"
          min={0}
          max={STEPS}
          step={1}
          value={step}
          disabled={busy}
          onPointerDown={() => (dragging.current = true)}
          onChange={(event) => commit(Number(event.target.value))}
          aria-valuetext={`${formatClock(leaveAt.toISOString())} ${formatDayLabel(leaveAt.toISOString())}`}
        />
        <div className="ruler__ticks" aria-hidden="true">
          {[0, 6, 12, 18, 24, 30, 36].map((hour) => (
            <span key={hour} style={{ left: `${((hour * 60) / (STEPS * STEP_MIN)) * 100}%` }}>
              {formatClock(addMinutes(base, hour * 60).toISOString()).slice(0, 2)}h
            </span>
          ))}
        </div>
      </div>
      <div className="controls__row">
        <div className="segmented" role="group" aria-label="How long">
          {DURATIONS.map((minutes) => (
            <button key={minutes} type="button" className="segmented__item" aria-pressed={duration === minutes} disabled={busy} onClick={() => void replan({ durationMin: minutes })}>
              {minutes / 60}h
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="How you move">
          {TRANSPORT.map((mode) => (
            <button key={mode.key} type="button" className="segmented__item" aria-pressed={transport === mode.key} disabled={busy} onClick={() => void replan({ transport: mode.key })}>
              {mode.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
