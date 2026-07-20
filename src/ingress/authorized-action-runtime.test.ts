import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EvidenceRepository } from "../evidence/repository.js";
import { PhysicalRobotAdapter, type PhysicalRobotTransport } from "../robot/physical-robot-adapter.js";
import { SimulatedRobotAdapter } from "../robot/simulated-robot-adapter.js";
import { AuthorizedActionRuntime } from "./authorized-action-runtime.js";

const directories: string[] = [];
function repository(name: string) {
  const directory = mkdtempSync(join(tmpdir(), `cras-alignment-${name}-`));
  directories.push(directory);
  return new EvidenceRepository(join(directory, "evidence.db"), {
    now: () => new Date("2026-07-19T20:00:00.000Z"),
    createId: (() => { let id = 0; return () => `${name}-${++id}`; })(),
  });
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const request = { text: "Deliver medication to Room 312.", source: "voice" } as const;
const context = {
  actionId: "aligned_action", medicationId: "medication_demo", patientId: "patient_312",
  patientIdentityVerified: true, physicianOrderActive: true, medicationMatched: true,
  administrationWindowValid: true, correlationId: "aligned_voice_1",
  policyVersion: "medication-delivery/v1", identityReferences: ["patient:patient_312"],
};

describe("simulator and physical execution-path alignment", () => {
  it("uses the same authorization, evidence, and Dispatcher composition for both targets", () => {
    const simulatorRepository = repository("sim");
    const physicalRepository = repository("physical");
    const simulator = new SimulatedRobotAdapter();
    const physicalCalls: string[] = [];
    const transport: PhysicalRobotTransport = {
      request(value) {
        physicalCalls.push(value.body);
        return {
          status: 200,
          body: JSON.stringify({
            status: "executed",
            final_position: "home-base",
            behavior_id: "MEDICATION_DELIVERY_ROUND_TRIP_V1",
          }),
        };
      },
    };
    const physical = new PhysicalRobotAdapter({
      transport,
      signingKey: new Uint8Array(32).fill(9),
      now: () => Date.parse("2026-07-19T20:00:00.000Z"),
      nonce: () => "alignment_nonce",
    });

    const simulatorResult = new AuthorizedActionRuntime({
      repository: simulatorRepository,
      adapter: simulator,
    }).handle(request, context);
    const physicalResult = new AuthorizedActionRuntime({
      repository: physicalRepository,
      adapter: physical,
    }).handle(request, context);

    expect(simulatorResult.authorization.state).toBe("AUTHORIZED");
    expect(physicalResult.authorization.state).toBe("AUTHORIZED");
    expect(simulatorResult.dispatch).toMatchObject({ outcome: "EXECUTED", state: "EXECUTED" });
    expect(physicalResult.dispatch).toMatchObject({ outcome: "EXECUTED", state: "EXECUTED" });
    expect(simulatorRepository.countEvidenceRecords()).toBe(1);
    expect(physicalRepository.countEvidenceRecords()).toBe(1);
    expect(simulator.snapshot.dispatchCount).toBe(1);
    expect(physicalCalls).toHaveLength(1);

    const payload = JSON.parse(JSON.parse(physicalCalls[0] ?? "{}").payload);
    expect(payload).toMatchObject({
      action_id: "aligned_action",
      behavior_id: "MEDICATION_DELIVERY_ROUND_TRIP_V1",
      action: { kind: "MEDICATION_DELIVERY", destination: "Room 312" },
    });
    simulatorRepository.close();
    physicalRepository.close();
  });

  it("keeps both targets untouched when the shared authorization is blocked", () => {
    const simulatorRepository = repository("blocked-sim");
    const physicalRepository = repository("blocked-physical");
    const simulator = new SimulatedRobotAdapter();
    let physicalCalls = 0;
    const physical = new PhysicalRobotAdapter({
      transport: { request() { physicalCalls += 1; return { status: 500, body: "{}" }; } },
      signingKey: new Uint8Array(32).fill(4),
    });
    const blockedContext = { ...context, patientId: null, patientIdentityVerified: false };

    const simResult = new AuthorizedActionRuntime({ repository: simulatorRepository, adapter: simulator })
      .handle(request, blockedContext);
    const physicalResult = new AuthorizedActionRuntime({ repository: physicalRepository, adapter: physical })
      .handle(request, blockedContext);

    expect(simResult.dispatch.outcome).toBe("NOT_AUTHORIZED");
    expect(physicalResult.dispatch.outcome).toBe("NOT_AUTHORIZED");
    expect(simulator.snapshot.dispatchCount).toBe(0);
    expect(physicalCalls).toBe(0);
    expect(simulatorRepository.countAuthorizationGrants()).toBe(0);
    expect(physicalRepository.countAuthorizationGrants()).toBe(0);
    simulatorRepository.close();
    physicalRepository.close();
  });
});
