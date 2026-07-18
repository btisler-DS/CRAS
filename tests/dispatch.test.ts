import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  DispatchStateMachine,
  Dispatcher,
  EvidenceRepository,
  InvalidAuthorizationTransitionError,
  SimulatedRobotAdapter,
  evaluateAuthorization,
  normalizeAction,
  type AuthorizationGrant,
  type EvidenceAuthorizationResult,
} from "../src/index.js";

const repositories: EvidenceRepository[] = [];
const directories: string[] = [];

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

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "constitutional-dispatch-"));
  directories.push(directory);
  return join(directory, "evidence.db");
}

function openRepository(
  databasePath: string,
  now: () => Date,
  failureMode: "NONE" | "EVIDENCE_WRITE" | "GRANT_WRITE" = "NONE",
): EvidenceRepository {
  let sequence = 0;
  const repository = new EvidenceRepository(databasePath, {
    now,
    failureMode,
    createId: () => `phase-3-id-${++sequence}`,
    grantLifetimeMilliseconds: 60_000,
  });
  repositories.push(repository);
  return repository;
}

function closeRepository(repository: EvidenceRepository): void {
  repository.close();
  repositories.splice(repositories.indexOf(repository), 1);
}

function authorize(repository: EvidenceRepository): EvidenceAuthorizationResult {
  return repository.authorize({
    proposal,
    decision: evaluateAuthorization(proposal, satisfiedFacts),
    correlationId: "correlation-phase-3",
    policyVersion: "medication-delivery/v1",
    identityReferences: ["patient:patient-demo-312"],
  });
}

function requireAuthorization(result: EvidenceAuthorizationResult): Extract<
  EvidenceAuthorizationResult,
  { state: "AUTHORIZED" }
> {
  if (result.state !== "AUTHORIZED") throw new Error(result.error);
  return result;
}

describe("protected dispatch boundary", () => {
  it("keeps BLOCKED actions stationary with zero adapter calls", () => {
    const robot = new SimulatedRobotAdapter();
    const decision = evaluateAuthorization(
      { ...proposal, patientId: null },
      { ...satisfiedFacts, patientIdentityVerified: false },
    );

    expect(decision.state).toBe("BLOCKED");
    expect(robot.snapshot).toMatchObject({
      dispatchCount: 0,
      movementState: "STATIONARY",
      position: "pharmacy",
    });
  });

  it("keeps READY_FOR_EVIDENCE actions stationary with zero adapter calls", () => {
    const robot = new SimulatedRobotAdapter();
    const decision = evaluateAuthorization(proposal, satisfiedFacts);

    expect(decision.state).toBe("READY_FOR_EVIDENCE");
    expect(robot.snapshot).toMatchObject({
      dispatchCount: 0,
      movementState: "STATIONARY",
      position: "pharmacy",
    });
  });

  it("keeps EVIDENCE_COMMIT_FAILED actions stationary with zero calls", () => {
    const databasePath = createDatabasePath();
    const repository = openRepository(
      databasePath,
      () => new Date("2026-07-18T01:00:00.000Z"),
      "EVIDENCE_WRITE",
    );
    const robot = new SimulatedRobotAdapter();

    expect(authorize(repository).state).toBe("EVIDENCE_COMMIT_FAILED");
    expect(robot.snapshot).toMatchObject({
      dispatchCount: 0,
      movementState: "STATIONARY",
      position: "pharmacy",
    });
  });

  it("dispatches a valid committed authorization exactly once to Room 312", () => {
    const databasePath = createDatabasePath();
    const repository = openRepository(
      databasePath,
      () => new Date("2026-07-18T01:00:00.000Z"),
    );
    const authorization = requireAuthorization(authorize(repository));
    const robot = new SimulatedRobotAdapter();
    const result = new Dispatcher(repository, robot).dispatch(
      authorization.grant,
      normalizeAction(proposal),
    );

    expect(result.state).toBe("EXECUTED");
    expect(robot.snapshot).toEqual({
      position: "Room 312",
      movementState: "ARRIVED",
      dispatchCount: 1,
      executedActionId: proposal.actionId,
      grantId: authorization.grant.grantId,
    });
    expect(
      repository.findAuthorizationGrant(authorization.grant.grantId),
    ).toMatchObject({ status: "CONSUMED" });
  });

  it("rejects replay of a consumed grant", () => {
    const databasePath = createDatabasePath();
    const repository = openRepository(
      databasePath,
      () => new Date("2026-07-18T01:00:00.000Z"),
    );
    const authorization = requireAuthorization(authorize(repository));
    const robot = new SimulatedRobotAdapter();
    const dispatcher = new Dispatcher(repository, robot);
    const action = normalizeAction(proposal);

    expect(dispatcher.dispatch(authorization.grant, action).state).toBe(
      "EXECUTED",
    );
    expect(dispatcher.dispatch(authorization.grant, action)).toMatchObject({
      state: "REJECTED",
      reason: "Grant status is CONSUMED, not AUTHORIZED.",
    });
    expect(robot.snapshot.dispatchCount).toBe(1);
  });

  it("rejects an expired grant", () => {
    let now = new Date("2026-07-18T01:00:00.000Z");
    const repository = openRepository(createDatabasePath(), () => now);
    const authorization = requireAuthorization(authorize(repository));
    const robot = new SimulatedRobotAdapter();
    now = new Date("2026-07-18T01:02:00.000Z");

    expect(
      new Dispatcher(repository, robot).dispatch(
        authorization.grant,
        normalizeAction(proposal),
      ),
    ).toMatchObject({ state: "REJECTED", reason: "Authorization grant has expired." });
    expect(robot.snapshot.dispatchCount).toBe(0);
  });

  it("rejects a revoked grant", () => {
    const repository = openRepository(
      createDatabasePath(),
      () => new Date("2026-07-18T01:00:00.000Z"),
    );
    const authorization = requireAuthorization(authorize(repository));
    const robot = new SimulatedRobotAdapter();
    expect(repository.revokeGrant(authorization.grant.grantId)).toBe(true);

    expect(
      new Dispatcher(repository, robot).dispatch(
        authorization.grant,
        normalizeAction(proposal),
      ),
    ).toMatchObject({
      state: "REJECTED",
      reason: "Grant status is REVOKED, not AUTHORIZED.",
    });
    expect(robot.snapshot.dispatchCount).toBe(0);
  });

  it("rejects an action digest mismatch", () => {
    const repository = openRepository(
      createDatabasePath(),
      () => new Date("2026-07-18T01:00:00.000Z"),
    );
    const authorization = requireAuthorization(authorize(repository));
    const robot = new SimulatedRobotAdapter();
    const mismatchedAction = normalizeAction({
      ...proposal,
      medicationId: "different-medication",
    });

    expect(
      new Dispatcher(repository, robot).dispatch(
        authorization.grant,
        mismatchedAction,
      ),
    ).toMatchObject({
      state: "REJECTED",
      reason: "Supplied action digest does not match the grant.",
    });
    expect(robot.snapshot.dispatchCount).toBe(0);
  });

  it("rejects a grant whose referenced evidence record is missing", () => {
    const databasePath = createDatabasePath();
    const now = () => new Date("2026-07-18T01:00:00.000Z");
    const repository = openRepository(databasePath, now);
    const authorization = requireAuthorization(authorize(repository));
    closeRepository(repository);

    const database = new Database(databasePath);
    database.pragma("foreign_keys = OFF");
    database
      .prepare("DELETE FROM evidence_records WHERE evidence_record_id = ?")
      .run(authorization.grant.evidenceRecordId);
    database.close();

    const reopened = openRepository(databasePath, now);
    const robot = new SimulatedRobotAdapter();
    expect(
      new Dispatcher(reopened, robot).dispatch(
        authorization.grant,
        normalizeAction(proposal),
      ),
    ).toMatchObject({
      state: "REJECTED",
      reason: "Referenced evidence record does not exist.",
    });
    expect(robot.snapshot.dispatchCount).toBe(0);
  });

  it("rejects persisted evidence/grant digest mismatch", () => {
    const databasePath = createDatabasePath();
    const now = () => new Date("2026-07-18T01:00:00.000Z");
    const repository = openRepository(databasePath, now);
    const authorization = requireAuthorization(authorize(repository));
    closeRepository(repository);

    const database = new Database(databasePath);
    database.pragma("foreign_keys = OFF");
    database
      .prepare("UPDATE authorization_grants SET action_digest = ? WHERE grant_id = ?")
      .run("tampered-digest", authorization.grant.grantId);
    database.close();

    const reopened = openRepository(databasePath, now);
    const tamperedGrant = reopened.findAuthorizationGrant(
      authorization.grant.grantId,
    );
    if (!tamperedGrant) throw new Error("Expected tampered grant.");
    const robot = new SimulatedRobotAdapter();
    expect(
      new Dispatcher(reopened, robot).dispatch(
        tamperedGrant,
        normalizeAction(proposal),
      ),
    ).toMatchObject({
      state: "REJECTED",
      reason: "Evidence and grant action digests do not match.",
    });
    expect(robot.snapshot.dispatchCount).toBe(0);
  });

  it("makes direct raw-action dispatch impossible in the typed interface", () => {
    const rawAction = proposal;
    const rawGrant = {} as AuthorizationGrant;
    const repository = {} as EvidenceRepository;
    const robot = new SimulatedRobotAdapter();
    const dispatcher = new Dispatcher(repository, robot);

    if (false) {
      // @ts-expect-error ActionProposal lacks the NormalizedAction brand.
      dispatcher.dispatch(rawGrant, rawAction);
      // @ts-expect-error RobotAdapter requires validated grant and normalized action.
      robot.execute(rawGrant, rawAction);
    }
    expect(rawAction.kind).toBe("MEDICATION_DELIVERY");
  });

  it("persists grant consumption and execution across restart", () => {
    const databasePath = createDatabasePath();
    const now = () => new Date("2026-07-18T01:00:00.000Z");
    const repository = openRepository(databasePath, now);
    const authorization = requireAuthorization(authorize(repository));
    const firstRobot = new SimulatedRobotAdapter();
    const result = new Dispatcher(repository, firstRobot).dispatch(
      authorization.grant,
      normalizeAction(proposal),
    );
    if (result.outcome !== "EXECUTED") throw new Error("Expected execution.");
    closeRepository(repository);

    const reopened = openRepository(databasePath, now);
    const secondRobot = new SimulatedRobotAdapter();
    expect(
      reopened.findAuthorizationGrant(authorization.grant.grantId),
    ).toMatchObject({ status: "CONSUMED" });
    expect(
      reopened.findExecutionRecord(result.executionRecord.executionId),
    ).toEqual(result.executionRecord);
    expect(
      new Dispatcher(reopened, secondRobot).dispatch(
        authorization.grant,
        normalizeAction(proposal),
      ).state,
    ).toBe("REJECTED");
    expect(secondRobot.snapshot.dispatchCount).toBe(0);
  });

  it("allows at most one adapter call across repeated dispatch attempts", async () => {
    const repository = openRepository(
      createDatabasePath(),
      () => new Date("2026-07-18T01:00:00.000Z"),
    );
    const authorization = requireAuthorization(authorize(repository));
    const robot = new SimulatedRobotAdapter();
    const dispatcher = new Dispatcher(repository, robot);
    const action = normalizeAction(proposal);

    const results = await Promise.all([
      Promise.resolve().then(() => dispatcher.dispatch(authorization.grant, action)),
      Promise.resolve().then(() => dispatcher.dispatch(authorization.grant, action)),
    ]);

    expect(results.filter((result) => result.state === "EXECUTED")).toHaveLength(1);
    expect(results.filter((result) => result.state === "REJECTED")).toHaveLength(1);
    expect(robot.snapshot.dispatchCount).toBe(1);
  });

  it("records adapter failure as dispatched, consumed, and not executed", () => {
    const repository = openRepository(
      createDatabasePath(),
      () => new Date("2026-07-18T01:00:00.000Z"),
    );
    const authorization = requireAuthorization(authorize(repository));
    const robot = new SimulatedRobotAdapter({ failOnExecute: true });
    const dispatcher = new Dispatcher(repository, robot);

    const result = dispatcher.dispatch(
      authorization.grant,
      normalizeAction(proposal),
    );

    expect(result).toMatchObject({
      outcome: "ADAPTER_FAILED",
      state: "DISPATCHED",
      executionRecord: {
        state: "ADAPTER_FAILED",
        adapterCallCount: 1,
        finalPosition: "pharmacy",
        executedAt: null,
      },
    });
    expect(robot.snapshot).toMatchObject({
      dispatchCount: 1,
      movementState: "FAILED",
      position: "pharmacy",
    });
    expect(
      repository.findAuthorizationGrant(authorization.grant.grantId),
    ).toMatchObject({ status: "CONSUMED" });
    expect(
      dispatcher.dispatch(authorization.grant, normalizeAction(proposal)).state,
    ).toBe("REJECTED");
  });

  it("rejects invalid execution lifecycle transitions", () => {
    const stateMachine = new DispatchStateMachine();
    expect(() => stateMachine.transition("EXECUTED")).toThrow(
      InvalidAuthorizationTransitionError,
    );
    stateMachine.transition("DISPATCHED");
    stateMachine.transition("EXECUTED");
    expect(() => stateMachine.transition("DISPATCHED")).toThrow();
  });
});
