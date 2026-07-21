import type {
  AuthorizationGrant,
  EvidenceRecord,
  ExecutionRecord,
  RequiredConditionId,
} from "../domain.js";

export type DemoPreset = "blocked" | "successful" | "evidence-failure";

export type InteractionState =
  | "IDLE"
  | "ATTENTION_ACKNOWLEDGED"
  | "INSTRUCTION_ACKNOWLEDGED";

export interface RuntimeEvent {
  readonly id: number;
  readonly state: string;
  readonly detail: string;
  readonly timestamp: string;
}

export interface RuntimeView {
  readonly missionId: string;
  readonly instruction: string;
  readonly interaction: {
    readonly state: InteractionState;
    readonly acknowledgment: string;
    readonly canAlert: boolean;
    readonly canInstruct: boolean;
  };
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
    target: "simulator" | "physical";
    position: "pharmacy" | "Room 312" | "home-base" | "unknown";
    movementState: "STATIONARY" | "MOVING" | "ARRIVED" | "RETURNED" | "FAILED";
    dispatchCount: number;
    executedActionId: string | null;
    grantId: string | null;
  };
  readonly events: readonly RuntimeEvent[];
  readonly failureInjected: boolean;
  readonly canCommit: boolean;
  readonly canLoadHospitalRecord: boolean;
  readonly canExport: boolean;
}
