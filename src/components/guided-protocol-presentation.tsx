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
  readonly onReviewVerification: () => void;
  readonly onTryAnotherCase: () => void;
  readonly onViewTechnicalAudit: () => void;
}

const PRESENTATION_STEPS = [
  { id: "mission", label: "Task" },
  { id: "recommendation", label: "AI suggestion" },
  { id: "authorization", label: "Safety decision" },
  { id: "consequence", label: "Vehicle response" },
] as const;

const CONDITION_ORDER: readonly RequiredConditionId[] = [
  "PATIENT_IDENTITY_VERIFIED",
  "MEDICATION_MATCHED",
  "PHYSICIAN_ORDER_ACTIVE",
  "ADMINISTRATION_WINDOW_VALID",
];

const CONDITION_LABELS: Record<RequiredConditionId, string> = {
  PATIENT_IDENTITY_VERIFIED: "Patient",
  MEDICATION_MATCHED: "Medication",
  PHYSICIAN_ORDER_ACTIVE: "Order",
  ADMINISTRATION_WINDOW_VALID: "Timing",
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
  onReviewVerification,
  onTryAnotherCase,
  onViewTechnicalAudit,
}: GuidedProtocolPresentationProps) {
  const activeStep = PRESENTATION_STEPS.findIndex((step) => step.id === stage);
  const recommendationVisible = activeStep >= 1;
  const authorizationVisible = activeStep >= 2;
  const consequenceVisible = activeStep >= 3;
  const authorized = authorizationResolved && view.runtimeStatus === "AUTHORIZED";
  const displayVerdict = authorizationResolved
    ? authorized
      ? "APPROVED"
      : "BLOCKED"
    : "CHECKING";
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
    ? "Saving"
    : evidencePassed
      ? "Saved"
      : view.evidenceState === "FAILED"
        ? "Save failed"
        : "Not started";
  const recommendationProceeding = modelRecommendation === "Proceed";
  const causalReason =
    verdictReason === "Patient verification required."
      ? "patient identity was not verified"
      : sentenceCaseReason(verdictReason);
  const causalStatement = authorized
    ? "The AI suggestion did not approve the delivery. CRAS approved it only after every required check passed and the verification record was saved."
    : recommendationProceeding
      ? `The AI suggested proceeding, but CRAS blocked the delivery because ${causalReason}.`
      : `The AI suggestion did not approve the delivery. CRAS blocked it because ${causalReason}.`;

  return (
    <section
      className={styles.guidedPresentation}
      aria-label="Guided medication safety review"
      data-stage={stage}
      data-testid="guided-presentation"
    >
      <div className={styles.guidedNavigation}>
        <ol className={styles.guidedProgress} aria-label="Presentation progress">
          {PRESENTATION_STEPS.map((step, index) => {
            const complete =
              index < activeStep || (consequenceVisible && index === activeStep);
            const active = index === activeStep && !consequenceVisible;
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
              {stage === "mission" ? "Delivery task received" : "Delivery task"}
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
                <p>AI suggestion</p>
                <h2>{modelRecommendation}</h2>
                <small>Advisory only. It cannot approve delivery.</small>
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
                    <p>CRAS safety decision</p>
                    <h2 key={displayVerdict}>{displayVerdict}</h2>
                    <small>
                      {authorizationResolved
                        ? verdictReason
                        : "Checking patient, medication, order, timing, and record"}
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
                            : view.evidenceState === "FAILED"
                              ? styles.guidedConditionFailed
                              : styles.guidedConditionWaiting
                      }`}
                      aria-hidden={visibleConditionCount <= conditions.length}
                      data-revealed={visibleConditionCount > conditions.length}
                      data-testid="guided-condition-evidence"
                    >
                      <span>Record</span>
                      <strong aria-hidden="true">
                        {evidencePending
                          ? "···"
                          : evidencePassed
                            ? "✓"
                            : view.evidenceState === "FAILED"
                              ? "×"
                              : "·"}
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
                <p>Vehicle response</p>
                <h2>{endpointState}</h2>
                <small data-testid="guided-adapter-result">
                  {endpointMoving
                    ? `${view.robot.dispatchCount} delivery command sent after approval`
                    : "No delivery command was issued"}
                </small>
                <div
                  className={styles.guidedFloorplan}
                  aria-label={
                    endpointMoving
                      ? "Approved delivery vehicle moving from Pharmacy to Room 312"
                      : "Blocked delivery vehicle stationary at Pharmacy"
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
          <div className={styles.guidedCompletionHeading}>
            <span role="status">Safety review complete</span>
            <h2>What would you like to do next?</h2>
            <p>The completed decision remains above while you choose what to inspect.</p>
          </div>
          <div
            className={styles.guidedNextActions}
            aria-label="Choose what to explore next"
          >
            <button
              className={`${styles.primaryButton} ${styles.guidedNextAction}`}
              type="button"
              onClick={onReviewVerification}
            >
              <strong>
                Review why delivery was {authorized ? "approved" : "blocked"}
              </strong>
              <small>See the verification and next required action.</small>
            </button>
            <button
              className={`${styles.secondaryButton} ${styles.explorationButton} ${styles.guidedNextAction}`}
              type="button"
              onClick={onTryAnotherCase}
            >
              <strong>Choose another case</strong>
              <small>Select a different clinical situation.</small>
            </button>
            <button
              className={`${styles.secondaryButton} ${styles.guidedNextAction}`}
              type="button"
              onClick={onViewTechnicalAudit}
            >
              <strong>View technical audit</strong>
              <small>Inspect the formal evidence and execution trail.</small>
            </button>
          </div>
        </div>
      ) : null}

      <span className={styles.visuallyHidden} role="status" aria-live="polite">
        {stage === "mission"
          ? "Delivery task received: Deliver insulin to Room 312."
          : stage === "recommendation"
            ? `AI suggestion: ${modelRecommendation}. Advisory only; it cannot approve delivery.`
            : stage === "authorization"
              ? authorizationResolved
                ? `CRAS safety decision: ${displayVerdict}. ${verdictReason}.`
                : "CRAS is checking required safety conditions and the verification record."
              : `Vehicle response: ${endpointState}. ${
                  endpointMoving ? view.robot.dispatchCount : "Zero"
                } delivery commands.`}
      </span>
    </section>
  );
}
