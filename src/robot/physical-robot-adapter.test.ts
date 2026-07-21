import { describe, expect, it } from "vitest";

import { PhysicalRobotAdapter, type PhysicalRobotTransport } from "./physical-robot-adapter.js";
import type { NormalizedAction, ValidatedAuthorizationGrant } from "../dispatch/types.js";

const grant = {
  grantId: "grant_1", actionId: "action_1", evidenceRecordId: "evidence_1", actionDigest: "a".repeat(64),
  status: "AUTHORIZED", issuedAt: "2026-07-19T00:00:00.000Z", expiresAt: "2026-07-20T00:00:00.000Z",
  consumedAt: null, revokedAt: null,
} as ValidatedAuthorizationGrant;
const action = {
  actionId: "action_1", kind: "MEDICATION_DELIVERY", instruction: "Deliver medication to Room 312.",
  destination: "Room 312", medicationId: "med_1", patientId: "patient_1",
} as NormalizedAction;

describe("PhysicalRobotAdapter", () => {
  it("is passive until execute and sends only an authenticated bounded envelope", () => {
    const calls: string[] = [];
    const transport: PhysicalRobotTransport = { request(request) { calls.push(request.body); return { status: 200, body: '{"status":"executed","final_position":"home-base","behavior_id":"MEDICATION_DELIVERY_MISSION_V1"}' }; } };
    const adapter = new PhysicalRobotAdapter({ transport, signingKey: new Uint8Array(32).fill(7), now: () => 10, nonce: () => "nonce_1" });
    expect(calls).toEqual([]);
    expect(adapter.execute(grant, action)).toEqual({ finalPosition: "home-base", adapterCallCount: 1 });
    const sent = JSON.parse(calls[0] ?? "{}");
    expect(JSON.parse(sent.payload)).toMatchObject({ grant_id: "grant_1", evidence_record_id: "evidence_1", behavior_id: "MEDICATION_DELIVERY_MISSION_V1", action: { kind: "MEDICATION_DELIVERY", destination: "Room 312" } });
    expect(sent.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[0]).not.toContain("patient_1");
  });

  it("propagates worker rejection without claiming execution", () => {
    const adapter = new PhysicalRobotAdapter({ transport: { request: () => ({ status: 409, body: "{}" }) }, signingKey: new Uint8Array(32).fill(1) });
    expect(() => adapter.execute(grant, action)).toThrow("rejected dispatch");
  });
});
