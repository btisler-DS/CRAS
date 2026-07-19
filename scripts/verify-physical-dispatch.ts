import { readFileSync } from "node:fs";

import { evaluateAuthorization } from "../src/authorization-kernel.js";
import { Dispatcher } from "../src/dispatch/dispatcher.js";
import { normalizeAction } from "../src/dispatch/normalized-action.js";
import { EvidenceRepository } from "../src/evidence/repository.js";
import { HttpPhysicalRobotTransport } from "../src/robot/http-physical-robot-transport.js";
import { PhysicalRobotAdapter } from "../src/robot/physical-robot-adapter.js";

const gate = process.env.CRAS_ENABLE_PHYSICAL_DISPATCH_TEST;
if (gate !== "I_CONFIRM_WHEELS_ARE_OFF_GROUND") {
  throw new Error("Physical dispatch blocked: explicitly confirm wheels are off the ground.");
}
const keyPath = process.env.CRAS_ROBOT_SIGNING_KEY_FILE ?? ".runtime/dispatch.key";
const databasePath = process.env.CRAS_PHYSICAL_EVIDENCE_DB ?? ".runtime/physical-evidence.db";
const baseUrl = process.env.CRAS_PHYSICAL_WORKER_BASE_URL ?? "http://127.0.0.1:19300";

const proposal = {
  actionId: `physical-medication-${Date.now()}`,
  kind: "MEDICATION_DELIVERY" as const,
  instruction: "Deliver medication to Room 312.",
  destination: "Room 312",
  medicationId: "medication-demo-001",
  patientId: "patient-demo-312",
};
const decision = evaluateAuthorization(proposal, {
  patientIdentityVerified: true,
  physicianOrderActive: true,
  medicationMatched: true,
  administrationWindowValid: true,
});
const repository = new EvidenceRepository(databasePath);
try {
  const authorization = repository.authorize({
    proposal,
    decision,
    correlationId: `physical-demo-${Date.now()}`,
    policyVersion: "medication-delivery/v1",
    identityReferences: ["patient:patient-demo-312"],
  });
  if (authorization.state !== "AUTHORIZED") throw new Error("Evidence authorization failed.");
  console.log(JSON.stringify({ state: "AUTHORIZED", evidence_record_id: authorization.evidenceRecord.evidenceRecordId, grant_id: authorization.grant.grantId }));
  const adapter = new PhysicalRobotAdapter({
    transport: new HttpPhysicalRobotTransport({ baseUrl }),
    // Provisioned text keys contain a trailing newline; the robot worker strips it.
    signingKey: Buffer.from(readFileSync(keyPath, "utf8").trim(), "utf8"),
  });
  const result = new Dispatcher(repository, adapter).dispatch(authorization.grant, normalizeAction(proposal));
  console.log(JSON.stringify(result));
  if (result.outcome !== "EXECUTED") process.exitCode = 1;
} finally {
  repository.close();
}
