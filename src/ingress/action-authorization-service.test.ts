import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EvidenceRepository } from "../evidence/repository.js";
import { ActionAuthorizationService } from "./action-authorization-service.js";

const directories: string[] = [];
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "cras-intent-auth-"));
  directories.push(directory);
  const repository = new EvidenceRepository(join(directory, "evidence.db"));
  return { repository, service: new ActionAuthorizationService({ repository }) };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const context = {
  actionId: "action_voice_1", medicationId: "medication_demo", patientId: "patient_312",
  patientIdentityVerified: true, physicianOrderActive: true, medicationMatched: true,
  administrationWindowValid: true, correlationId: "voice_utterance_1",
  policyVersion: "medication-delivery/v1", identityReferences: ["patient:patient_312"],
};

describe("ActionAuthorizationService", () => {
  it("keeps a missing patient identity blocked with no evidence or grant", () => {
    const { repository, service } = setup();
    const result = service.authorize(
      { text: "deliver medication to room three twelve", source: "voice" },
      { ...context, patientId: null, patientIdentityVerified: false },
    );
    expect(result).toMatchObject({ state: "BLOCKED", grant: null });
    expect(repository.countEvidenceRecords()).toBe(0);
    expect(repository.countAuthorizationGrants()).toBe(0);
    repository.close();
  });

  it("commits evidence and returns an unconsumed grant for a satisfied action request", () => {
    const { repository, service } = setup();
    const result = service.authorize(
      { text: "Deliver medication to Room 312.", source: "typed" }, context,
    );
    expect(result).toMatchObject({ state: "AUTHORIZED", grant: { status: "AUTHORIZED", consumedAt: null } });
    expect(repository.countEvidenceRecords()).toBe(1);
    expect(repository.countAuthorizationGrants()).toBe(1);
    expect(result.state === "AUTHORIZED" && repository.findEvidenceRecord(result.grant.evidenceRecordId)).toEqual(
      result.state === "AUTHORIZED" ? result.evidenceRecord : null,
    );
    repository.close();
  });

  it("does not admit status, information, cancellation, or conversation routes", () => {
    const { repository, service } = setup();
    for (const text of ["How much battery is left?", "What medication is scheduled?", "Cancel that.", "Hello there"]) {
      expect(service.authorize({ text, source: "voice" }, context)).toMatchObject({ state: "NOT_ACTION", grant: null });
    }
    expect(repository.countAuthorizationGrants()).toBe(0);
    repository.close();
  });

  it("rejects unsupported action wording and forged condition fields in the request", () => {
    const { repository, service } = setup();
    expect(service.authorize({ text: "move forward", source: "voice" }, context)).toMatchObject({
      state: "UNSUPPORTED_ACTION", grant: null,
    });
    expect(() => service.authorize({
      text: "Deliver medication to Room 312", source: "voice", patientIdentityVerified: true,
    }, context)).toThrow();
    expect(repository.countAuthorizationGrants()).toBe(0);
    repository.close();
  });

  it("returns no grant when the evidence transaction fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "cras-intent-auth-fail-"));
    directories.push(directory);
    const repository = new EvidenceRepository(join(directory, "evidence.db"), { failureMode: "EVIDENCE_WRITE" });
    const service = new ActionAuthorizationService({ repository });
    expect(service.authorize({ text: "Deliver medication to Room 312", source: "voice" }, context)).toMatchObject({
      state: "EVIDENCE_COMMIT_FAILED", grant: null,
    });
    expect(repository.countEvidenceRecords()).toBe(0);
    expect(repository.countAuthorizationGrants()).toBe(0);
    repository.close();
  });
});
