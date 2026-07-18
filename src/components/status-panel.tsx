import type { RuntimeView } from "../ui/runtime-view.js";

interface StatusPanelProps {
  readonly view: RuntimeView;
}

export function StatusPanel({ view }: StatusPanelProps) {
  const tone =
    view.runtimeStatus === "AUTHORIZED"
      ? "success"
      : view.runtimeStatus === "READY FOR EVIDENCE"
        ? "ready"
        : "danger";

  return (
    <section className={`status-panel status-panel--${tone}`} aria-live="polite">
      <div className="eyebrow">Runtime decision</div>
      <h1 data-testid="runtime-status">{view.runtimeStatus}</h1>
      <p>{view.authorizationDetail}</p>
      <div className="state-strip" aria-label="System states">
        <div>
          <span>Authorization</span>
          <strong>{view.runtimeStatus}</strong>
        </div>
        <div>
          <span>Evidence</span>
          <strong data-testid="evidence-state">{view.evidenceState}</strong>
        </div>
        <div>
          <span>Execution</span>
          <strong data-testid="execution-state">{view.executionState}</strong>
        </div>
      </div>
    </section>
  );
}
