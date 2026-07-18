import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  Dispatcher,
  EvidenceRepository,
  SimulatedRobotAdapter,
  evaluateAuthorization,
  normalizeAction,
  type RepositoryFailureMode,
} from "../src/index.js";

const proposal = {
  actionId: "action-medication-room-312",
  kind: "MEDICATION_DELIVERY",
  instruction: "Deliver medication to Room 312.",
  destination: "Room 312",
  medicationId: "medication-demo-001",
  patientId: "patient-demo-312",
} as const;

const satisfiedFacts = {
  patientIdentityVerified: true,
  physicianOrderActive: true,
  medicationMatched: true,
  administrationWindowValid: true,
} as const;

const demoDirectory = mkdtempSync(join(tmpdir(), "constitutional-runtime-demo-"));
const repositories: EvidenceRepository[] = [];

function repository(
  name: string,
  failureMode: RepositoryFailureMode = "NONE",
): EvidenceRepository {
  let sequence = 0;
  const instance = new EvidenceRepository(join(demoDirectory, `${name}.db`), {
    failureMode,
    now: () => new Date("2026-07-18T12:00:00.000Z"),
    createId: () => `${name}-id-${++sequence}`,
  });
  repositories.push(instance);
  return instance;
}

function printScenario(
  name: string,
  values: Readonly<Record<string, string | number>>,
): void {
  console.log(`\n=== ${name} ===`);
  for (const [label, value] of Object.entries(values)) {
    console.log(`${label}: ${value}`);
  }
}

try {
  const blockedRobot = new SimulatedRobotAdapter();
  const blocked = evaluateAuthorization(
    { ...proposal, patientId: null },
    { ...satisfiedFacts, patientIdentityVerified: false },
  );
  printScenario("BLOCKED", {
    transitions: `RECEIVED -> EVALUATING -> ${blocked.state}`,
    decision: blocked.outcome,
    reason: blocked.blockingReasons.join("; "),
    evidence_record_id: "none",
    grant_id: "none",
    adapter_calls: blockedRobot.snapshot.dispatchCount,
    final_position: blockedRobot.snapshot.position,
  });

  const successRepository = repository("success");
  const successfulDecision = evaluateAuthorization(proposal, satisfiedFacts);
  const authorization = successRepository.authorize({
    proposal,
    decision: successfulDecision,
    correlationId: "demo-success",
    policyVersion: "medication-delivery/v1",
    identityReferences: ["patient:patient-demo-312"],
  });
  if (authorization.state !== "AUTHORIZED") {
    throw new Error(authorization.error);
  }
  const successRobot = new SimulatedRobotAdapter();
  const execution = new Dispatcher(successRepository, successRobot).dispatch(
    authorization.grant,
    normalizeAction(proposal),
  );
  printScenario("AUTHORIZED AND EXECUTED", {
    transitions: `RECEIVED -> EVALUATING -> ${successfulDecision.state} -> COMMITTING_EVIDENCE -> ${authorization.state} -> ${execution.state === "EXECUTED" ? "DISPATCHED -> EXECUTED" : execution.state}`,
    evidence_record_id: authorization.evidenceRecord.evidenceRecordId,
    grant_id: authorization.grant.grantId,
    adapter_calls: successRobot.snapshot.dispatchCount,
    movement_state: successRobot.snapshot.movementState,
    final_position: successRobot.snapshot.position,
  });

  const failureRepository = repository("evidence-failure", "EVIDENCE_WRITE");
  const failureDecision = evaluateAuthorization(proposal, satisfiedFacts);
  const failedAuthorization = failureRepository.authorize({
    proposal,
    decision: failureDecision,
    correlationId: "demo-evidence-failure",
    policyVersion: "medication-delivery/v1",
    identityReferences: ["patient:patient-demo-312"],
  });
  const failureRobot = new SimulatedRobotAdapter();
  printScenario("EVIDENCE STORE FAILURE", {
    transitions: `RECEIVED -> EVALUATING -> ${failureDecision.state} -> COMMITTING_EVIDENCE -> ${failedAuthorization.state}`,
    evidence_record_id: "none (transaction rolled back)",
    grant_id: "none",
    adapter_calls: failureRobot.snapshot.dispatchCount,
    final_position: failureRobot.snapshot.position,
  });
} finally {
  for (const instance of repositories) instance.close();
  rmSync(demoDirectory, { recursive: true, force: true });
}
