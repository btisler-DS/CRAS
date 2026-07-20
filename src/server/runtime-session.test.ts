import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  NormalizedAction,
  RobotAdapter,
  ValidatedAuthorizationGrant,
} from "../dispatch/types.js";
import { EvidenceRepository } from "../evidence/repository.js";
import { RuntimeSession } from "./runtime-session.js";
import type { RobotAcknowledgmentType } from "./robot/robot-acknowledgment-client.js";

const sessions: RuntimeSession[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

class PhysicalSpy implements RobotAdapter {
  calls = 0;

  execute(
    _grant: ValidatedAuthorizationGrant,
    _action: NormalizedAction,
  ) {
    this.calls += 1;
    return { finalPosition: "home-base", adapterCallCount: 1 };
  }
}

function readySession(
  adapter: PhysicalSpy,
  acknowledge: (type: RobotAcknowledgmentType) => void,
): RuntimeSession {
  const session = new RuntimeSession({
    robotTarget: "physical",
    robotFactory: () => adapter,
    acknowledgments: {
      acknowledge(request) {
        acknowledge(request.acknowledgment);
      },
    },
    databasePath: physicalDatabasePath(),
  });
  sessions.push(session);
  session.beginMission();
  session.alertRobot();
  session.issueInstruction();
  session.setCondition("PATIENT_IDENTITY_VERIFIED", true);
  return session;
}

describe("RuntimeSession physical mission composition", () => {
  it("fails closed when physical mode lacks the private acknowledgment boundary", () => {
    const adapter = new PhysicalSpy();
    expect(
      () =>
        new RuntimeSession({
          robotTarget: "physical",
          robotFactory: () => adapter,
          acknowledgments: null,
        }),
    ).toThrow(/requires private robot acknowledgments/);
    expect(adapter.calls).toBe(0);
  });

  it("orders four acknowledgments around one protected dispatch", () => {
    const adapter = new PhysicalSpy();
    const acknowledgments: RobotAcknowledgmentType[] = [];
    const session = readySession(adapter, (type) => acknowledgments.push(type));

    const view = session.commitAndDispatch();

    expect(acknowledgments).toEqual([
      "ATTENTION",
      "INSTRUCTION_RECEIVED",
      "AUTHORIZED",
      "MISSION_COMPLETED",
    ]);
    expect(adapter.calls).toBe(1);
    expect(view.executionState).toBe("EXECUTED");
    expect(view.robot).toMatchObject({
      target: "physical",
      position: "home-base",
      movementState: "RETURNED",
      dispatchCount: 1,
    });
    expect(view.events.map((event) => event.state)).toContain(
      "MISSION_COMPLETION_ACKNOWLEDGED",
    );
  });

  it("does not dispatch until the authorization acknowledgment succeeds", () => {
    const adapter = new PhysicalSpy();
    let authorizationAttempts = 0;
    const session = readySession(adapter, (type) => {
      if (type === "AUTHORIZED" && authorizationAttempts++ === 0) {
        throw new Error("tone unavailable");
      }
    });

    const failed = session.commitAndDispatch();
    expect(adapter.calls).toBe(0);
    expect(failed.executionState).toBe("STATIONARY");
    expect(failed.events.at(-1)?.state).toBe("ACKNOWLEDGMENT_FAILED");

    const retried = session.commitAndDispatch();
    expect(adapter.calls).toBe(1);
    expect(retried.executionState).toBe("EXECUTED");
  });

  it("keeps physical mission evidence after the session closes", () => {
    const adapter = new PhysicalSpy();
    const databasePath = physicalDatabasePath();
    const session = new RuntimeSession({
      robotTarget: "physical",
      robotFactory: () => adapter,
      acknowledgments: { acknowledge() {} },
      databasePath,
    });
    sessions.push(session);
    session.alertRobot();
    session.issueInstruction();
    session.setCondition("PATIENT_IDENTITY_VERIFIED", true);
    session.commitAndDispatch();
    session.dispose();
    sessions.splice(sessions.indexOf(session), 1);

    const reopened = new EvidenceRepository(databasePath);
    expect(reopened.countEvidenceRecords()).toBe(1);
    expect(reopened.countAuthorizationGrants()).toBe(1);
    reopened.close();
  });
});

function physicalDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "cras-physical-session-test-"));
  directories.push(directory);
  return join(directory, "evidence.db");
}
