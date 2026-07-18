import type {
  AuthorizationGrant,
  EvidenceRecord,
  ExecutionRecord,
  RequiredConditionId,
} from "../domain.js";

export type DemoPreset = "blocked" | "successful" | "evidence-failure";

export interface RuntimeEvent {
  readonly id: number;
  readonly state: string;
  readonly detail: string;
  readonly timestamp: string;
}

export interface RuntimeView {
  readonly instruction: string;
  readonly runtimeStatus:
    | "UNAUTHORIZED"
    | "READY FOR EVIDENCE"
    | "AUTHORIZED"
    | "EVIDENCE COMMIT FAILED";
  readonly authorizationDetail: string;
  readonly evidenceState: "NOT STARTED" | "WAITING" | "COMMITTED" | "FAILED";
  readonly executionState: "STATIONARY" | "EXECUTED" | "FAILED";
  readonly conditions: readonly {
    id: RequiredConditionId;
    label: string;
    satisfied: boolean;
    reason: string;
  }[];
  readonly blockingReasons: readonly string[];
  readonly evidenceRecord: EvidenceRecord | null;
  readonly grant: Pick<
    AuthorizationGrant,
    | "grantId"
    | "evidenceRecordId"
    | "actionDigest"
    | "status"
    | "issuedAt"
    | "expiresAt"
  > | null;
  readonly executionRecord: ExecutionRecord | null;
  readonly robot: {
    position: "pharmacy" | "Room 312";
    movementState: "STATIONARY" | "MOVING" | "ARRIVED" | "FAILED";
    dispatchCount: number;
    executedActionId: string | null;
    grantId: string | null;
  };
  readonly events: readonly RuntimeEvent[];
  readonly failureInjected: boolean;
  readonly canCommit: boolean;
  readonly canExport: boolean;
}
