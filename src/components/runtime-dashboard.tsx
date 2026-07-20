"use client";

import { useState } from "react";

import type { RequiredConditionId } from "../domain.js";
import type { DemoPreset, RuntimeView } from "../ui/runtime-view.js";
import { EventTimeline } from "./event-timeline.js";
import { RobotFloorMap } from "./robot-floor-map.js";
import { RobotVisionPanel } from "./robot-vision-panel.js";
import { RuntimeRecords } from "./runtime-records.js";
import { StatusPanel } from "./status-panel.js";

interface RuntimeDashboardProps {
  readonly initialView: RuntimeView;
}

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

  async function run(command: object): Promise<void> {
    setPending(true);
    setError(null);
    try {
      setView(await sendCommand(command));
    } catch (commandError) {
      setError(
        commandError instanceof Error
          ? commandError.message
          : "Runtime command failed.",
      );
    } finally {
      setPending(false);
    }
  }

  function selectPreset(preset: DemoPreset): void {
    void run({ command: "preset", preset });
  }

  function setCondition(
    conditionId: RequiredConditionId,
    satisfied: boolean,
  ): void {
    void run({ command: "set-condition", conditionId, satisfied });
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">CR</span>
          <div>
            <strong>Constitutional Runtime</strong>
            <span>Evidence before execution</span>
          </div>
        </div>
        <div className="topbar-actions" aria-label="Scenario presets">
          <button
            className="button--mission"
            onClick={() => void run({ command: "begin-mission" })}
            disabled={pending}
          >
            Live mission
          </button>
          <details className="preset-menu">
            <summary>Demo presets</summary>
            <div>
              <button onClick={() => selectPreset("blocked")} disabled={pending}>
                Blocked
              </button>
              <button onClick={() => selectPreset("successful")} disabled={pending}>
                Successful
              </button>
              <button
                onClick={() => selectPreset("evidence-failure")}
                disabled={pending}
              >
                Evidence failure
              </button>
            </div>
          </details>
          <button
            className="button--reset"
            onClick={() => void run({ command: "reset" })}
            disabled={pending}
          >
            Reset
          </button>
        </div>
      </header>

      <div className="page-shell">
        <RobotVisionPanel />
        <section className="interaction-panel" aria-labelledby="interaction-heading">
          <div>
            <span className="eyebrow">Mission interaction · {view.missionId}</span>
            <h2 id="interaction-heading">Alert, instruct, then authorize</h2>
            <p data-testid="interaction-acknowledgment">
              {view.interaction.acknowledgment}
            </p>
          </div>
          <div className="interaction-actions">
            <button
              onClick={() => void run({ command: "alert-robot" })}
              disabled={!view.interaction.canAlert || pending}
            >
              Alert robot
            </button>
            <button
              onClick={() => void run({ command: "issue-instruction" })}
              disabled={!view.interaction.canInstruct || pending}
            >
              Give instruction
            </button>
            <span className="interaction-state" data-testid="interaction-state">
              {view.interaction.state.replaceAll("_", " ")}
            </span>
          </div>
        </section>

        <div className="hero-copy">
          <span className="eyebrow">Live authorization trace · medication delivery</span>
          <p className="instruction-label">Instruction</p>
          <blockquote data-testid="instruction">
            {view.instruction ? `“${view.instruction}”` : "Awaiting instruction…"}
          </blockquote>
        </div>

        <StatusPanel view={view} />

        {error ? <p className="error-banner">{error}</p> : null}

        <div className="primary-grid">
          <section className="panel conditions-panel" aria-labelledby="conditions-heading">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Required conditions</span>
                <h2 id="conditions-heading">Release checklist</h2>
              </div>
              <span className="condition-count">
                {view.conditions.filter((condition) => condition.satisfied).length}/4
              </span>
            </div>
            <div className="condition-list">
              {view.conditions.map((condition) => (
                <label key={condition.id} className="condition-row">
                  <input
                    type="checkbox"
                    checked={condition.satisfied}
                    disabled={pending || view.runtimeStatus === "AUTHORIZED" || view.interaction.state !== "INSTRUCTION_ACKNOWLEDGED"}
                    onChange={(event) =>
                      setCondition(condition.id, event.currentTarget.checked)
                    }
                  />
                  <span className="checkmark" aria-hidden="true" />
                  <span>
                    <strong>{condition.label}</strong>
                    <small>{condition.reason}</small>
                  </span>
                </label>
              ))}
            </div>
            {view.blockingReasons.length > 0 ? (
              <div className="blocking-box" data-testid="blocking-reasons">
                <strong>Why execution is blocked</strong>
                {view.blockingReasons.map((reason) => (
                  <p key={reason}>{reason}</p>
                ))}
              </div>
            ) : null}
            <label className="failure-toggle">
              <input
                type="checkbox"
                role="switch"
                checked={view.failureInjected}
                disabled={pending}
                onChange={(event) =>
                  selectPreset(
                    event.currentTarget.checked ? "evidence-failure" : "successful",
                  )
                }
              />
              <span>
                <strong>Inject evidence-store failure</strong>
                <small>Fails at the persistence boundary</small>
              </span>
            </label>
            <button
              className="button button--primary commit-button"
              disabled={!view.canCommit || pending}
              onClick={() => void run({ command: "commit-and-dispatch" })}
            >
              {pending ? "Working…" : "Commit evidence & execute"}
            </button>
          </section>

          <RobotFloorMap robot={view.robot} />
        </div>

        <details className="technical-disclosure">
          <summary>Evidence, grant, and complete audit trail</summary>
          <p>
            Open this section for judge-facing technical evidence. It is not required
            to operate the mission.
          </p>
          <RuntimeRecords view={view} />
          <EventTimeline events={view.events} />
        </details>
      </div>
    </main>
  );
}
