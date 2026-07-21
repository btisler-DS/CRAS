"use client";

import { useMemo, useState } from "react";

import type { RequiredConditionId } from "../domain.js";
import type { DemoPreset, RuntimeView } from "../ui/runtime-view.js";
import { EventTimeline } from "./event-timeline.js";
import { RobotFloorMap } from "./robot-floor-map.js";
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
  const [view, setView] = useState(initialView);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState("success");
  const [mode, setMode] = useState<"canned" | "modified">("canned");
  const [modelRecommendation, setModelRecommendation] = useState("Proceed with delivery.");

  const satisfiedCount = useMemo(
    () => view.conditions.filter((condition) => condition.satisfied).length,
    [view.conditions],
  );

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

  async function loadScenario(scenario: ScenarioCard): Promise<void> {
    setPending(true);
    setError(null);
    setSelectedScenario(scenario.id);
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
    } catch (commandError) {
      setError(
        commandError instanceof Error ? commandError.message : "Runtime command failed.",
      );
    } finally {
      setPending(false);
    }
  }

  function setCondition(conditionId: RequiredConditionId, satisfied: boolean): void {
    void run({ command: "set-condition", conditionId, satisfied });
  }

  const protocolStatus =
    view.runtimeStatus === "AUTHORIZED"
      ? "AUTHORIZED"
      : view.runtimeStatus === "READY FOR EVIDENCE"
        ? "READY"
        : "BLOCKED";

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
        <div className={styles.modeSwitch} aria-label="Demo mode">
          <button
            className={mode === "canned" ? styles.activeMode : ""}
            onClick={() => setMode("canned")}
            type="button"
          >
            Canned runs
          </button>
          <button
            className={mode === "modified" ? styles.activeMode : ""}
            onClick={() => setMode("modified")}
            type="button"
          >
            Modify run
          </button>
        </div>
      </header>

      <div className={styles.shell}>
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>Mission {view.missionId}</span>
            <h1>Deliver medication to Room 312</h1>
            <p>
              The endpoint remains blocked until protocol conditions are resolved and
              evidence commits successfully.
            </p>
          </div>
          <div className={`${styles.verdict} ${styles[`verdict${protocolStatus}`]}`}>
            <span>Authorization</span>
            <strong>{protocolStatus}</strong>
            <small>{view.authorizationDetail}</small>
          </div>
        </section>

        <section className={styles.proofStrip} aria-label="Separation of responsibilities">
          <div>
            <span>Model recommendation</span>
            <strong>{modelRecommendation}</strong>
          </div>
          <div>
            <span>Protocol verdict</span>
            <strong>{protocolStatus}</strong>
          </div>
          <div>
            <span>Endpoint state</span>
            <strong>{view.executionState === "EXECUTED" ? "ACTED" : "NO MOVEMENT"}</strong>
          </div>
        </section>

        <div className={styles.workspace}>
          <aside className={styles.scenarioRail}>
            <div className={styles.sectionHeading}>
              <span>{mode === "canned" ? "Scenario library" : "Modify protocol inputs"}</span>
              <strong>{SCENARIOS.length} runs</strong>
            </div>

            {mode === "canned" ? (
              <div className={styles.scenarioList}>
                {SCENARIOS.map((scenario) => (
                  <button
                    key={scenario.id}
                    className={`${styles.scenarioCard} ${
                      selectedScenario === scenario.id ? styles.selectedScenario : ""
                    }`}
                    onClick={() => void loadScenario(scenario)}
                    disabled={pending}
                    type="button"
                  >
                    <span className={styles.scenarioIcon}>
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
                <p>Change one observation, then compare the resulting protocol state.</p>
                {view.conditions.map((condition) => (
                  <label key={condition.id} className={styles.conditionToggle}>
                    <input
                      type="checkbox"
                      checked={condition.satisfied}
                      disabled={pending || view.runtimeStatus === "AUTHORIZED"}
                      onChange={(event) =>
                        setCondition(condition.id, event.currentTarget.checked)
                      }
                    />
                    <span>
                      <strong>{condition.label}</strong>
                      <small>{condition.satisfied ? "Satisfied" : condition.reason}</small>
                    </span>
                  </label>
                ))}
                <label className={styles.modelField}>
                  <span>Model recommendation</span>
                  <select
                    value={modelRecommendation}
                    onChange={(event) => setModelRecommendation(event.currentTarget.value)}
                  >
                    <option>Proceed with delivery.</option>
                    <option>Do not proceed.</option>
                    <option>Patient is probably correct. Proceed.</option>
                  </select>
                </label>
              </div>
            )}
          </aside>

          <section className={styles.stage}>
            <div className={styles.stageHeader}>
              <div>
                <span className={styles.eyebrow}>Shared operational view</span>
                <h2>Mission state</h2>
              </div>
              <span className={styles.runBadge}>Run · {selectedScenario}</span>
            </div>

            <div className={styles.visualGrid}>
              <RobotFloorMap robot={view.robot} />
              <div className={styles.markerPanel}>
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

            <div className={styles.conditionGrid}>
              {view.conditions.map((condition) => (
                <div
                  key={condition.id}
                  className={`${styles.conditionNode} ${
                    condition.satisfied ? styles.conditionPass : styles.conditionFail
                  }`}
                >
                  <span>{condition.satisfied ? "✓" : "×"}</span>
                  <div>
                    <strong>{condition.label}</strong>
                    <small>{condition.satisfied ? "Resolved" : condition.reason}</small>
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.actionBar}>
              <div>
                <span>{satisfiedCount}/4 conditions satisfied</span>
                <strong>{view.evidenceState}</strong>
              </div>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void run({ command: "reset" })}
                disabled={pending}
              >
                Reset
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!view.canCommit || pending}
                onClick={() => void run({ command: "commit-and-dispatch" })}
              >
                {pending ? "Evaluating…" : "Commit evidence & authorize"}
              </button>
            </div>

            {error ? <p className={styles.error}>{error}</p> : null}
          </section>
        </div>

        <details className={styles.inspector}>
          <summary>Protocol inspector and audit record</summary>
          <div className={styles.inspectorGrid}>
            <RuntimeRecords view={view} />
            <EventTimeline events={view.events} />
          </div>
        </details>
      </div>
    </main>
  );
}
