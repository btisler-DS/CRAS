import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { NormalizedAction, RobotAdapter, ValidatedAuthorizationGrant } from "../dispatch/types.js";
import { EvidenceRepository } from "../evidence/repository.js";
import { ActionAuthorizationService } from "./action-authorization-service.js";
import { AuthorizationDispatchBridge } from "./authorization-dispatch-bridge.js";

class DispatchSpy implements RobotAdapter {
  calls: Array<{ grant: ValidatedAuthorizationGrant; action: NormalizedAction }> = [];
  execute(grant: ValidatedAuthorizationGrant, action: NormalizedAction) {
    this.calls.push({ grant, action });
    return { finalPosition: "Room 312", adapterCallCount: this.calls.length };
  }
}

const directories: string[] = [];
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "cras-intent-dispatch-"));
  directories.push(directory);
  const repository = new EvidenceRepository(join(directory, "evidence.db"));
  const authorization = new ActionAuthorizationService({ repository });
  const adapter = new DispatchSpy();
  const bridge = new AuthorizationDispatchBridge({ repository, adapter });
  return { repository, authorization, adapter, bridge };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const context = {
  actionId: "action_voice_dispatch", medicationId: "medication_demo", patientId: "patient_312",
  patientIdentityVerified: true, physicianOrderActive: true, medicationMatched: true,
  administrationWindowValid: true, correlationId: "voice_dispatch_1",
  policyVersion: "medication-delivery/v1", identityReferences: ["patient:patient_312"],
};

describe("AuthorizationDispatchBridge", () => {
  it("does not invoke the adapter for a blocked authorization result", () => {
    const { repository, authorization, adapter, bridge } = setup();
    const blocked = authorization.authorize(
      { text: "Deliver medication to Room 312", source: "voice" },
      { ...context, patientId: null, patientIdentityVerified: false },
    );
    expect(bridge.dispatch(blocked)).toMatchObject({ outcome: "NOT_AUTHORIZED", state: "REJECTED" });
    expect(adapter.calls).toEqual([]);
    repository.close();
  });

  it("dispatches a committed authorization exactly once through the existing boundary", () => {
    const { repository, authorization, adapter, bridge } = setup();
    const authorized = authorization.authorize(
      { text: "deliver medication to room three twelve", source: "voice" }, context,
    );
    const result = bridge.dispatch(authorized);
    expect(result).toMatchObject({ outcome: "EXECUTED", state: "EXECUTED" });
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.grant).toMatchObject({ status: "AUTHORIZED", consumedAt: null, revokedAt: null });
    expect(adapter.calls[0]?.action).toMatchObject({ kind: "MEDICATION_DELIVERY", destination: "Room 312" });
    expect(adapter.calls[0]).not.toHaveProperty("transcript");
    expect(adapter.calls[0]).not.toHaveProperty("text");
    repository.close();
  });

  it("rejects replay and makes at most one adapter call", () => {
    const { repository, authorization, adapter, bridge } = setup();
    const authorized = authorization.authorize(
      { text: "Deliver medication to Room 312", source: "typed" }, context,
    );
    expect(bridge.dispatch(authorized).outcome).toBe("EXECUTED");
    expect(bridge.dispatch(authorized).outcome).toBe("REJECTED");
    expect(adapter.calls).toHaveLength(1);
    repository.close();
  });

  it("has no typed raw-text dispatch surface", () => {
    const { repository, bridge } = setup();
    if (false) {
      // @ts-expect-error raw text cannot enter the authorization-to-dispatch bridge
      bridge.dispatch("Deliver medication to Room 312");
      // @ts-expect-error transcripts cannot enter the authorization-to-dispatch bridge
      bridge.dispatch({ text: "Deliver medication", confidence: 1 });
    }
    expect(typeof bridge.dispatch).toBe("function");
    repository.close();
  });
});
