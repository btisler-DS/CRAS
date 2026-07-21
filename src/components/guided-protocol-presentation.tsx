import type { RequiredConditionId } from "../domain.js";
import type { RuntimeView } from "../ui/runtime-view.js";
import styles from "./runtime-dashboard.module.css";

export type GuidedPresentationStage =
  | "idle"
  | "mission"
  | "model"
  | "conditions"
  | "verdict"
  | "endpoint";

interface GuidedProtocolPresentationProps {
  readonly stage: Exclude<GuidedPresentationStage, "idle">;
  readonly view: RuntimeView;
  readonly modelRecommendation: string;
  readonly visibleConditionCount: number;
  readonly evidencePending: boolean;
  readonly verdictReason: string;
}

const PRESENTATION_STEPS = [
  { id: "mission", label: "Mission" },
  { id: "model", label: "Model" },
  { id: "conditions", label: "Protocol" },
  { id: "verdict", label: "CRAS" },
  { id: "endpoint", label: "Endpoint" },
] as const;

const CONDITION_ORDER: readonly RequiredConditionId[] = [
  "PATIENT_IDENTITY_VERIFIED",
  "MEDICATION_MATCHED",
  "PHYSICIAN_ORDER_ACTIVE",
  "ADMINISTRATION_WINDOW_VALID",
];

const CONDITION_LABELS: Record<RequiredConditionId, string> = {
  PATIENT_IDENTITY_VERIFIED: "Identity",
  MEDICATION_MATCHED: "Medication",
  PHYSICIAN_ORDER_ACTIVE: "Order",
  ADMINISTRATION_WINDOW_VALID: "Administration window",
};

export function GuidedProtocolPresentation({
  stage,
  view,
  modelRecommendation,
  visibleConditionCount,
  evidencePending,
  verdictReason,
}: GuidedProtocolPresentationProps) {
  const activeStep = PRESENTATION_STEPS.findIndex((step) => step.id === stage);
  const displayVerdict =
    view.runtimeStatus === "AUTHORIZED" ? "AUTHORIZED" : "BLOCKED";
  const authorized = displayVerdict === "AUTHORIZED";
  const endpointMoving = authorized && view.executionState === "EXECUTED";
  const endpointState = endpointMoving
    ? "Moving"
    : view.robot.movementState === "FAILED"
      ? "Stopped"
      : "Stationary";
  const conditions = CONDITION_ORDER.map((id) => {
    const condition = view.conditions.find((candidate) => candidate.id === id);
    return {
      id,
      label: CONDITION_LABELS[id],
      satisfied: condition?.satisfied ?? false,
    };
  });
  const evidencePassed = view.evidenceState === "COMMITTED";
  const evidenceLabel = evidencePending
    ? "Committing"
    : evidencePassed
      ? "Committed"
      : view.evidenceState === "FAILED"
        ? "Commit failed"
        : "Not eligible";

  return (
    <section
      className={styles.guidedPresentation}
      aria-label="Guided protocol presentation"
      aria-live="polite"
      aria-atomic="true"
      data-stage={stage}
      data-testid="guided-presentation"
    >
      <ol className={styles.guidedProgress} aria-label="Presentation progress">
        {PRESENTATION_STEPS.map((step, index) => {
          const complete = index < activeStep;
          const active = index === activeStep;
          return (
            <li
              key={step.id}
              className={`${complete ? styles.guidedProgressComplete : ""} ${
                active ? styles.guidedProgressActive : ""
              }`}
              aria-current={active ? "step" : undefined}
            >
              <span>{complete ? "✓" : index + 1}</span>
              <strong>{step.label}</strong>
            </li>
          );
        })}
      </ol>

      <div className={styles.guidedFrame} data-testid="presentation-stage">
        {stage === "mission" ? (
          <div className={styles.guidedStageEnter} data-testid="guided-mission">
            <span className={styles.guidedKicker}>Mission received</span>
            <p>Mission</p>
            <h2>Deliver insulin to Room 312</h2>
          </div>
        ) : null}

        {stage === "model" ? (
          <div className={styles.guidedStageEnter} data-testid="guided-model">
            <span className={styles.guidedKicker}>Recommendation received</span>
            <p>Model</p>
            <h2>{modelRecommendation}</h2>
            <small>Recommendation only · no authority</small>
          </div>
        ) : null}

        {stage === "conditions" ? (
          <div
            className={`${styles.guidedConditionsStage} ${styles.guidedStageEnter}`}
            data-testid="guided-conditions"
          >
            <div>
              <span className={styles.guidedKicker}>Protocol evaluation</span>
              <h2>What must be true?</h2>
            </div>
            <ul>
              {conditions.map((condition, index) => {
                const revealed = index < visibleConditionCount;
                return (
                  <li
                    key={condition.id}
                    className={`${styles.guidedCondition} ${
                      revealed ? styles.guidedConditionRevealed : ""
                    } ${
                      condition.satisfied
                        ? styles.guidedConditionPassed
                        : styles.guidedConditionFailed
                    }`}
                    aria-hidden={!revealed}
                    data-revealed={revealed}
                    data-testid={`guided-condition-${condition.id}`}
                  >
                    <span>{condition.label}</span>
                    <small>{condition.satisfied ? "Resolved" : "Unresolved"}</small>
                    <strong aria-hidden="true">
                      {condition.satisfied ? "✓" : "×"}
                    </strong>
                  </li>
                );
              })}
              <li
                className={`${styles.guidedCondition} ${
                  visibleConditionCount > conditions.length
                    ? styles.guidedConditionRevealed
                    : ""
                } ${
                  evidencePending
                    ? styles.guidedConditionPending
                    : evidencePassed
                      ? styles.guidedConditionPassed
                      : styles.guidedConditionFailed
                }`}
                aria-hidden={visibleConditionCount <= conditions.length}
                data-revealed={visibleConditionCount > conditions.length}
                data-testid="guided-condition-evidence"
              >
                <span>Evidence</span>
                <small>{evidenceLabel}</small>
                <strong aria-hidden="true">
                  {evidencePending ? "···" : evidencePassed ? "✓" : "×"}
                </strong>
              </li>
            </ul>
          </div>
        ) : null}

        {stage === "verdict" ? (
          <div
            className={`${styles.guidedVerdict} ${styles.guidedStageEnter} ${
              authorized
                ? styles.guidedVerdictAuthorized
                : styles.guidedVerdictBlocked
            }`}
            aria-live="assertive"
            data-testid="guided-verdict"
          >
            <span className={styles.guidedKicker}>Authorization decision</span>
            <p>CRAS</p>
            <h2>{displayVerdict}</h2>
            <small>{verdictReason}</small>
          </div>
        ) : null}

        {stage === "endpoint" ? (
          <div
            className={`${styles.guidedEndpoint} ${styles.guidedStageEnter} ${
              endpointMoving ? styles.guidedEndpointAuthorized : styles.guidedEndpointLocked
            }`}
            data-testid="guided-endpoint"
          >
            <div className={styles.guidedEndpointHeading}>
              <div>
                <span className={styles.guidedKicker}>Endpoint response</span>
                <p>Endpoint</p>
                <h2>{endpointState}</h2>
              </div>
              <strong>{endpointMoving ? "Protected dispatch" : "No movement"}</strong>
            </div>
            <div
              className={styles.guidedFloorplan}
              aria-label={
                endpointMoving
                  ? "Authorized endpoint moving from Pharmacy to Room 312"
                  : "Blocked endpoint stationary at Pharmacy"
              }
              data-testid="guided-floorplan"
            >
              <div className={styles.guidedRoom}>
                <span>Start</span>
                <strong>Pharmacy</strong>
              </div>
              <div className={styles.guidedRoute} aria-hidden="true">
                <span />
              </div>
              <div className={styles.guidedRobot} aria-hidden="true">
                CR
              </div>
              <div className={styles.guidedRoom}>
                <span>Destination</span>
                <strong>Room 312</strong>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
