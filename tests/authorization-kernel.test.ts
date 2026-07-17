import { describe, expect, it, vi } from "vitest";

import {
  AUTHORIZATION_STATES,
  AuthorizationStateMachine,
  InvalidAuthorizationTransitionError,
  evaluateAuthorization,
  type AuthorizationGrant,
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

describe("deterministic authorization kernel", () => {
  it("defines every lifecycle state while keeping post-evidence states reserved", () => {
    expect(AUTHORIZATION_STATES).toEqual([
      "RECEIVED",
      "EVALUATING",
      "BLOCKED",
      "READY_FOR_EVIDENCE",
      "COMMITTING_EVIDENCE",
      "AUTHORIZED",
      "DISPATCHED",
      "EXECUTED",
      "EVIDENCE_COMMIT_FAILED",
    ]);
  });

  it("returns BLOCKED / UNAUTHORIZED when patient identity is unresolved", () => {
    const decision = evaluateAuthorization(
      { ...proposal, patientId: null },
      { ...satisfiedFacts, patientIdentityVerified: false },
    );

    expect(decision.state).toBe("BLOCKED");
    expect(decision.outcome).toBe("UNAUTHORIZED");
    expect(decision.blockingReasons).toEqual([
      "Patient identity is unresolved or has not been verified.",
    ]);
  });

  it.each([
    [
      "patientIdentityVerified",
      "PATIENT_IDENTITY_VERIFIED",
      "Patient identity is unresolved or has not been verified.",
    ],
    [
      "physicianOrderActive",
      "PHYSICIAN_ORDER_ACTIVE",
      "The physician order is not active.",
    ],
    [
      "medicationMatched",
      "MEDICATION_MATCHED",
      "The medication does not match the active order.",
    ],
    [
      "administrationWindowValid",
      "ADMINISTRATION_WINDOW_VALID",
      "The medication administration window is not valid.",
    ],
  ] as const)(
    "reports the missing %s condition clearly",
    (factName, conditionId, reason) => {
      const decision = evaluateAuthorization(proposal, {
        ...satisfiedFacts,
        [factName]: false,
      });

      expect(decision.state).toBe("BLOCKED");
      expect(decision.blockingReasons).toContain(reason);
      expect(
        decision.conditionResults.find(
          (result) => result.condition.id === conditionId,
        ),
      ).toMatchObject({ satisfied: false, reason });
    },
  );

  it("reports all missing conditions in one decision", () => {
    const decision = evaluateAuthorization(
      { ...proposal, patientId: null },
      {
        patientIdentityVerified: false,
        physicianOrderActive: false,
        medicationMatched: false,
        administrationWindowValid: false,
      },
    );

    expect(decision.blockingReasons).toHaveLength(4);
    expect(decision.conditionResults.every((result) => !result.satisfied)).toBe(
      true,
    );
  });

  it("stops at READY_FOR_EVIDENCE rather than authorizing", () => {
    const decision = evaluateAuthorization(proposal, satisfiedFacts);

    expect(decision.state).toBe("READY_FOR_EVIDENCE");
    expect(decision.outcome).toBe("PENDING_EVIDENCE");
    expect(decision.blockingReasons).toEqual([]);
    expect(decision).not.toHaveProperty("grant");
  });

  it("makes zero dispatch calls when every condition is satisfied", () => {
    const testDispatchSpy = vi.fn<(grant: AuthorizationGrant) => void>();

    const decision = evaluateAuthorization(proposal, satisfiedFacts);

    expect(decision.state).toBe("READY_FOR_EVIDENCE");
    expect(testDispatchSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid state transitions, including authorization shortcuts", () => {
    const stateMachine = new AuthorizationStateMachine();

    expect(() => stateMachine.transition("AUTHORIZED")).toThrow(
      InvalidAuthorizationTransitionError,
    );
    expect(stateMachine.state).toBe("RECEIVED");

    stateMachine.transition("EVALUATING");
    stateMachine.transition("READY_FOR_EVIDENCE");
    expect(() => stateMachine.transition("AUTHORIZED")).toThrow(
      "Invalid authorization state transition: READY_FOR_EVIDENCE -> AUTHORIZED",
    );
  });

  it("rejects model-generated condition claims embedded in an action", () => {
    const untrustedModelOutput = {
      ...proposal,
      conditions: {
        patientIdentityVerified: true,
        physicianOrderActive: true,
        medicationMatched: true,
        administrationWindowValid: true,
      },
    };

    expect(() =>
      evaluateAuthorization(untrustedModelOutput, satisfiedFacts),
    ).toThrow();
  });

  it("rejects untyped condition values instead of coercing them", () => {
    const untypedFacts = {
      patientIdentityVerified: "true",
      physicianOrderActive: 1,
      medicationMatched: "yes",
      administrationWindowValid: {},
    };

    expect(() => evaluateAuthorization(proposal, untypedFacts)).toThrow();
  });
});
