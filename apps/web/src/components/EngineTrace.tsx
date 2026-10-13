import { useStore } from "../state/store";

export function EngineTrace() {
  const stages = useStore((s) => s.stages);
  const candidateCount = useStore((s) => s.candidateCount);
  const intent = useStore((s) => s.intent);

  return (
    <div className="trace" aria-live="polite">
      <ol className="trace__list">
        {stages.map((stage) => (
          <li key={stage.key} className={`trace__item ${stage.done ? "is-done" : "is-active"}`}>
            <span className="trace__mark" aria-hidden="true" />
            <span className="trace__label">{stage.label}</span>
            {stage.key === "intent" && intent && stage.done && <span className="trace__detail">{intent.summary}</span>}
            {stage.key === "scan" && candidateCount !== null && <span className="trace__detail">{candidateCount} named places in reach</span>}
            {stage.key === "scan" && candidateCount === null && stage.detail && <span className="trace__detail">{stage.detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
