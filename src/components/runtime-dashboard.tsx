"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { RequiredConditionId } from "../domain.js";
import type { DemoPreset, RuntimeView } from "../ui/runtime-view.js";
import { EventTimeline } from "./event-timeline.js";
import {
  GuidedProtocolPresentation,
  type GuidedPresentationStage,
} from "./guided-protocol-presentation.js";
import { RobotFloorMap } from "./robot-floor-map.js";
import { RobotVisionPanel } from "./robot-vision-panel.js";
import { RuntimeRecords } from "./runtime-records.js";
import styles from "./runtime-dashboard.module.css";

interface RuntimeDashboardProps {
  readonly initialView: RuntimeView;
}

interface ScenarioCard {
  readonly id: string;
  readonly glyph: string;
  readonly title: string;
  readonly subtitle: string;
  readonly preset: DemoPreset;
  readonly condition?: RequiredConditionId;
  readonly expected: "AUTHORIZED" | "BLOCKED";
}

interface CaseChange {
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

interface CaseFact {
  readonly text: string;
  readonly tone: "attention" | "verified" | "neutral";
}

interface ClinicalConditionCopy {
  readonly label: string;
  readonly passed: string;
  readonly missing: string;
  readonly nextStep: string;
}

const SCENARIOS: readonly ScenarioCard[] = [
  {
    id: "success",
    glyph: "→",
    title: "Successful delivery",
    subtitle: "Every safety check is complete",
    preset: "successful",
    expected: "AUTHORIZED",
  },
  {
    id: "wrong-patient",
    glyph: "ID",
    title: "Wrong patient",
    subtitle: "Patient identity is not verified",
    preset: "successful",
    condition: "PATIENT_IDENTITY_VERIFIED",
    expected: "BLOCKED",
  },
  {
    id: "order-hold",
    glyph: "Rx",
    title: "Order on hold",
    subtitle: "The physician order is inactive",
    preset: "successful",
    condition: "PHYSICIAN_ORDER_ACTIVE",
    expected: "BLOCKED",
  },
  {
    id: "wrong-medication",
    glyph: "≠",
    title: "Wrong medication",
    subtitle: "Scanned medication does not match",
    preset: "successful",
    condition: "MEDICATION_MATCHED",
    expected: "BLOCKED",
  },
  {
    id: "outside-window",
    glyph: "12",
    title: "Outside administration window",
    subtitle: "Administration time is outside the verified window",
    preset: "successful",
    condition: "ADMINISTRATION_WINDOW_VALID",
    expected: "BLOCKED",
  },
  {
    id: "evidence-failure",
    glyph: "DB",
    title: "Verification record unavailable",
    subtitle: "All checks pass, but the record cannot be saved",
    preset: "evidence-failure",
    expected: "BLOCKED",
  },
];

const PRESET_SCENARIO: Record<DemoPreset, string> = {
  blocked: "wrong-patient",
  successful: "success",
  "evidence-failure": "evidence-failure",
};

const CLINICAL_CONDITIONS: Record<RequiredConditionId, ClinicalConditionCopy> = {
  PATIENT_IDENTITY_VERIFIED: {
    label: "Patient",
    passed: "Patient identity verified",
    missing: "Patient verification required",
    nextStep:
      "Verify the patient's identity before CRAS can release the delivery.",
  },
  MEDICATION_MATCHED: {
    label: "Medication",
    passed: "Medication matches the order",
    missing: "Medication does not match the order",
    nextStep:
      "Verify that the medication matches the active order before CRAS can release the delivery.",
  },
  PHYSICIAN_ORDER_ACTIVE: {
    label: "Active order",
    passed: "Medication order is active",
    missing: "Medication order is not active",
    nextStep:
      "Confirm that the physician order is active before CRAS can release the delivery.",
  },
  ADMINISTRATION_WINDOW_VALID: {
    label: "Administration time",
    passed: "Administration time verified",
    missing: "Administration time requires verification",
    nextStep:
      "Verify that the administration time is within the approved window before CRAS can release the delivery.",
  },
};

const PRESENTATION_TIMING = {
  mission: 700,
  recommendation: 700,
  condition: 240,
  evidenceLead: 160,
  evidenceMinimum: 320,
  authorization: 950,
} as const;

function getClinicalDecision(runtimeView: RuntimeView): string {
  switch (runtimeView.runtimeStatus) {
    case "AUTHORIZED":
      return "Delivery approved";
    case "READY FOR EVIDENCE":
      return "Ready to record verification";
    case "EVIDENCE COMMIT FAILED":
    case "UNAUTHORIZED":
      return "Delivery blocked";
  }
}

function getClinicalReason(runtimeView: RuntimeView): string {
  if (runtimeView.runtimeStatus === "AUTHORIZED") {
    return "Every required check passed and the verification record was saved.";
  }
  if (runtimeView.runtimeStatus === "EVIDENCE COMMIT FAILED") {
    return "All safety checks passed, but the verification record could not be saved.";
  }
  if (runtimeView.runtimeStatus === "READY FOR EVIDENCE") {
    return "All safety checks are complete. Record the verification before release.";
  }

  const missingCondition = runtimeView.conditions.find(
    (condition) => !condition.satisfied,
  );
  return missingCondition
    ? `${CLINICAL_CONDITIONS[missingCondition.id].missing}.`
    : "A required safety check is still incomplete.";
}

function getClinicalNextStep(runtimeView: RuntimeView): string {
  if (runtimeView.runtimeStatus === "AUTHORIZED") {
    return "No further action is required for this delivery.";
  }
  if (runtimeView.runtimeStatus === "EVIDENCE COMMIT FAILED") {
    return "Retry when the verification record is available. CRAS cannot release the delivery until it is saved.";
  }
  if (runtimeView.runtimeStatus === "READY FOR EVIDENCE") {
    return "Save the verification record before CRAS can release the delivery.";
  }

  const missingCondition = runtimeView.conditions.find(
    (condition) => !condition.satisfied,
  );
  return missingCondition
    ? CLINICAL_CONDITIONS[missingCondition.id].nextStep
    : "Complete every required safety check before CRAS can release the delivery.";
}

function getVehicleStatement(runtimeView: RuntimeView): string {
  if (runtimeView.robot.position === "Room 312") {
    return "Vehicle arrived at Room 312.";
  }
  if (runtimeView.robot.movementState === "FAILED") {
    return "Vehicle stopped before completing the delivery.";
  }
  return "Vehicle remained at Pharmacy.";
}

function getCommandStatement(runtimeView: RuntimeView): string {
  return runtimeView.robot.dispatchCount === 0
    ? "No delivery command was issued."
    : `${runtimeView.robot.dispatchCount} delivery command sent after approval.`;
}

function getVehicleOutcomeExplanation(runtimeView: RuntimeView): string {
  if (runtimeView.robot.target === "physical") {
    return runtimeView.robot.dispatchCount === 0
      ? "CRAS issued no protected command, so the physical vehicle received no movement instruction."
      : "CRAS released the commissioned physical behavior after authorization. This display does not claim ground navigation."
  }
  if (runtimeView.robot.position === "Room 312") {
    return "CRAS approved the delivery, and the simulated vehicle traveled from Pharmacy to Room 312."
  }
  if (runtimeView.runtimeStatus === "EVIDENCE COMMIT FAILED") {
    return "Although every safety check passed, the verification record could not be saved, so CRAS never released the vehicle."
  }
  if (runtimeView.robot.movementState === "FAILED") {
    return "CRAS released the delivery, but the vehicle stopped before reaching Room 312."
  }
  if (runtimeView.runtimeStatus === "READY FOR EVIDENCE") {
    return "Every safety check passed, but CRAS has not released the vehicle because the verification record has not been saved."
  }
  return "CRAS issued no delivery command, so the vehicle remained at the Pharmacy."
}

function scrollToAndFocus(target: HTMLElement | null): void {
  if (!target) return;
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  target.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "start",
  });
  target.focus({ preventScroll: true });
}

function getBaselineDecision(scenario: ScenarioCard): string {
  return scenario.condition ? "Delivery blocked" : "Ready to record verification";
}

function isBaselineConditionSatisfied(
  scenario: ScenarioCard,
  conditionId: RequiredConditionId,
): boolean {
  return scenario.condition !== conditionId;
}

function formatList(items: readonly string[]): string {
  if (items.length < 2) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
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
  const [caseEditing, setCaseEditing] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [presentationStage, setPresentationStage] =
    useState<GuidedPresentationStage>("idle");
  const [presentationView, setPresentationView] = useState<RuntimeView | null>(null);
  const [visiblePresentationConditions, setVisiblePresentationConditions] =
    useState(0);
  const [presentationEvidencePending, setPresentationEvidencePending] =
    useState(false);
  const [presentationAuthorizationResolved, setPresentationAuthorizationResolved] =
    useState(false);
  const inspectionRef = useRef<HTMLElement>(null);
  const scenarioLibraryRef = useRef<HTMLElement>(null);
  const technicalAuditRef = useRef<HTMLDetailsElement>(null);
  const firstGlanceRef = useRef<HTMLElement>(null);
  const presentationFocusRef = useRef<HTMLDivElement>(null);
  const presentationRunRef = useRef(0);
  const presentationWaitRef = useRef<(() => void) | null>(null);
  const skipAnimationRef = useRef(false);

  useEffect(
    () => () => {
      presentationRunRef.current += 1;
      presentationWaitRef.current?.();
    },
    [],
  );

  const satisfiedCount = useMemo(
    () => view.conditions.filter((condition) => condition.satisfied).length,
    [view.conditions],
  );
  const originalScenario =
    SCENARIOS.find((scenario) => scenario.id === comparisonScenario) ?? SCENARIOS[0]!;
  const currentScenario = SCENARIOS.find(
    (scenario) => scenario.id === selectedScenario,
  );
  const displayVerdict =
    view.runtimeStatus === "UNAUTHORIZED" ||
    view.runtimeStatus === "EVIDENCE COMMIT FAILED"
      ? "BLOCKED"
      : view.runtimeStatus === "READY FOR EVIDENCE"
        ? "READY TO RECORD"
        : "APPROVED";
  const clinicalDecision = getClinicalDecision(view);
  const clinicalReason = getClinicalReason(view);
  const clinicalNextStep = getClinicalNextStep(view);
  const presentationReason = getClinicalReason(presentationView ?? view);
  const presentationVisible = presentationStage !== "idle";
  const presentationRunning =
    presentationVisible && presentationStage !== "consequence";
  const endpointConsequence =
    view.robot.movementState === "ARRIVED"
      ? "Arrived"
      : view.robot.movementState === "MOVING"
        ? "Moving"
        : view.robot.movementState === "RETURNED"
          ? "Returned"
          : view.robot.movementState === "FAILED"
            ? "Stopped"
            : "Stationary";
  const endpointActive = view.executionState === "EXECUTED";
  const evidenceProtocolState =
    view.evidenceState === "COMMITTED"
      ? "passed"
      : view.evidenceState === "FAILED"
        ? "failed"
        : "waiting";
  const authorizationProtocolState =
    view.runtimeStatus === "AUTHORIZED"
      ? "passed"
      : view.runtimeStatus === "READY FOR EVIDENCE"
        ? "waiting"
        : "failed";
  const caseChanges = useMemo(() => {
    const changes: CaseChange[] = [];

    for (const condition of view.conditions) {
      const baselineSatisfied = isBaselineConditionSatisfied(
        originalScenario,
        condition.id,
      );
      if (condition.satisfied !== baselineSatisfied) {
        changes.push({
          label: `${CLINICAL_CONDITIONS[condition.id].label} verification`,
          before: baselineSatisfied ? "Verified" : "Verification required",
          after: condition.satisfied ? "Verified" : "Verification required",
        });
      }
    }

    if (modelRecommendation !== "Proceed") {
      changes.push({
        label: "AI suggestion",
        before: "Proceed",
        after: modelRecommendation,
      });
    }

    const baselineDecision = getBaselineDecision(originalScenario);
    if (
      changes.some((change) => change.label !== "AI suggestion") &&
      baselineDecision !== clinicalDecision
    ) {
      changes.push({
        label: "Delivery result",
        before: baselineDecision,
        after: clinicalDecision,
      });
    }

    return changes;
  }, [clinicalDecision, modelRecommendation, originalScenario, view.conditions]);
  const caseModified = caseChanges.length > 0;
  const verificationLabel =
    view.evidenceState === "COMMITTED"
      ? "Verification record saved"
      : view.evidenceState === "FAILED"
        ? "Verification record unavailable"
        : satisfiedCount === view.conditions.length
          ? "Ready to save verification"
          : "Verification still required";
  const caseSummaryFacts = useMemo(() => {
    const missing = view.conditions.filter((condition) => !condition.satisfied);
    const verified = view.conditions.filter((condition) => condition.satisfied);
    const facts: CaseFact[] = [];

    if (missing.length > 0) {
      facts.push(
        ...missing.map((condition) => ({
          text: `${CLINICAL_CONDITIONS[condition.id].missing}.`,
          tone: "attention" as const,
        })),
      );
      if (verified.length > 0) {
        const verifiedList = formatList(
          verified.map((condition) =>
            CLINICAL_CONDITIONS[condition.id].label.toLocaleLowerCase(),
          ),
        );
        facts.push(
          {
            text: `${verifiedList.charAt(0).toLocaleUpperCase()}${verifiedList.slice(1)} verified.`,
            tone: "verified",
          },
        );
      }
    } else {
      facts.push({
        text: "Patient, medication, active order, and administration time verified.",
        tone: "verified",
      });
    }

    if (view.evidenceState === "FAILED") {
      facts.push({
        text: "The verification record could not be saved.",
        tone: "attention",
      });
    }
    facts.push(
      {
        text: `${clinicalDecision}.`,
        tone:
          view.runtimeStatus === "AUTHORIZED"
            ? "verified"
            : view.runtimeStatus === "READY FOR EVIDENCE"
              ? "neutral"
              : "attention",
      },
      { text: getVehicleStatement(view), tone: "neutral" },
      { text: getCommandStatement(view), tone: "neutral" },
    );
    return facts;
  }, [clinicalDecision, view]);

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
    const nextView = await run({ command: "preset", preset });
    if (nextView) {
      const scenarioId = PRESET_SCENARIO[preset];
      setSelectedScenario(scenarioId);
      setComparisonScenario(scenarioId);
      setMode("canned");
      setModelRecommendation("Proceed");
      setCaseEditing(false);
    }
  }

  async function beginMission(): Promise<void> {
    const nextView = await run({ command: "begin-mission" });
    if (nextView) {
      setSelectedScenario("live-mission");
      setMode("modified");
      setCaseEditing(false);
    }
  }

  async function resetRuntime(): Promise<void> {
    presentationRunRef.current += 1;
    presentationWaitRef.current?.();
    skipAnimationRef.current = false;
    setPresentationStage("idle");
    setPresentationView(null);
    setVisiblePresentationConditions(0);
    setPresentationEvidencePending(false);
    setPresentationAuthorizationResolved(false);
    const nextView = await run({ command: "reset" });
    if (nextView) {
      setSelectedScenario("wrong-patient");
      setComparisonScenario("wrong-patient");
      setMode("canned");
      setModelRecommendation("Proceed");
      setInspectionOpen(false);
      setCaseEditing(false);
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
      setModelRecommendation("Proceed");
      closePresentation();
      setInspectionOpen(false);
      setCaseEditing(false);
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

  function changeModelRecommendation(recommendation: string): void {
    setModelRecommendation(recommendation);
    setMode(recommendation === "Proceed" && !caseModified ? "canned" : "modified");
  }

  async function restoreOriginalCase(): Promise<void> {
    await loadScenario(originalScenario);
    setInspectionOpen(true);
    setCaseEditing(false);
    requestAnimationFrame(() => {
      inspectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function releaseDelivery(): Promise<void> {
    const nextView = await run({ command: "commit-and-dispatch" });
    if (nextView) showDecisionSummary(nextView);
  }

  async function runSelectedScenario(): Promise<void> {
    const runId = presentationRunRef.current + 1;
    presentationRunRef.current = runId;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    skipAnimationRef.current = reducedMotion;
    const pause = (milliseconds: number): Promise<boolean> => {
      if (skipAnimationRef.current) {
        return Promise.resolve(presentationRunRef.current === runId);
      }

      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          presentationWaitRef.current = null;
          resolve(presentationRunRef.current === runId);
        }, milliseconds);
        presentationWaitRef.current = () => {
          window.clearTimeout(timer);
          presentationWaitRef.current = null;
          resolve(presentationRunRef.current === runId);
        };
      });
    };

    setPending(true);
    setError(null);
    setInspectionOpen(false);
    setPresentationView(view);
    setVisiblePresentationConditions(0);
    setPresentationEvidencePending(false);
    setPresentationAuthorizationResolved(false);
    setPresentationStage("mission");
    requestAnimationFrame(() => {
      firstGlanceRef.current?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
      presentationFocusRef.current?.focus({ preventScroll: true });
    });

    try {
      let preparedView = view;
      const scenario = SCENARIOS.find((candidate) => candidate.id === selectedScenario);

      if (mode === "canned" && scenario) {
        preparedView = await sendCommand({
          command: "preset",
          preset: scenario.preset,
        });
        if (scenario.condition) {
          preparedView = await sendCommand({
            command: "set-condition",
            conditionId: scenario.condition,
            satisfied: false,
          });
        }
      }

      if (!(await pause(PRESENTATION_TIMING.mission))) return;
      setPresentationStage("recommendation");

      if (!(await pause(PRESENTATION_TIMING.recommendation))) return;
      setPresentationView(preparedView);
      setPresentationStage("authorization");

      for (let conditionCount = 1; conditionCount <= 4; conditionCount += 1) {
        if (!(await pause(PRESENTATION_TIMING.condition))) return;
        setVisiblePresentationConditions(conditionCount);
      }

      if (!(await pause(PRESENTATION_TIMING.condition))) return;
      setPresentationEvidencePending(preparedView.canCommit);
      setVisiblePresentationConditions(5);

      if (!(await pause(PRESENTATION_TIMING.evidenceLead))) return;
      let finalView = preparedView;
      if (preparedView.canCommit) {
        finalView = await sendCommand({ command: "commit-and-dispatch" });
      }

      if (!(await pause(PRESENTATION_TIMING.evidenceMinimum))) return;

      if (presentationRunRef.current !== runId) return;
      setPresentationEvidencePending(false);
      setPresentationView(finalView);
      setPresentationAuthorizationResolved(true);

      if (!(await pause(PRESENTATION_TIMING.authorization))) return;
      setPresentationStage("consequence");
      setView(finalView);
      requestAnimationFrame(() => {
        firstGlanceRef.current?.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "start",
        });
        presentationFocusRef.current?.focus({ preventScroll: true });
      });
    } catch (commandError) {
      if (presentationRunRef.current !== runId) return;
      setPresentationStage("idle");
      setPresentationView(null);
      setPresentationEvidencePending(false);
      setPresentationAuthorizationResolved(false);
      setError(
        commandError instanceof Error ? commandError.message : "Runtime command failed.",
      );
    } finally {
      if (presentationRunRef.current === runId) setPending(false);
    }
  }

  function skipPresentation(): void {
    skipAnimationRef.current = true;
    presentationWaitRef.current?.();
  }

  function closePresentation(): void {
    presentationRunRef.current += 1;
    presentationWaitRef.current?.();
    skipAnimationRef.current = false;
    setPresentationStage("idle");
    setPresentationView(null);
    setVisiblePresentationConditions(0);
    setPresentationEvidencePending(false);
    setPresentationAuthorizationResolved(false);
  }

  function showDecisionSummary(nextView: RuntimeView): void {
    setInspectionOpen(false);
    setCaseEditing(false);
    setPresentationView(nextView);
    setVisiblePresentationConditions(5);
    setPresentationEvidencePending(false);
    setPresentationAuthorizationResolved(true);
    setPresentationStage("consequence");
    requestAnimationFrame(() => scrollToAndFocus(presentationFocusRef.current));
  }

  function returnToDecisionSummary(): void {
    setInspectionOpen(false);
    setCaseEditing(false);
    if (technicalAuditRef.current) technicalAuditRef.current.open = false;
    requestAnimationFrame(() =>
      scrollToAndFocus(
        presentationStage === "consequence"
          ? presentationFocusRef.current
          : firstGlanceRef.current,
      ),
    );
  }

  function revealInspection(editCase = false): void {
    if (technicalAuditRef.current) technicalAuditRef.current.open = false;
    setInspectionOpen(true);
    setCaseEditing(editCase);
    requestAnimationFrame(() => scrollToAndFocus(inspectionRef.current));
  }

  function reviewPresentationVerification(): void {
    revealInspection(false);
  }

  function beginCaseModification(): void {
    setCaseEditing(true);
    requestAnimationFrame(() => {
      const missingCondition = inspectionRef.current?.querySelector<HTMLInputElement>(
        "input[type='checkbox']:not(:checked)",
      );
      missingCondition?.focus();
    });
  }

  function tryAnotherSafetyCase(): void {
    setInspectionOpen(false);
    setCaseEditing(false);
    if (technicalAuditRef.current) technicalAuditRef.current.open = false;
    requestAnimationFrame(() => scrollToAndFocus(scenarioLibraryRef.current));
  }

  function viewTechnicalAudit(): void {
    setInspectionOpen(false);
    setCaseEditing(false);
    if (technicalAuditRef.current) technicalAuditRef.current.open = true;
    requestAnimationFrame(() => {
      const summary = technicalAuditRef.current?.querySelector<HTMLElement>("summary");
      scrollToAndFocus(summary ?? null);
    });
  }

  const verdictToneClass =
    view.runtimeStatus === "AUTHORIZED"
      ? styles.verdictAUTHORIZED
      : view.runtimeStatus === "READY FOR EVIDENCE"
        ? styles.verdictREADY
        : "";
  const conditionsLocked =
    !caseEditing ||
    pending ||
    view.runtimeStatus === "AUTHORIZED" ||
    view.interaction.state !== "INSTRUCTION_ACKNOWLEDGED";
  const canModifyCase =
    view.runtimeStatus === "UNAUTHORIZED" ||
    view.runtimeStatus === "READY FOR EVIDENCE";
  const releaseGuidance =
    view.runtimeStatus === "AUTHORIZED"
      ? "This delivery is complete. No further clinical action is required."
      : view.canCommit
        ? "Save the verification record before CRAS can release the delivery."
        : clinicalNextStep;

  return (
    <main
      className={`${styles.app} ${presentationRunning ? styles.appPresenting : ""}`}
    >
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>CR</span>
          <div>
            <strong>Constitutional Runtime</strong>
            <span>Safety checks govern delivery</span>
          </div>
        </div>
        <div className={styles.environmentStatus}>
          <span>Live demonstration</span>
          <strong>Simulator ready</strong>
        </div>
      </header>

      <div className={styles.shell}>
        <section
          className={`${styles.firstGlance} ${
            presentationVisible ? styles.firstGlancePresenting : ""
          }`}
          ref={firstGlanceRef}
          aria-labelledby={presentationVisible ? undefined : "mission-heading"}
          aria-label={presentationVisible ? "Guided protocol presentation" : undefined}
          data-testid="first-glance"
          tabIndex={-1}
        >
          {presentationStage !== "idle" ? (
            <div
              className={styles.presentationFocus}
              ref={presentationFocusRef}
              tabIndex={-1}
              data-testid="presentation-focus"
            >
              <GuidedProtocolPresentation
                stage={presentationStage}
                view={presentationView ?? view}
                modelRecommendation={modelRecommendation}
                visibleConditionCount={visiblePresentationConditions}
                evidencePending={presentationEvidencePending}
                authorizationResolved={presentationAuthorizationResolved}
                verdictReason={presentationReason}
                onSkip={skipPresentation}
                onReviewVerification={reviewPresentationVerification}
                onTryAnotherCase={tryAnotherSafetyCase}
                onViewTechnicalAudit={viewTechnicalAudit}
              />
            </div>
          ) : (
            <>
              <div className={styles.missionBlock}>
                <span className={styles.eyebrow}>Medication delivery review</span>
                <span className={styles.missionLabel}>Delivery task</span>
                <h1 id="mission-heading">Deliver insulin to Room 312</h1>
                <p className={styles.thesis}>
                  <strong>CRAS applies the same safety checks to every delivery.</strong>{" "}
                  AI can suggest what to do, but only CRAS can approve release.
                </p>
                <p className={styles.visuallyHidden} data-testid="instruction">
                  {view.instruction ? `“${view.instruction}”` : "Awaiting instruction…"}
                </p>
              </div>

              <div className={styles.decisionGrid} aria-label="Medication delivery decision">
                <article className={`${styles.decisionCard} ${styles.modelCard}`}>
                  <span>AI suggestion</span>
                  <strong data-testid="model-recommendation-display">
                    {modelRecommendation}
                  </strong>
                  <small>Advisory only · cannot approve delivery</small>
                </article>

                <article
                  className={`${styles.verdict} ${verdictToneClass}`}
                  aria-live="polite"
                >
                  <span>CRAS delivery decision</span>
                  <strong key={displayVerdict} data-testid="protocol-verdict">
                    {displayVerdict}
                  </strong>
                  <p className={styles.verdictReason} data-testid="headline-reason">
                    <span>Reason</span>
                    {clinicalReason}
                  </p>
                  <p className={styles.verdictNextStep}>
                    <span>Next</span>
                    {clinicalNextStep}
                  </p>
                </article>

                <article
                  className={`${styles.decisionCard} ${styles.endpointCard} ${
                    endpointActive ? styles.endpointActive : styles.endpointPaused
                  }`}
                  aria-live="polite"
                >
                  <span>Delivery vehicle</span>
                  <strong key={endpointConsequence} data-testid="endpoint-consequence">
                    {view.robot.position === "Room 312" ? "Room 312" : "At Pharmacy"}
                  </strong>
                  <small>{getVehicleStatement(view)}</small>
                  <span className={styles.visuallyHidden} data-testid="execution-state">
                    {view.executionState}
                  </span>
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
                  onClick={() => revealInspection()}
                  aria-controls="protocol-explanation"
                  aria-expanded={inspectionOpen}
                >
                  Review verification
                </button>
                <span className={styles.visuallyHidden} id="run-scenario-note">
                  The AI suggests. CRAS decides. The delivery vehicle obeys.
                </span>
              </div>

              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </section>

        <section
          className={`${styles.inspectionLayer} ${
            presentationRunning ? styles.presentationBackground : ""
          }`}
          id="protocol-explanation"
          ref={inspectionRef}
          hidden={!inspectionOpen}
          inert={presentationRunning}
          aria-hidden={presentationRunning || undefined}
          data-testid="protocol-explanation"
          aria-labelledby="inspection-heading"
          tabIndex={-1}
        >
          <div className={styles.inspectionHeader}>
            <div>
              <span className={styles.eyebrow}>Verification review</span>
              <h2 id="inspection-heading">
                {view.runtimeStatus === "AUTHORIZED"
                  ? "Why was this delivery approved?"
                  : view.runtimeStatus === "READY FOR EVIDENCE"
                    ? "What is needed before release?"
                    : "Why was this delivery blocked?"}
              </h2>
              <p>{clinicalNextStep}</p>
            </div>
            <div className={styles.inspectionHeaderActions}>
              {!caseEditing && canModifyCase ? (
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={beginCaseModification}
                >
                  Modify this case
                </button>
              ) : null}
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={returnToDecisionSummary}
              >
                Back to decision summary
              </button>
            </div>
          </div>

          <div className={styles.clinicalDecisionBanner} data-testid="blocking-reasons">
            <div>
              <span>Current decision</span>
              <strong>{clinicalDecision}</strong>
            </div>
            <p>{clinicalReason}</p>
          </div>

          <div className={styles.inspectionSummary}>
            <div className={styles.modelControl}>
              {caseEditing ? (
                <>
                  <label htmlFor="model-recommendation">AI suggestion</label>
                  <select
                    id="model-recommendation"
                    aria-label="Model"
                    value={modelRecommendation}
                    aria-describedby="model-boundary-note"
                    disabled={view.runtimeStatus === "AUTHORIZED"}
                    onChange={(event) =>
                      changeModelRecommendation(event.currentTarget.value)
                    }
                  >
                    <option>Proceed</option>
                    <option>Do not proceed</option>
                    <option>Patient is probably correct. Proceed</option>
                  </select>
                </>
              ) : (
                <div className={styles.modelReadout} data-testid="review-model-suggestion">
                  <span>AI suggestion</span>
                  <strong>{modelRecommendation}</strong>
                </div>
              )}
              <small id="model-boundary-note">
                Advisory only. Changing this suggestion never changes the safety checks.
              </small>
            </div>

            <ul className={styles.protocolMap} aria-label="Medication safety checks">
              {view.conditions.map((condition) => (
                <li
                  key={condition.id}
                  className={
                    condition.satisfied ? styles.protocolPassed : styles.protocolFailed
                  }
                >
                  {caseEditing ? (
                    <label>
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
                      <span>{CLINICAL_CONDITIONS[condition.id].label}</span>
                      <small>
                        {condition.satisfied ? "Verified" : "Verification required"}
                      </small>
                      <strong aria-hidden="true">{condition.satisfied ? "✓" : "×"}</strong>
                    </label>
                  ) : (
                    <div className={styles.protocolConditionReadout}>
                      <span>{CLINICAL_CONDITIONS[condition.id].label}</span>
                      <small>
                        {condition.satisfied ? "Verified" : "Verification required"}
                      </small>
                      <strong aria-hidden="true">{condition.satisfied ? "✓" : "×"}</strong>
                    </div>
                  )}
                </li>
              ))}
              <li
                className={
                  evidenceProtocolState === "passed"
                    ? styles.protocolPassed
                    : evidenceProtocolState === "failed"
                      ? styles.protocolFailed
                      : styles.protocolWaiting
                }
              >
                <span>Verification record</span>
                <small>{verificationLabel}</small>
                <strong aria-hidden="true">
                  {evidenceProtocolState === "passed"
                    ? "✓"
                    : evidenceProtocolState === "failed"
                      ? "×"
                      : "·"}
                </strong>
              </li>
              <li
                className={
                  authorizationProtocolState === "passed"
                    ? styles.protocolPassed
                    : authorizationProtocolState === "failed"
                      ? styles.protocolFailed
                      : styles.protocolWaiting
                }
              >
                <span>Delivery decision</span>
                <small>{clinicalDecision}</small>
                <span className={styles.visuallyHidden} data-testid="runtime-status">
                  {view.runtimeStatus}
                </span>
                <strong aria-hidden="true">
                  {authorizationProtocolState === "passed"
                    ? "✓"
                    : authorizationProtocolState === "failed"
                      ? "×"
                      : "·"}
                </strong>
              </li>
              <li
                className={
                  endpointActive ? styles.protocolPassed : styles.protocolWaiting
                }
              >
                <span>Delivery vehicle</span>
                <small>{view.robot.position === "Room 312" ? "Arrived" : "At Pharmacy"}</small>
                <strong aria-hidden="true">{endpointActive ? "→" : "Ⅱ"}</strong>
              </li>
            </ul>
          </div>

          <div className={styles.actionBar}>
            <div className={styles.evidenceStatus}>
              <span>{satisfiedCount} of 4 safety checks verified</span>
              <strong>{verificationLabel}</strong>
              <span className={styles.visuallyHidden} data-testid="evidence-state">
                {view.evidenceState}
              </span>
            </div>
            <p className={styles.releaseGuidance} data-testid="release-guidance">
              {releaseGuidance}
            </p>
            {caseEditing ? (
              <>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void restoreOriginalCase()}
                  disabled={pending}
                >
                  Restore original case
                </button>
                {caseModified && !view.canCommit ? (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void runSelectedScenario()}
                    disabled={pending}
                  >
                    Run modified case
                  </button>
                ) : null}
              </>
            ) : null}
            {caseEditing && view.canCommit ? (
              <button
                type="button"
                className={styles.primaryButton}
                disabled={pending}
                onClick={() => void releaseDelivery()}
              >
                {pending ? "Recording…" : "Record verification and release delivery"}
              </button>
            ) : null}
          </div>
        </section>

        <section
          className={`${styles.interactionLayer} ${
            presentationRunning ? styles.presentationBackground : ""
          }`}
          aria-labelledby="interaction-layer-heading"
          inert={presentationRunning}
          aria-hidden={presentationRunning || undefined}
          data-testid="interaction-layer"
          tabIndex={-1}
        >
          <section className={`${styles.stage} ${styles.caseOutcome}`} aria-busy={pending}>
            <div className={styles.stageHeader}>
              <div>
                <span className={styles.eyebrow}>After the decision</span>
                <h2 id="interaction-layer-heading">Vehicle outcome</h2>
                <p
                  className={styles.vehicleOutcomeExplanation}
                  data-testid="vehicle-outcome-explanation"
                >
                  {getVehicleOutcomeExplanation(view)}
                </p>
              </div>
              <span className={styles.runBadge}>
                {caseModified
                  ? `${originalScenario.title} · modified`
                  : (currentScenario?.title ?? originalScenario.title)}
              </span>
            </div>

            <div className={styles.outcomeLayout}>
              <div className={styles.outcomeNarrative}>
                {caseModified ? (
                  <div
                    className={styles.changeList}
                    aria-label="Changed case fields"
                    data-testid="case-comparison"
                  >
                    {caseChanges.map((change) => (
                      <article key={change.label}>
                        <strong>{change.label}</strong>
                        <div>
                          <span>{change.before}</span>
                          <span aria-hidden="true">→</span>
                          <span>{change.after}</span>
                        </div>
                      </article>
                    ))}
                    <div className={styles.outcomeWhy}>
                      <span>Why it matters</span>
                      <p>{clinicalReason}</p>
                    </div>
                  </div>
                ) : (
                  <ul className={styles.caseFacts} data-testid="case-summary">
                    {caseSummaryFacts.map((fact) => (
                      <li
                        key={fact.text}
                        className={
                          fact.tone === "verified"
                            ? styles.caseFactVerified
                            : fact.tone === "attention"
                              ? styles.caseFactAttention
                              : styles.caseFactNeutral
                        }
                      >
                        <span aria-hidden="true">
                          {fact.tone === "verified"
                            ? "✓"
                            : fact.tone === "attention"
                              ? "!"
                              : "·"}
                        </span>
                        <p>{fact.text}</p>
                      </li>
                    ))}
                  </ul>
                )}

                <div className={styles.caseActions}>
                  {canModifyCase ? (
                    <button
                      className={styles.primaryButton}
                      type="button"
                      onClick={() => revealInspection(true)}
                    >
                      Modify this case
                    </button>
                  ) : null}
                  {caseModified ? (
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={() => void restoreOriginalCase()}
                      disabled={pending}
                    >
                      Restore original case
                    </button>
                  ) : null}
                  <button
                    className={`${styles.secondaryButton} ${styles.explorationButton}`}
                    type="button"
                    onClick={tryAnotherSafetyCase}
                  >
                    Choose another case
                  </button>
                  {presentationStage === "consequence" ? (
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={returnToDecisionSummary}
                    >
                      Back to decision summary
                    </button>
                  ) : null}
                  <button
                    className={
                      presentationStage === "consequence" && !caseModified
                        ? styles.replayButton
                        : styles.primaryButton
                    }
                    type="button"
                    onClick={() => void runSelectedScenario()}
                    disabled={pending}
                  >
                    {caseModified
                      ? "Run modified case"
                      : presentationStage === "consequence"
                        ? "Replay demonstration"
                        : "Run selected case"}
                  </button>
                </div>

                <details className={styles.deliveryDetails}>
                  <summary>Delivery details</summary>
                  <div className={styles.markerPanel} aria-label="Medication delivery details">
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
                </details>
              </div>

              <RobotFloorMap robot={view.robot} />
            </div>
          </section>

          <section
            className={styles.scenarioRail}
            aria-labelledby="scenario-library-heading"
            data-testid="scenario-library"
            ref={scenarioLibraryRef}
            tabIndex={-1}
          >
            <div className={styles.layerHeader}>
              <span className={styles.eyebrow}>Safety case library</span>
              <h2 id="scenario-library-heading">Choose another case</h2>
              <p>
                Select a case, then run it to see how the same safety checks control the
                delivery vehicle.
              </p>
            </div>
            <div className={styles.sectionHeading}>
              <span>Choose a case</span>
              <strong>{SCENARIOS.length} cases</strong>
            </div>
            <div className={styles.scenarioList}>
              {SCENARIOS.map((scenario) => (
                <button
                  key={scenario.id}
                  className={`${styles.scenarioCard} ${
                    selectedScenario === scenario.id && !caseModified
                      ? styles.selectedScenario
                      : ""
                  }`}
                  aria-pressed={selectedScenario === scenario.id && !caseModified}
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
                    {scenario.glyph}
                  </span>
                  <span className={styles.scenarioCardCopy}>
                    <strong>{scenario.title}</strong>
                    <small>{scenario.subtitle}</small>
                  </span>
                  <span
                    className={`${styles.outcomeBadge} ${
                      scenario.expected === "AUTHORIZED"
                        ? styles.outcomeAuthorized
                        : styles.outcomeBlocked
                    }`}
                  >
                    Expected · Delivery {scenario.expected === "AUTHORIZED" ? "approved" : "blocked"}
                  </span>
                </button>
              ))}
            </div>
            <div className={styles.scenarioSelectionActions}>
              <p>
                Selected: <strong>{currentScenario?.title ?? originalScenario.title}</strong>
              </p>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={returnToDecisionSummary}
              >
                Back to decision summary
              </button>
              <button
                className={styles.primaryButton}
                type="button"
                onClick={() => void runSelectedScenario()}
                disabled={pending}
              >
                Run selected case
              </button>
            </div>
          </section>

          <details
            className={styles.optionalPanel}
            onToggle={(event) => setCameraOpen(event.currentTarget.open)}
          >
            <summary>
              <span>Optional vehicle camera</span>
              <small>Observation only · not required for the safety decision</small>
            </summary>
            {cameraOpen ? (
              <div className={styles.visionBoundary} aria-label="Vehicle camera observation">
                <RobotVisionPanel />
              </div>
            ) : null}
          </details>

          <details
            className={`technical-disclosure ${styles.technicalDisclosure} ${styles.auditDisclosure}`}
            data-testid="technical-audit"
            ref={technicalAuditRef}
          >
            <summary data-testid="technical-audit-summary">
              Technical audit record
            </summary>
            <p className={styles.inspectorIntro}>
              For technical reviewers: inspect the deterministic runtime state, durable
              evidence, single-use grant, execution receipt, and server-owned timeline.
            </p>

            <div className={styles.technicalStateGrid} aria-label="Raw runtime state">
              <div>
                <span>Runtime status</span>
                <strong>{view.runtimeStatus}</strong>
              </div>
              <div>
                <span>Evidence state</span>
                <strong>{view.evidenceState}</strong>
              </div>
              <div>
                <span>Execution state</span>
                <strong data-testid="technical-execution-state">
                  {view.executionState}
                </strong>
              </div>
              <div>
                <span>Adapter calls</span>
                <strong>{view.robot.dispatchCount}</strong>
              </div>
            </div>

            <div className={styles.actionFlow} id="protected-action-flow">
              <span>1 · Commit evidence</span>
              <span>2 · Create authorization grant</span>
              <span>3 · Consume grant and dispatch endpoint</span>
            </div>

            <div className={styles.technicalControls}>
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
                className={styles.secondaryButton}
                type="button"
                onClick={() => void resetRuntime()}
                disabled={pending}
              >
                Reset demonstration
              </button>
            </div>

            <section
              className={styles.interactionPanel}
              aria-labelledby="interaction-heading"
            >
              <div className={styles.interactionCopy}>
                <span className={styles.eyebrow}>Request intake demonstration</span>
                <h3 id="interaction-heading">Acknowledge a request without approving it</h3>
                <p data-testid="interaction-acknowledgment">
                  {view.interaction.acknowledgment}
                </p>
              </div>
              <div className={styles.interactionActions}>
                <span className={styles.interactionState} data-testid="interaction-state">
                  {view.interaction.state.replaceAll("_", " ")}
                </span>
                <button
                  onClick={() => void beginMission()}
                  disabled={pending}
                  type="button"
                >
                  Start new request
                </button>
                <button
                  onClick={() => void run({ command: "alert-robot" })}
                  disabled={!view.interaction.canAlert || pending}
                  type="button"
                >
                  Notify vehicle
                </button>
                <button
                  onClick={() => void run({ command: "issue-instruction" })}
                  disabled={!view.interaction.canInstruct || pending}
                  type="button"
                >
                  Send delivery request
                </button>
              </div>
            </section>

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
            <div className={styles.auditReturn}>
              <p>Finished reviewing the formal proof?</p>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={returnToDecisionSummary}
              >
                Back to decision summary
              </button>
            </div>
          </details>
        </section>
      </div>
    </main>
  );
}
