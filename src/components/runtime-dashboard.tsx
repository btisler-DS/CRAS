"use client";

import { useMemo, useRef, useState } from "react";

import type { RequiredConditionId } from "../domain.js";
import type { DemoPreset, RuntimeView } from "../ui/runtime-view.js";
import { EventTimeline } from "./event-timeline.js";
import { RobotFloorMap } from "./robot-floor-map.js";
import { RobotVisionPanel } from "./robot-vision-panel.js";
import { RuntimeRecords } from "./runtime-records.js";
import styles from "./runtime-dashboard.module.css";

interface RuntimeDashboardProps {
  readonly initialView: RuntimeView;
}

interface ScenarioCard {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly preset: DemoPreset;
  readonly condition?: RequiredConditionId;
  readonly expected: "AUTHORIZED" | "BLOCKED";
}

const SCENARIOS: readonly ScenarioCard[] = [
  {
    id: "success",
    title: "Authorized delivery",
    subtitle: "All required evidence is satisfied",
    preset: "successful",
    expected: "AUTHORIZED",
  },
  {
    id: "wrong-patient",
    title: "Wrong patient",
    subtitle: "Patient identity does not match",
    preset: "successful",
    condition: "PATIENT_IDENTITY_VERIFIED",
    expected: "BLOCKED",
  },
  {
    id: "order-hold",
    title: "Order on hold",
    subtitle: "The physician order is inactive",
    preset: "successful",
    condition: "PHYSICIAN_ORDER_ACTIVE",
    expected: "BLOCKED",
  },
  {
    id: "wrong-medication",
    title: "Wrong medication",
    subtitle: "Scanned medication does not match",
    preset: "successful",
    condition: "MEDICATION_MATCHED",
    expected: "BLOCKED",
  },
  {
    id: "outside-window",
    title: "Outside administration window",
    subtitle: "Timing condition is unresolved",
    preset: "successful",
    condition: "ADMINISTRATION_WINDOW_VALID",
    expected: "BLOCKED",
  },
  {
    id: "evidence-failure",
    title: "Evidence store unavailable",
    subtitle: "Facts pass, persistence fails",
    preset: "evidence-failure",
    expected: "BLOCKED",
  },
];

const PRESET_SCENARIO: Record<DemoPreset, string> = {
  blocked: "wrong-patient",
  successful: "success",
  "evidence-failure": "evidence-failure",
};

async function sendCommand(command: object): Promise<RuntimeView> {
  const response = await fetch("/api/runtime", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error("Runtime command failed.");
  return (await response.json()) as RuntimeView;
}

export function RuntimeDashboard({ initialView }: RuntimeDashboardProps) {
  const initialScenario = initialView.failureInjected
    ? "evidence-failure"
    : initialView.conditions.every((condition) => condition.satisfied)
      ? "success"
      : "wrong-patient";
  const [view, setView] = useState(initialView);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState(initialScenario);
  const [comparisonScenario, setComparisonScenario] = useState(initialScenario);
  const [mode, setMode] = useState<"canned" | "modified">("canned");
  const [modelRecommendation, setModelRecommendation] = useState("Proceed");
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const presetMenuRef = useRef<HTMLDetailsElement>(null);
  const inspectionRef = useRef<HTMLElement>(null);

  const satisfiedCount = useMemo(
    () => view.conditions.filter((condition) => condition.satisfied).length,
    [view.conditions],
  );
  const originalScenario =
    SCENARIOS.find((scenario) => scenario.id === comparisonScenario) ?? SCENARIOS[0];
  const currentScenario = SCENARIOS.find(
    (scenario) => scenario.id === selectedScenario,
  );
  const currentRunTitle =
    selectedScenario === "modified"
      ? "Modified run"
      : selectedScenario === "live-mission"
        ? "Live mission"
        : (currentScenario?.title ?? "Current run");
  const displayVerdict =
    view.runtimeStatus === "UNAUTHORIZED" ||
    view.runtimeStatus === "EVIDENCE COMMIT FAILED"
      ? "BLOCKED"
      : view.runtimeStatus;
  const headlineReason =
    view.blockingReasons[0] ??
    (view.runtimeStatus === "AUTHORIZED"
      ? "Durable evidence committed and grant consumed."
      : view.authorizationDetail);

  async function run(command: object): Promise<RuntimeView | null> {
    setPending(true);
    setError(null);
    try {
      const nextView = await sendCommand(command);
      setView(nextView);
      return nextView;
    } catch (commandError) {
      setError(
        commandError instanceof Error ? commandError.message : "Runtime command failed.",
      );
      return null;
    } finally {
      setPending(false);
    }
  }

  async function selectPreset(preset: DemoPreset): Promise<void> {
    presetMenuRef.current?.removeAttribute("open");
    const nextView = await run({ command: "preset", preset });
    if (nextView) {
      const scenarioId = PRESET_SCENARIO[preset];
      setSelectedScenario(scenarioId);
      setComparisonScenario(scenarioId);
      setMode("canned");
    }
  }

  async function beginMission(): Promise<void> {
    presetMenuRef.current?.removeAttribute("open");
    const nextView = await run({ command: "begin-mission" });
    if (nextView) {
      setSelectedScenario("live-mission");
      setMode("modified");
    }
  }

  async function resetRuntime(): Promise<void> {
    presetMenuRef.current?.removeAttribute("open");
    const nextView = await run({ command: "reset" });
    if (nextView) {
      setSelectedScenario("wrong-patient");
      setComparisonScenario("wrong-patient");
      setMode("canned");
      setModelRecommendation("Proceed");
      setInspectionOpen(false);
    }
  }

  async function loadScenario(scenario: ScenarioCard): Promise<void> {
    setPending(true);
    setError(null);
    try {
      let nextView = await sendCommand({ command: "preset", preset: scenario.preset });
      if (scenario.condition) {
        nextView = await sendCommand({
          command: "set-condition",
          conditionId: scenario.condition,
          satisfied: false,
        });
      }
      setView(nextView);
      setSelectedScenario(scenario.id);
      setComparisonScenario(scenario.id);
      setMode("canned");
    } catch (commandError) {
      setError(
        commandError instanceof Error ? commandError.message : "Runtime command failed.",
      );
    } finally {
      setPending(false);
    }
  }

  async function setCondition(
    conditionId: RequiredConditionId,
    satisfied: boolean,
  ): Promise<void> {
    const nextView = await run({ command: "set-condition", conditionId, satisfied });
    if (nextView) {
      setSelectedScenario("modified");
      setMode("modified");
    }
  }

  async function runSelectedScenario(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      let nextView = view;
      const scenario = SCENARIOS.find((candidate) => candidate.id === selectedScenario);

      if (mode === "canned" && scenario) {
        nextView = await sendCommand({ command: "preset", preset: scenario.preset });
        if (scenario.condition) {
          nextView = await sendCommand({
            command: "set-condition",
            conditionId: scenario.condition,
            satisfied: false,
          });
        }
      }

      if (nextView.canCommit) {
        nextView = await sendCommand({ command: "commit-and-dispatch" });
      }

      setView(nextView);
    } catch (commandError) {
      setError(
        commandError instanceof Error ? commandError.message : "Runtime command failed.",
      );
    } finally {
      setPending(false);
    }
  }

  function revealInspection(): void {
    setInspectionOpen(true);
    requestAnimationFrame(() => {
      inspectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const verdictToneClass =
    view.runtimeStatus === "AUTHORIZED"
      ? styles.verdictAUTHORIZED
      : view.runtimeStatus === "READY FOR EVIDENCE"
        ? styles.verdictREADY
        : "";
  const conditionsLocked =
    pending ||
    view.runtimeStatus === "AUTHORIZED" ||
    view.interaction.state !== "INSTRUCTION_ACKNOWLEDGED";

  return (
    <main className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>CR</span>
          <div>
            <strong>Constitutional Runtime</strong>
            <span>Protocol governs execution</span>
          </div>
        </div>
        <div className={styles.environmentStatus}>
          <span>Canonical simulator</span>
          <strong>Protocol online</strong>
        </div>
      </header>

      <div className={styles.shell}>
        <section
          className={styles.firstGlance}
          aria-labelledby="mission-heading"
          data-testid="first-glance"
        >
          <div className={styles.missionBlock}>
            <span className={styles.eyebrow}>Mission · {view.missionId}</span>
            <h1 id="mission-heading">Deliver insulin to Room 312</h1>
            <p data-testid="instruction">
              {view.instruction ? `“${view.instruction}”` : "Awaiting instruction…"}
            </p>
          </div>

          <div className={styles.decisionGrid} aria-label="Mission decision path">
            <article className={`${styles.decisionCard} ${styles.modelCard}`}>
              <label htmlFor="model-recommendation">Model</label>
              <select
                id="model-recommendation"
                value={modelRecommendation}
                aria-describedby="model-boundary-note"
                onChange={(event) => setModelRecommendation(event.currentTarget.value)}
              >
                <option>Proceed</option>
                <option>Do not proceed</option>
                <option>Patient is probably correct. Proceed</option>
              </select>
              <small id="model-boundary-note">Recommendation only · no authority</small>
            </article>

            <article
              className={`${styles.verdict} ${verdictToneClass}`}
              aria-live="polite"
            >
              <span>CRAS protocol verdict</span>
              <strong data-testid="protocol-verdict">{displayVerdict}</strong>
              <p className={styles.verdictReason} data-testid="headline-reason">
                <span>Reason</span>
                {headlineReason}
              </p>
              <small>
                Runtime state · <b data-testid="runtime-status">{view.runtimeStatus}</b>
              </small>
            </article>

            <article className={`${styles.decisionCard} ${styles.endpointCard}`}>
              <span>Endpoint</span>
              <strong data-testid="execution-state">{view.executionState}</strong>
              <small>
                {view.robot.dispatchCount === 0
                  ? "No movement · zero adapter calls"
                  : `${view.robot.dispatchCount} protected adapter call`}
              </small>
            </article>
          </div>

          <div className={styles.heroActions}>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => void runSelectedScenario()}
              disabled={pending}
              aria-describedby="run-scenario-note"
            >
              {pending ? "Running…" : "Run scenario"}
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={revealInspection}
              aria-controls="protocol-explanation"
              aria-expanded={inspectionOpen}
            >
              See why
            </button>
            <span className={styles.actionPromise} id="run-scenario-note">
              Model proposes → CRAS decides → endpoint obeys
            </span>
          </div>

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </section>

        <section
          className={styles.inspectionLayer}
          id="protocol-explanation"
          ref={inspectionRef}
          hidden={!inspectionOpen}
          data-testid="protocol-explanation"
          aria-labelledby="inspection-heading"
        >
          <div className={styles.inspectionHeader}>
            <div>
              <span className={styles.eyebrow}>Inspect the decision</span>
              <h2 id="inspection-heading">CRAS requires evidence, not confidence.</h2>
              <p>Resolve every condition, commit the record, then consume one grant.</p>
            </div>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => setInspectionOpen(false)}
            >
              Close explanation
            </button>
          </div>

          <div className={styles.conditionGrid} aria-label="Required protocol conditions">
            {view.conditions.map((condition) => (
              <label
                key={condition.id}
                className={`${styles.conditionNode} ${
                  condition.satisfied ? styles.conditionPass : styles.conditionFail
                }`}
              >
                <input
                  className={styles.conditionInput}
                  type="checkbox"
                  aria-label={condition.label}
                  checked={condition.satisfied}
                  disabled={conditionsLocked}
                  onChange={(event) =>
                    void setCondition(condition.id, event.currentTarget.checked)
                  }
                />
                <span className={styles.conditionIndicator} aria-hidden="true">
                  {condition.satisfied ? "✓" : "×"}
                </span>
                <span>
                  <strong>{condition.label}</strong>
                  <small>{condition.satisfied ? "Resolved" : condition.reason}</small>
                </span>
              </label>
            ))}
          </div>

          {view.blockingReasons.length > 0 ? (
            <div className={styles.blockingBox} data-testid="blocking-reasons">
              <strong>Why execution is blocked</strong>
              {view.blockingReasons.map((reason) => (
                <p key={reason}>{reason}</p>
              ))}
            </div>
          ) : null}

          <div className={styles.actionFlow} id="protected-action-flow">
            <span>1 · Commit evidence</span>
            <span>2 · Create authorization grant</span>
            <span>3 · Consume grant and dispatch endpoint</span>
          </div>

          <div className={styles.actionBar}>
            <div className={styles.evidenceStatus}>
              <span>{satisfiedCount}/4 conditions satisfied</span>
              <strong data-testid="evidence-state">{view.evidenceState}</strong>
            </div>
            <label className={styles.failureToggle}>
              <input
                type="checkbox"
                role="switch"
                checked={view.failureInjected}
                disabled={pending}
                onChange={(event) =>
                  void selectPreset(
                    event.currentTarget.checked ? "evidence-failure" : "successful",
                  )
                }
              />
              <span>
                <strong>Inject evidence-store failure</strong>
                <small>Repository boundary</small>
              </span>
            </label>
            <button
              type="button"
              className={styles.primaryButton}
              aria-describedby="protected-action-flow"
              disabled={!view.canCommit || pending}
              onClick={() => void run({ command: "commit-and-dispatch" })}
            >
              {pending ? "Working…" : "Commit evidence & execute"}
            </button>
          </div>

          <details className={`technical-disclosure ${styles.technicalDisclosure}`}>
            <summary>Technical audit record</summary>
            <p className={styles.inspectorIntro}>
              Evidence, the single-use grant, the execution receipt, and the server-owned
              event timeline remain separate records.
            </p>
            <div className={styles.inspectorGrid}>
              <div className={styles.auditRecords}>
                <RuntimeRecords view={view} />
                <article
                  className={`panel record-panel ${styles.executionRecord}`}
                  aria-labelledby="execution-record-heading"
                >
                  <span className="eyebrow">Endpoint receipt</span>
                  <h2 id="execution-record-heading">Execution record</h2>
                  {view.executionRecord ? (
                    <dl className="record-list" data-testid="execution-record">
                      <div>
                        <dt>Execution ID</dt>
                        <dd>{view.executionRecord.executionId}</dd>
                      </div>
                      <div>
                        <dt>State</dt>
                        <dd>{view.executionRecord.state}</dd>
                      </div>
                      <div>
                        <dt>Grant ID</dt>
                        <dd>{view.executionRecord.grantId}</dd>
                      </div>
                      <div>
                        <dt>Adapter calls</dt>
                        <dd>{view.executionRecord.adapterCallCount}</dd>
                      </div>
                      <div>
                        <dt>Final position</dt>
                        <dd>{view.executionRecord.finalPosition ?? "Unavailable"}</dd>
                      </div>
                    </dl>
                  ) : (
                    <div className="empty-state" data-testid="no-execution">
                      <span>No execution record</span>
                      <p>No validated grant has reached the endpoint adapter.</p>
                    </div>
                  )}
                </article>
              </div>
              <EventTimeline events={view.events} />
            </div>
          </details>
        </section>

        <section className={styles.interactionLayer} aria-labelledby="interaction-layer-heading">
          <div className={styles.layerHeader}>
            <span className={styles.eyebrow}>Explore the proof</span>
            <h2 id="interaction-layer-heading">Change the run. The rules stay fixed.</h2>
            <p>Choose a scenario, modify its inputs, and watch the same endpoint obey CRAS.</p>
          </div>

          <div className={styles.demoToolbar} aria-label="Demonstration controls">
            <div className={styles.toolbarActions}>
              <button
                className={styles.missionButton}
                onClick={() => void beginMission()}
                disabled={pending}
                type="button"
              >
                Live mission
              </button>
              <details className={styles.presetMenu} ref={presetMenuRef}>
                <summary>Demo presets</summary>
                <div>
                  <button
                    onClick={() => void selectPreset("blocked")}
                    disabled={pending}
                    type="button"
                  >
                    Blocked
                  </button>
                  <button
                    onClick={() => void selectPreset("successful")}
                    disabled={pending}
                    type="button"
                  >
                    Successful
                  </button>
                  <button
                    onClick={() => void selectPreset("evidence-failure")}
                    disabled={pending}
                    type="button"
                  >
                    Evidence failure
                  </button>
                </div>
              </details>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => void resetRuntime()}
                disabled={pending}
              >
                Reset
              </button>
            </div>
            <div className={styles.modeSwitch} aria-label="Demo mode">
              <button
                className={mode === "canned" ? styles.activeMode : ""}
                aria-pressed={mode === "canned"}
                onClick={() => setMode("canned")}
                type="button"
              >
                Canned runs
              </button>
              <button
                className={mode === "modified" ? styles.activeMode : ""}
                aria-pressed={mode === "modified"}
                onClick={() => setMode("modified")}
                type="button"
              >
                Modify run
              </button>
            </div>
          </div>

          <section className={styles.interactionPanel} aria-labelledby="interaction-heading">
            <div className={styles.interactionCopy}>
              <span className={styles.eyebrow}>Untrusted request ingress</span>
              <h3 id="interaction-heading">Alert, instruct, then evaluate</h3>
              <p data-testid="interaction-acknowledgment">
                {view.interaction.acknowledgment}
              </p>
            </div>
            <div className={styles.interactionActions}>
              <span className={styles.interactionState} data-testid="interaction-state">
                {view.interaction.state.replaceAll("_", " ")}
              </span>
              <button
                onClick={() => void run({ command: "alert-robot" })}
                disabled={!view.interaction.canAlert || pending}
                type="button"
              >
                Alert robot
              </button>
              <button
                onClick={() => void run({ command: "issue-instruction" })}
                disabled={!view.interaction.canInstruct || pending}
                type="button"
              >
                Give instruction
              </button>
            </div>
          </section>

          <div className={styles.workspace}>
            <aside className={styles.scenarioRail}>
              <div className={styles.sectionHeading}>
                <span>{mode === "canned" ? "Scenario library" : "Protocol controls"}</span>
                <strong>{mode === "canned" ? `${SCENARIOS.length} runs` : "Local demo"}</strong>
              </div>

              {mode === "canned" ? (
                <div className={styles.scenarioList}>
                  {SCENARIOS.map((scenario) => (
                    <button
                      key={scenario.id}
                      className={`${styles.scenarioCard} ${
                        selectedScenario === scenario.id ? styles.selectedScenario : ""
                      }`}
                      aria-pressed={selectedScenario === scenario.id}
                      onClick={() => void loadScenario(scenario)}
                      disabled={pending}
                      type="button"
                    >
                      <span
                        className={`${styles.scenarioIcon} ${
                          scenario.expected === "AUTHORIZED"
                            ? styles.scenarioIconAuthorized
                            : ""
                        }`}
                        aria-hidden="true"
                      >
                        {scenario.expected === "AUTHORIZED" ? "✓" : "×"}
                      </span>
                      <span>
                        <strong>{scenario.title}</strong>
                        <small>{scenario.subtitle}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className={styles.modifierPanel}>
                  <p>
                    Change the model recommendation above, then edit the four protocol
                    conditions. The recommendation is never submitted to CRAS.
                  </p>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={revealInspection}
                  >
                    Edit protocol conditions
                  </button>
                  <div className={styles.boundaryNote}>
                    <span>Authority boundary</span>
                    <strong>The protocol—not the recommendation—sets the verdict.</strong>
                    <small>
                      Condition edits use only the existing closed set-condition command.
                    </small>
                  </div>
                  <ol className={styles.protocolSteps}>
                    <li>Resolve required conditions</li>
                    <li>Commit durable evidence and grant</li>
                    <li>Consume the grant before endpoint dispatch</li>
                  </ol>
                </div>
              )}
            </aside>

            <section className={styles.stage} aria-busy={pending}>
              <div className={styles.stageHeader}>
                <div>
                  <span className={styles.eyebrow}>Original versus current</span>
                  <h3>Compare the run</h3>
                </div>
                <span className={styles.runBadge}>Run · {selectedScenario}</span>
              </div>

              <div className={styles.comparisonGrid} aria-label="Run comparison">
                <article>
                  <span>Original scenario</span>
                  <strong>{originalScenario?.title}</strong>
                  <small>Expected · {originalScenario?.expected}</small>
                </article>
                <span className={styles.comparisonArrow} aria-hidden="true">
                  →
                </span>
                <article>
                  <span>{selectedScenario === "modified" ? "Modified run" : "Current run"}</span>
                  <strong>{currentRunTitle}</strong>
                  <small>
                    {satisfiedCount}/4 conditions · {view.runtimeStatus}
                  </small>
                </article>
              </div>

              <div className={styles.visualGrid}>
                <RobotFloorMap robot={view.robot} />
                <div className={styles.markerPanel} aria-label="Prepared mission identifiers">
                  <div className={styles.markerCard}>
                    <span>Patient</span>
                    <strong>PAT-1001</strong>
                    <small>Sarah Johnson</small>
                  </div>
                  <div className={styles.markerCard}>
                    <span>Medication</span>
                    <strong>MED-2001</strong>
                    <small>Insulin lispro</small>
                  </div>
                  <div className={styles.markerCard}>
                    <span>Destination</span>
                    <strong>LOC-ROOM-312</strong>
                    <small>Room 312</small>
                  </div>
                  <div className={styles.markerCard}>
                    <span>Order</span>
                    <strong>ORDER-8001</strong>
                    <small>Active physician order</small>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className={styles.visionBoundary} aria-label="Endpoint observation boundary">
            <div className={styles.visionBoundaryHeading}>
              <span>Endpoint vehicle</span>
              <strong>Observation only · no authorization authority</strong>
            </div>
            <RobotVisionPanel />
          </section>
        </section>
      </div>
    </main>
  );
}
