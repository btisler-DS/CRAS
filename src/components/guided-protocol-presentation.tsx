import type { RequiredConditionId } from "../domain.js";
import type { RuntimeView } from "../ui/runtime-view.js";
import styles from "./runtime-dashboard.module.css";

export type GuidedPresentationStage =
  | "idle"
  | "mission"
  | "recommendation"
  | "authorization"
  | "consequence";

interface GuidedProtocolPresentationProps {
  readonly stage: Exclude<GuidedPresentationStage, "idle">;
  readonly view: RuntimeView;
  readonly modelRecommendation: string;
  readonly visibleConditionCount: number;
  readonly evidencePending: boolean;
  readonly authorizationResolved: boolean;
  readonly verdictReason: string;
  readonly onSkip: () => void;
  readonly onInspectDecision: () => void;
  readonly onRunAnotherScenario: () => void;
}

const PRESENTATION_STEPS = [
  { id: "mission", label: "Mission" },
  { id: "recommendation", label: "Recommendation" },
  { id: "authorization", label: "Authorization" },
  { id: "consequence", label: "Consequence" },
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
  ADMINISTRATION_WINDOW_VALID: "Window",
};

function sentenceCaseReason(reason: string): string {
  const withoutPeriod = reason.trim().replace(/\.$/, "");
  return `${withoutPeriod.charAt(0).toLocaleLowerCase()}${withoutPeriod.slice(1)}`;
}

export function GuidedProtocolPresentation({
  stage,
  view,
  modelRecommendation,
  visibleConditionCount,
  evidencePending,
  authorizationResolved,
  verdictReason,
  onSkip,
  onInspectDecision,
  onRunAnotherScenario,
}: GuidedProtocolPresentationProps) {
  const activeStep = PRESENTATION_STEPS.findIndex((step) => step.id === stage);
  const recommendationVisible = activeStep >= 1;
  const authorizationVisible = activeStep >= 2;
  const consequenceVisible = activeStep >= 3;
  const authorized = authorizationResolved && view.runtimeStatus === "AUTHORIZED";
  const displayVerdict = authorizationResolved
    ? authorized
      ? "AUTHORIZED"
      : "BLOCKED"
    : "EVALUATING";
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
  const recommendationProceeding = modelRecommendation === "Proceed";
  const causalReason =
    verdictReason === "Patient identity unresolved"
      ? "patient identity was unresolved"
      : sentenceCaseReason(verdictReason);
  const causalStatement = authorized
    ? "The model recommendation did not authorize execution. CRAS authorized only after every required condition was satisfied and the evidence transaction committed."
    : recommendationProceeding
      ? `The model recommended proceeding, but CRAS blocked execution because ${causalReason}.`
      : `The model recommendation did not authorize execution. CRAS blocked execution because ${causalReason}.`;

  return (
    <section
      className={styles.guidedPresentation}
      aria-label="Guided authorization story"
      data-stage={stage}
      data-testid="guided-presentation"
    >
      <div className={styles.guidedNavigation}>
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
        {!consequenceVisible ? (
          <button className={styles.skipPresentation} type="button" onClick={onSkip}>
            Skip animation
          </button>
        ) : null}
      </div>

      <div className={styles.guidedFrame} data-testid="presentation-stage">
        <header className={styles.guidedMissionAnchor} data-testid="guided-mission">
          <div>
            <span className={styles.guidedKicker}>
              {stage === "mission" ? "Mission received" : "Mission"}
            </span>
            <strong>Deliver insulin to Room 312</strong>
          </div>
          <small>Medication delivery · Pharmacy → Room 312</small>
        </header>

        <div className={styles.guidedStoryChain}>
          {recommendationVisible ? (
            <article
              className={`${styles.guidedFact} ${styles.guidedRecommendation}`}
              data-testid="guided-recommendation"
            >
              <span className={styles.guidedFactIndex}>01</span>
              <div>
                <p>Model recommendation</p>
                <h2>{modelRecommendation}</h2>
                <small>Recommendation only. No authority.</small>
              </div>
            </article>
          ) : null}

          {authorizationVisible ? (
            <article
              className={`${styles.guidedFact} ${styles.guidedAuthorization} ${
                authorizationResolved
                  ? authorized
                    ? styles.guidedAuthorizationGranted
                    : styles.guidedAuthorizationBlocked
                  : styles.guidedAuthorizationPending
              }`}
              data-testid="guided-authorization"
            >
              <span className={styles.guidedFactIndex}>02</span>
              <div className={styles.guidedAuthorizationBody}>
                <div className={styles.guidedAuthorizationHeading}>
                  <div>
                    <p>CRAS authorization</p>
                    <h2 key={displayVerdict}>{displayVerdict}</h2>
                    <small>
                      {authorizationResolved
                        ? verdictReason
                        : "Checking required conditions and durable evidence"}
                    </small>
                  </div>
                  <ul className={styles.guidedConditionStrip} aria-label="Protocol checks">
                    {conditions.map((condition, index) => {
                      const revealed = index < visibleConditionCount;
                      return (
                        <li
                          key={condition.id}
                          className={`${revealed ? styles.guidedConditionRevealed : ""} ${
                            condition.satisfied
                              ? styles.guidedConditionPassed
                              : styles.guidedConditionFailed
                          }`}
                          aria-hidden={!revealed}
                          data-revealed={revealed}
                          data-testid={`guided-condition-${condition.id}`}
                        >
                          <span>{condition.label}</span>
                          <strong aria-hidden="true">
                            {condition.satisfied ? "✓" : "×"}
                          </strong>
                        </li>
                      );
                    })}
                    <li
                      className={`${
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
                      <strong aria-hidden="true">
                        {evidencePending ? "···" : evidencePassed ? "✓" : "×"}
                      </strong>
                      <small>{evidenceLabel}</small>
                    </li>
                  </ul>
                </div>
                {authorizationResolved ? (
                  <p className={styles.guidedCausalStatement} data-testid="causal-statement">
                    {causalStatement}
                  </p>
                ) : null}
              </div>
            </article>
          ) : null}

          {consequenceVisible ? (
            <article
              className={`${styles.guidedFact} ${styles.guidedConsequence} ${
                endpointMoving
                  ? styles.guidedEndpointAuthorized
                  : styles.guidedEndpointLocked
              }`}
              data-testid="guided-consequence"
            >
              <span className={styles.guidedFactIndex}>03</span>
              <div>
                <p>Endpoint consequence</p>
                <h2>{endpointState}</h2>
                <small data-testid="guided-adapter-result">
                  {endpointMoving
                    ? `${view.robot.dispatchCount} adapter call after authorization`
                    : "Zero adapter calls"}
                </small>
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
            </article>
          ) : null}
        </div>
      </div>

      {consequenceVisible ? (
        <div
          className={styles.guidedCompletion}
          data-testid="presentation-complete"
        >
          <p role="status">
            <strong>Decision complete.</strong> The full case remains above so you can
            inspect it without reconstructing the sequence.
          </p>
          <div>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={onInspectDecision}
            >
              Inspect the decision
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={onRunAnotherScenario}
            >
              Run another scenario
            </button>
          </div>
        </div>
      ) : null}

      <span className={styles.visuallyHidden} role="status" aria-live="polite">
        {stage === "mission"
          ? "Mission received: Deliver insulin to Room 312."
          : stage === "recommendation"
            ? `Model recommendation: ${modelRecommendation}. Recommendation only; no authority.`
            : stage === "authorization"
              ? authorizationResolved
                ? `CRAS authorization: ${displayVerdict}. ${verdictReason}.`
                : "CRAS is evaluating required conditions and evidence."
              : `Endpoint consequence: ${endpointState}. ${
                  endpointMoving ? view.robot.dispatchCount : "Zero"
                } adapter calls.`}
      </span>
    </section>
  );
}
