import "server-only";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluateAuthorization } from "../authorization-kernel.js";
import type {
  AuthorizationDecision,
  ConditionResult,
  ExecutionRecord,
  RequiredConditionId,
} from "../domain.js";
import { Dispatcher } from "../dispatch/dispatcher.js";
import { normalizeAction } from "../dispatch/normalized-action.js";
import type { EvidenceAuthorizationResult } from "../evidence/repository.js";
import { EvidenceRepository } from "../evidence/repository.js";
import { SimulatedRobotAdapter } from "../robot/simulated-robot-adapter.js";
import type {
  DemoPreset,
  RuntimeEvent,
  RuntimeView,
} from "../ui/runtime-view.js";

const INSTRUCTION = "Deliver medication to Room 312.";
const FIXED_NOW = "2026-07-18T12:00:00.000Z";

interface ConditionFacts {
  patientIdentityVerified: boolean;
  physicianOrderActive: boolean;
  medicationMatched: boolean;
  administrationWindowValid: boolean;
}

class RuntimeSession {
  #directory = "";
  #repository: EvidenceRepository | null = null;
  #robot = new SimulatedRobotAdapter();
  #facts: ConditionFacts = {
    patientIdentityVerified: false,
    physicianOrderActive: true,
    medicationMatched: true,
    administrationWindowValid: true,
  };
  #decision!: AuthorizationDecision;
  #authorization: Extract<EvidenceAuthorizationResult, { state: "AUTHORIZED" }> | null = null;
  #executionRecord: ExecutionRecord | null = null;
  #events: RuntimeEvent[] = [];
  #eventSequence = 0;
  #failureInjected = false;
  #evidenceState: RuntimeView["evidenceState"] = "NOT STARTED";
  #executionState: RuntimeView["executionState"] = "STATIONARY";

  constructor() {
    this.reset("blocked");
  }

  reset(preset: DemoPreset = "blocked"): RuntimeView {
    this.#repository?.close();
    if (this.#directory) rmSync(this.#directory, { recursive: true, force: true });

    this.#directory = mkdtempSync(join(tmpdir(), "constitutional-ui-"));
    this.#failureInjected = preset === "evidence-failure";
    let idSequence = 0;
    this.#repository = new EvidenceRepository(
      join(this.#directory, "evidence.db"),
      {
        failureMode: this.#failureInjected ? "EVIDENCE_WRITE" : "NONE",
        now: () => new Date(FIXED_NOW),
        createId: () => `demo-${String(++idSequence).padStart(4, "0")}`,
      },
    );
    this.#robot = new SimulatedRobotAdapter();
    this.#facts =
      preset === "blocked"
        ? {
            patientIdentityVerified: false,
            physicianOrderActive: true,
            medicationMatched: true,
            administrationWindowValid: true,
          }
        : {
            patientIdentityVerified: true,
            physicianOrderActive: true,
            medicationMatched: true,
            administrationWindowValid: true,
          };
    this.#authorization = null;
    this.#executionRecord = null;
    this.#evidenceState = "NOT STARTED";
    this.#executionState = "STATIONARY";
    this.#events = [];
    this.#eventSequence = 0;
    this.#addEvent("RECEIVED", "Instruction received");
    this.#evaluate();
    return this.view();
  }

  setCondition(id: RequiredConditionId, satisfied: boolean): RuntimeView {
    const factByCondition: Record<RequiredConditionId, keyof ConditionFacts> = {
      PATIENT_IDENTITY_VERIFIED: "patientIdentityVerified",
      PHYSICIAN_ORDER_ACTIVE: "physicianOrderActive",
      MEDICATION_MATCHED: "medicationMatched",
      ADMINISTRATION_WINDOW_VALID: "administrationWindowValid",
    };
    this.#facts[factByCondition[id]] = satisfied;
    this.#authorization = null;
    this.#executionRecord = null;
    this.#evidenceState = "NOT STARTED";
    this.#executionState = "STATIONARY";
    this.#evaluate();
    return this.view();
  }

  commitAndDispatch(): RuntimeView {
    if (this.#decision.state !== "READY_FOR_EVIDENCE") {
      this.#addEvent("BLOCKED", "Evidence commit refused while conditions are unresolved");
      return this.view();
    }
    if (this.#authorization || this.#executionRecord) return this.view();

    this.#evidenceState = "WAITING";
    this.#addEvent("COMMITTING_EVIDENCE", "Committing evidence and authorization grant");
    const proposal = this.#proposal();
    const result = this.#requireRepository().authorize({
      proposal,
      decision: this.#decision,
      correlationId: "demo-room-312",
      policyVersion: "medication-delivery/v1",
      identityReferences: ["patient:patient-demo-312"],
    });
    if (result.state === "EVIDENCE_COMMIT_FAILED") {
      this.#evidenceState = "FAILED";
      this.#addEvent("EVIDENCE_COMMIT_FAILED", "Evidence store rejected the transaction");
      return this.view();
    }

    this.#authorization = result;
    this.#evidenceState = "COMMITTED";
    this.#addEvent("AUTHORIZED", "Evidence committed; authorization completed");
    const dispatch = new Dispatcher(
      this.#requireRepository(),
      this.#robot,
    ).dispatch(result.grant, normalizeAction(proposal));
    if (dispatch.outcome === "EXECUTED") {
      this.#executionRecord = dispatch.executionRecord;
      this.#executionState = "EXECUTED";
      this.#addEvent("DISPATCHED", "Validated grant delivered to simulator");
      this.#addEvent("EXECUTED", "Robot arrived at Room 312");
    } else if (dispatch.outcome === "ADAPTER_FAILED") {
      this.#executionRecord = dispatch.executionRecord;
      this.#executionState = "FAILED";
      this.#addEvent("DISPATCHED", "Simulator accepted the dispatch");
      this.#addEvent("ADAPTER_FAILED", dispatch.reason);
    }
    return this.view();
  }

  exportEvidence(): string {
    if (!this.#authorization) throw new Error("No committed evidence to export.");
    return this.#requireRepository().exportEvidenceRecord(
      this.#authorization.evidenceRecord.evidenceRecordId,
    );
  }

  view(): RuntimeView {
    const evidenceRecord = this.#authorization?.evidenceRecord ?? null;
    const persistedGrant = this.#authorization
      ? this.#requireRepository().findAuthorizationGrant(
          this.#authorization.grant.grantId,
        )
      : null;
    const runtimeStatus = this.#runtimeStatus();
    return {
      instruction: INSTRUCTION,
      runtimeStatus,
      authorizationDetail:
        runtimeStatus === "UNAUTHORIZED"
          ? "Authorization denied until every required condition is satisfied."
          : runtimeStatus === "READY FOR EVIDENCE"
            ? "Conditions satisfied. Authorization is still incomplete."
            : runtimeStatus === "EVIDENCE COMMIT FAILED"
              ? "Authorization denied because durable evidence could not be committed."
              : "Authorization completed only after durable evidence committed.",
      evidenceState: this.#evidenceState,
      executionState: this.#executionState,
      conditions: this.#decision.conditionResults.map(toConditionView),
      blockingReasons: this.#decision.blockingReasons,
      evidenceRecord,
      grant: persistedGrant
        ? {
            grantId: persistedGrant.grantId,
            evidenceRecordId: persistedGrant.evidenceRecordId,
            actionDigest: persistedGrant.actionDigest,
            status: persistedGrant.status,
            issuedAt: persistedGrant.issuedAt,
            expiresAt: persistedGrant.expiresAt,
          }
        : null,
      executionRecord: this.#executionRecord,
      robot: this.#robot.snapshot,
      events: this.#events,
      failureInjected: this.#failureInjected,
      canCommit:
        this.#decision.state === "READY_FOR_EVIDENCE" &&
        this.#evidenceState !== "COMMITTED" &&
        this.#evidenceState !== "FAILED",
      canExport: evidenceRecord !== null,
    };
  }

  #evaluate(): void {
    this.#addEvent("EVALUATING", "Checking four required conditions");
    this.#decision = evaluateAuthorization(this.#proposal(), this.#facts);
    this.#addEvent(
      this.#decision.state,
      this.#decision.state === "BLOCKED"
        ? this.#decision.blockingReasons.join(" ")
        : "All conditions satisfied; waiting for evidence commit",
    );
  }

  #proposal() {
    return {
      actionId: "action-medication-room-312",
      kind: "MEDICATION_DELIVERY" as const,
      instruction: INSTRUCTION,
      destination: "Room 312",
      medicationId: "medication-demo-001",
      patientId: this.#facts.patientIdentityVerified
        ? "patient-demo-312"
        : null,
    };
  }

  #runtimeStatus(): RuntimeView["runtimeStatus"] {
    if (this.#evidenceState === "FAILED") return "EVIDENCE COMMIT FAILED";
    if (this.#authorization) return "AUTHORIZED";
    return this.#decision.state === "READY_FOR_EVIDENCE"
      ? "READY FOR EVIDENCE"
      : "UNAUTHORIZED";
  }

  #addEvent(state: string, detail: string): void {
    this.#events.push({
      id: ++this.#eventSequence,
      state,
      detail,
      timestamp: FIXED_NOW,
    });
  }

  #requireRepository(): EvidenceRepository {
    if (!this.#repository) throw new Error("Runtime repository is unavailable.");
    return this.#repository;
  }
}

function toConditionView(result: ConditionResult) {
  return {
    id: result.condition.id,
    label: result.condition.label,
    satisfied: result.satisfied,
    reason: result.reason,
  };
}

const globalRuntime = globalThis as typeof globalThis & {
  constitutionalRuntimeSession?: RuntimeSession;
};

export function getRuntimeSession(): RuntimeSession {
  globalRuntime.constitutionalRuntimeSession ??= new RuntimeSession();
  return globalRuntime.constitutionalRuntimeSession;
}
