import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EvidenceRepository,
  evaluateAuthorization,
  type EvidenceAuthorizationRequest,
  type RepositoryFailureMode,
} from "../src/index.js";

const openRepositories: EvidenceRepository[] = [];
const temporaryDirectories: string[] = [];

const baseProposal = {
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

afterEach(() => {
  for (const repository of openRepositories.splice(0)) {
    repository.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "constitutional-runtime-"));
  temporaryDirectories.push(directory);
  return join(directory, "evidence.db");
}

function openRepository(
  databasePath = createDatabasePath(),
  failureMode: RepositoryFailureMode = "NONE",
): EvidenceRepository {
  let idSequence = 0;
  const repository = new EvidenceRepository(databasePath, {
    failureMode,
    now: () => new Date("2026-07-18T00:00:00.000Z"),
    createId: () => `deterministic-id-${++idSequence}`,
  });
  openRepositories.push(repository);
  return repository;
}

function createRequest(
  actionId: string = baseProposal.actionId,
): EvidenceAuthorizationRequest {
  const proposal = { ...baseProposal, actionId };
  return {
    proposal,
    decision: evaluateAuthorization(proposal, satisfiedFacts),
    correlationId: `correlation-${actionId}`,
    policyVersion: "medication-delivery/v1",
    identityReferences: ["patient:patient-demo-312"],
  };
}

describe("evidence-before-authorization transaction", () => {
  it("configures WAL, foreign keys, and synchronous FULL", () => {
    const repository = openRepository();

    expect(repository.sqliteConfiguration).toEqual({
      journalMode: "wal",
      foreignKeys: 1,
      synchronous: 2,
    });
  });

  it("persists ordered mission interactions across repository restart", () => {
    const databasePath = createDatabasePath();
    const repository = openRepository(databasePath);
    repository.appendMissionEvent({
      missionId: "mission-312",
      correlationId: "correlation-312",
      actionId: baseProposal.actionId,
      eventType: "ROBOT_ALERTED",
      actor: "OPERATOR",
      detail: "Operator requested robot attention",
    });
    repository.appendMissionEvent({
      missionId: "mission-312",
      correlationId: "correlation-312",
      actionId: baseProposal.actionId,
      eventType: "ATTENTION_ACKNOWLEDGED",
      actor: "ROBOT",
      detail: "Robot acknowledged attention",
    });
    repository.close();
    openRepositories.splice(openRepositories.indexOf(repository), 1);

    const restarted = openRepository(databasePath);
    expect(restarted.listMissionEvents("mission-312")).toMatchObject([
      {
        missionEventId: "mission-312:event:1",
        sequence: 1,
        eventType: "ROBOT_ALERTED",
        actor: "OPERATOR",
      },
      {
        missionEventId: "mission-312:event:2",
        sequence: 2,
        eventType: "ATTENTION_ACKNOWLEDGED",
        actor: "ROBOT",
      },
    ]);
  });

  it("binds authorization mission events to committed evidence and grant rows", () => {
    const repository = openRepository();
    const authorization = repository.authorize(createRequest());
    expect(authorization.state).toBe("AUTHORIZED");
    if (authorization.state !== "AUTHORIZED") {
      throw new Error(authorization.error);
    }

    const event = repository.appendMissionEvent({
      missionId: "mission-312",
      correlationId: "correlation-312",
      actionId: authorization.grant.actionId,
      eventType: "AUTHORIZED",
      actor: "EVIDENCE_STORE",
      detail: "Evidence committed; authorization completed",
      evidenceRecordId: authorization.evidenceRecord.evidenceRecordId,
      grantId: authorization.grant.grantId,
    });

    expect(event).toMatchObject({
      evidenceRecordId: authorization.evidenceRecord.evidenceRecordId,
      grantId: authorization.grant.grantId,
    });
    expect(repository.listMissionEvents("mission-312")).toEqual([event]);
  });

  it("returns AUTHORIZED only with a grant referencing committed evidence", () => {
    const repository = openRepository();
    const result = repository.authorize(createRequest());

    expect(result.state).toBe("AUTHORIZED");
    if (result.state !== "AUTHORIZED") throw new Error(result.error);

    expect(result.grant.evidenceRecordId).toBe(
      result.evidenceRecord.evidenceRecordId,
    );
    expect(
      repository.findEvidenceRecord(result.grant.evidenceRecordId),
    ).toEqual(result.evidenceRecord);
    expect(repository.findAuthorizationGrant(result.grant.grantId)).toEqual(
      result.grant,
    );
  });

  it("binds the grant and evidence row to the same action digest", () => {
    const repository = openRepository();
    const result = repository.authorize(createRequest());

    expect(result.state).toBe("AUTHORIZED");
    if (result.state !== "AUTHORIZED") throw new Error(result.error);
    expect(result.grant.actionDigest).toBe(result.evidenceRecord.actionDigest);
    expect(result.grant.actionId).toBe(result.evidenceRecord.actionId);
  });

  it("rolls back both tables and returns no grant on evidence write failure", () => {
    const repository = openRepository(undefined, "EVIDENCE_WRITE");
    const result = repository.authorize(createRequest());

    expect(result).toMatchObject({
      state: "EVIDENCE_COMMIT_FAILED",
      grant: null,
      error: "Injected repository failure at EVIDENCE_WRITE.",
    });
    expect(repository.countEvidenceRecords()).toBe(0);
    expect(repository.countAuthorizationGrants()).toBe(0);
  });

  it("rolls back the evidence row and returns no grant on grant write failure", () => {
    const repository = openRepository(undefined, "GRANT_WRITE");
    const result = repository.authorize(createRequest());

    expect(result).toMatchObject({
      state: "EVIDENCE_COMMIT_FAILED",
      grant: null,
      error: "Injected repository failure at GRANT_WRITE.",
    });
    expect(repository.countEvidenceRecords()).toBe(0);
    expect(repository.countAuthorizationGrants()).toBe(0);
  });

  it("does not create a dispatch opportunity after rollback", () => {
    const repository = openRepository(undefined, "GRANT_WRITE");
    const result = repository.authorize(createRequest());

    expect(result.state).toBe("EVIDENCE_COMMIT_FAILED");
    expect(result.grant).toBeNull();
    expect(result).not.toHaveProperty("dispatch");
  });

  it("preserves authorized evidence and its grant across restart", () => {
    const databasePath = createDatabasePath();
    const firstRepository = openRepository(databasePath);
    const result = firstRepository.authorize(createRequest());

    expect(result.state).toBe("AUTHORIZED");
    if (result.state !== "AUTHORIZED") throw new Error(result.error);
    firstRepository.close();
    openRepositories.splice(openRepositories.indexOf(firstRepository), 1);

    const restartedRepository = openRepository(databasePath);
    expect(
      restartedRepository.findEvidenceRecord(
        result.evidenceRecord.evidenceRecordId,
      ),
    ).toEqual(result.evidenceRecord);
    expect(
      restartedRepository.findAuthorizationGrant(result.grant.grantId),
    ).toEqual(result.grant);
  });

  it("exports JSON matching the committed evidence record", () => {
    const repository = openRepository();
    const result = repository.authorize(createRequest());

    expect(result.state).toBe("AUTHORIZED");
    if (result.state !== "AUTHORIZED") throw new Error(result.error);
    expect(
      JSON.parse(
        repository.exportEvidenceRecord(result.evidenceRecord.evidenceRecordId),
      ),
    ).toEqual(result.evidenceRecord);
  });

  it("links consecutive evidence records through the previous-record hash", () => {
    const repository = openRepository();
    const first = repository.authorize(createRequest("action-first"));
    const second = repository.authorize(createRequest("action-second"));

    expect(first.state).toBe("AUTHORIZED");
    expect(second.state).toBe("AUTHORIZED");
    if (first.state !== "AUTHORIZED" || second.state !== "AUTHORIZED") {
      throw new Error("Expected both authorizations to commit.");
    }
    expect(first.evidenceRecord.previousRecordHash).toBeNull();
    expect(second.evidenceRecord.previousRecordHash).toBe(
      first.evidenceRecord.currentRecordHash,
    );
    expect(second.evidenceRecord.currentRecordHash).not.toBe(
      first.evidenceRecord.currentRecordHash,
    );
  });

  it("rejects decisions that have not reached READY_FOR_EVIDENCE", () => {
    const repository = openRepository();
    const blockedDecision = evaluateAuthorization(
      { ...baseProposal, patientId: null },
      { ...satisfiedFacts, patientIdentityVerified: false },
    );
    const result = repository.authorize({
      ...createRequest(),
      decision: blockedDecision,
    });

    expect(result.state).toBe("EVIDENCE_COMMIT_FAILED");
    expect(result.grant).toBeNull();
    expect(repository.countEvidenceRecords()).toBe(0);
    expect(repository.countAuthorizationGrants()).toBe(0);
  });
});
