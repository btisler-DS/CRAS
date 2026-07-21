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
import type { MarkerKind, MarkerObservation } from "./vision/vision-client.js";
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
  session.resolveObservedConditions(canonicalObservations(), "2026-07-20T22:00:00.000Z");
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

  it("does not allow demo presets or manual toggles to satisfy a physical mission", () => {
    const adapter = new PhysicalSpy();
    const session = new RuntimeSession({
      robotTarget: "physical",
      robotFactory: () => adapter,
      acknowledgments: { acknowledge() {} },
      databasePath: physicalDatabasePath(),
    });
    sessions.push(session);
    session.reset("successful");
    session.alertRobot();
    session.issueInstruction();
    for (const condition of [
      "PATIENT_IDENTITY_VERIFIED",
      "PHYSICIAN_ORDER_ACTIVE",
      "MEDICATION_MATCHED",
      "ADMINISTRATION_WINDOW_VALID",
    ] as const) {
      session.setCondition(condition, true);
    }
    const view = session.commitAndDispatch();
    expect(view.runtimeStatus).toBe("UNAUTHORIZED");
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
    session.resolveObservedConditions(canonicalObservations(), "2026-07-20T22:00:00.000Z");
    session.commitAndDispatch();
    session.dispose();
    sessions.splice(sessions.indexOf(session), 1);

    const reopened = new EvidenceRepository(databasePath);
    expect(reopened.countEvidenceRecords()).toBe(1);
    expect(reopened.countAuthorizationGrants()).toBe(1);
    reopened.close();
  });

  it("commits typed marker provenance before dispatch and rejects mismatches", () => {
    const adapter = new PhysicalSpy();
    const session = new RuntimeSession({
      robotTarget: "physical",
      robotFactory: () => adapter,
      acknowledgments: { acknowledge() {} },
      databasePath: physicalDatabasePath(),
    });
    sessions.push(session);
    session.alertRobot();
    session.issueInstruction();

    const wrong = session.resolveObservedConditions([
      observed(1, "patient", "PAT-1002"),
      observed(2, "bed", "BED-312-A"),
      observed(3, "location", "LOC-ROOM-312"),
      observed(4, "medication", "MED-2002"),
      observed(5, "order", "ORDER-8001"),
    ], "2026-07-20T22:00:00.000Z");
    expect(wrong.runtimeStatus).toBe("UNAUTHORIZED");
    expect(adapter.calls).toBe(0);

    const ready = session.resolveObservedConditions([
      observed(6, "patient", "PAT-1001"),
      observed(7, "bed", "BED-312-A"),
      observed(8, "location", "LOC-ROOM-312"),
      observed(9, "medication", "MED-2001"),
      observed(10, "order", "ORDER-8001"),
    ], "2026-07-20T22:00:00.000Z");
    expect(ready.runtimeStatus).toBe("READY FOR EVIDENCE");
    expect(adapter.calls).toBe(0);

    const executed = session.commitAndDispatch();
    expect(adapter.calls).toBe(1);
    expect(executed.evidenceRecord?.identityReferences).toContain(
      "observation:marker-00000006:PAT-1001",
    );
  });
});

function observed(sequence: number, kind: MarkerKind, markerId: string): MarkerObservation {
  return {
    sequence,
    observation_id: `marker-${String(sequence).padStart(8, "0")}`,
    marker_id: markerId,
    kind,
    payload: `cras:v1:${kind}:${markerId.toLowerCase()}`,
    observed_at: "2026-07-20T22:00:00.000Z",
    frame_sequence: sequence,
    decoder: "opencv-qrcode-detector",
    confidence: null,
    corners: null,
  };
}

function canonicalObservations(): MarkerObservation[] {
  return [
    observed(1, "patient", "PAT-1001"),
    observed(2, "bed", "BED-312-A"),
    observed(3, "location", "LOC-ROOM-312"),
    observed(4, "medication", "MED-2001"),
    observed(5, "order", "ORDER-8001"),
  ];
}

function physicalDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "cras-physical-session-test-"));
  directories.push(directory);
  return join(directory, "evidence.db");
}
