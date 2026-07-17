export const AUTHORIZATION_STATES = [
  "RECEIVED",
  "EVALUATING",
  "BLOCKED",
  "READY_FOR_EVIDENCE",
  "COMMITTING_EVIDENCE",
  "AUTHORIZED",
  "DISPATCHED",
  "EXECUTED",
  "EVIDENCE_COMMIT_FAILED",
] as const;

export type AuthorizationState = (typeof AUTHORIZATION_STATES)[number];

export const REQUIRED_CONDITION_IDS = [
  "PATIENT_IDENTITY_VERIFIED",
  "PHYSICIAN_ORDER_ACTIVE",
  "MEDICATION_MATCHED",
  "ADMINISTRATION_WINDOW_VALID",
] as const;

export type RequiredConditionId = (typeof REQUIRED_CONDITION_IDS)[number];

export interface RequiredCondition {
  readonly id: RequiredConditionId;
  readonly label: string;
  readonly blockingReason: string;
}

export interface ConditionResult {
  readonly condition: RequiredCondition;
  readonly satisfied: boolean;
  readonly reason: string;
}

export interface ActionProposal {
  readonly actionId: string;
  readonly kind: "MEDICATION_DELIVERY";
  readonly instruction: string;
  readonly destination: string;
  readonly medicationId: string;
  readonly patientId: string | null;
}

export type AuthorizationOutcome = "UNAUTHORIZED" | "PENDING_EVIDENCE";

export interface AuthorizationDecision {
  readonly actionId: string;
  readonly outcome: AuthorizationOutcome;
  readonly state: "BLOCKED" | "READY_FOR_EVIDENCE";
  readonly conditionResults: readonly ConditionResult[];
  readonly blockingReasons: readonly string[];
}

/**
 * Shape reserved for a later phase. Phase 1 contains no function that creates
 * an AuthorizationGrant because an evidence transaction does not yet exist.
 */
export interface AuthorizationGrant {
  readonly grantId: string;
  readonly actionId: string;
  readonly evidenceRecordId: string;
  readonly actionDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}
