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
import type { RobotAdapter } from "../dispatch/types.js";
import type { EvidenceAuthorizationResult } from "../evidence/repository.js";
import { EvidenceRepository } from "../evidence/repository.js";
import { SimulatedRobotAdapter } from "../robot/simulated-robot-adapter.js";
import type {
  DemoPreset,
  InteractionState,
  RuntimeEvent,
  RuntimeView,
} from "../ui/runtime-view.js";
import { createRobotAdapterFromEnvironment } from "./robot/robot-adapter-config.js";
import { createRobotAcknowledgmentClientFromEnvironment } from "./robot/robot-acknowledgment-config.js";
import type { RobotAcknowledgmentType } from "./robot/robot-acknowledgment-client.js";

const INSTRUCTION = "Deliver medication to Room 312.";
const FIXED_NOW = "2026-07-18T12:00:00.000Z";
const MISSION_ID = "mission-medication-room-312";
const CORRELATION_ID = "demo-room-312";
const ACTION_ID = "action-medication-room-312";

interface ConditionFacts {
  patientIdentityVerified: boolean;
  physicianOrderActive: boolean;
  medicationMatched: boolean;
  administrationWindowValid: boolean;
}

interface RobotAcknowledgmentPort {
  acknowledge(request: {
    missionId: string;
    eventId: string;
    acknowledgment: RobotAcknowledgmentType;
  }): unknown;
}

export interface RuntimeSessionOptions {
  readonly robotFactory?: () => RobotAdapter;
  readonly robotTarget?: "simulator" | "physical";
  readonly acknowledgments?: RobotAcknowledgmentPort | null;
}

export class RuntimeSession {
  #directory = "";
  #repository: EvidenceRepository | null = null;
  #robot: RobotAdapter;
  readonly #robotFactory: () => RobotAdapter;
  readonly #robotTarget: "simulator" | "physical";
  #physicalRobotView: RuntimeView["robot"];
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
  #interactionState: InteractionState = "INSTRUCTION_ACKNOWLEDGED";
  readonly #acknowledgments: RobotAcknowledgmentPort | null;
  #authorizationEventId: string | null = null;
  #authorizationAcknowledged = false;

  constructor(options: RuntimeSessionOptions = {}) {
    const configuredTarget =
      process.env.CRAS_ROBOT_ADAPTER === "physical" ? "physical" : "simulator";
    this.#robotTarget = options.robotTarget ?? configuredTarget;
    this.#robotFactory =
      options.robotFactory ??
      (() =>
        createRobotAdapterFromEnvironment({
          CRAS_ROBOT_ADAPTER: process.env.CRAS_ROBOT_ADAPTER,
          CRAS_PHYSICAL_WORKER_BASE_URL:
            process.env.CRAS_PHYSICAL_WORKER_BASE_URL,
          CRAS_ROBOT_SIGNING_KEY_FILE:
            process.env.CRAS_ROBOT_SIGNING_KEY_FILE,
        }));
    this.#robot = this.#robotFactory();
    this.#physicalRobotView = initialRobotView(this.#robotTarget);
    this.#acknowledgments =
      options.acknowledgments === undefined
        ? this.#robotTarget === "physical"
          ? createRobotAcknowledgmentClientFromEnvironment({
              CRAS_ROBOT_ACKNOWLEDGMENTS:
                process.env.CRAS_ROBOT_ACKNOWLEDGMENTS,
              CRAS_PHYSICAL_WORKER_BASE_URL:
                process.env.CRAS_PHYSICAL_WORKER_BASE_URL,
              CRAS_ROBOT_SIGNING_KEY_FILE:
                process.env.CRAS_ROBOT_SIGNING_KEY_FILE,
            })
          : null
        : options.acknowledgments;
    if (this.#robotTarget === "physical" && !this.#acknowledgments) {
      throw new Error(
        "Physical mission mode requires private robot acknowledgments.",
      );
    }
    this.reset("blocked");
  }

  reset(preset: DemoPreset = "blocked"): RuntimeView {
    this.#initialize(preset);
    if (this.#robotTarget === "physical") {
      this.#interactionState = "IDLE";
      this.#addEvent(
        "MISSION_OPENED",
        "Physical medication-delivery mission opened at home base",
        "CRAS",
      );
      return this.view();
    }
    this.#interactionState = "INSTRUCTION_ACKNOWLEDGED";
    this.#addEvent("ROBOT_ALERTED", "Robot attention requested", "OPERATOR");
    this.#addEvent("ATTENTION_ACKNOWLEDGED", "Robot acknowledged and is listening", "ROBOT");
    this.#addEvent("RECEIVED", "Instruction received", "OPERATOR");
    this.#addEvent("INSTRUCTION_ACKNOWLEDGED", "Robot acknowledged the requested mission; no authority implied", "ROBOT");
    this.#evaluate();
    return this.view();
  }

  beginMission(): RuntimeView {
    this.#initialize("blocked");
    this.#interactionState = "IDLE";
    this.#addEvent("MISSION_OPENED", "Medication-delivery mission opened at home base", "CRAS");
    return this.view();
  }

  #initialize(preset: DemoPreset): void {
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
    this.#robot = this.#robotFactory();
    this.#physicalRobotView = initialRobotView(this.#robotTarget);
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
    this.#interactionState = "IDLE";
    this.#authorizationEventId = null;
    this.#authorizationAcknowledged = false;
    this.#events = [];
    this.#eventSequence = 0;
    this.#decision = evaluateAuthorization(this.#proposal(), this.#facts);
  }

  alertRobot(): RuntimeView {
    if (this.#interactionState !== "IDLE") return this.view();
    const requestEventId = this.#addEvent("ROBOT_ALERTED", "Operator requested robot attention", "OPERATOR");
    if (!this.#tryAcknowledge(requestEventId, "ATTENTION")) return this.view();
    this.#interactionState = "ATTENTION_ACKNOWLEDGED";
    this.#addEvent("ATTENTION_ACKNOWLEDGED", "Robot acknowledged and is listening; no authority implied", "ROBOT");
    return this.view();
  }

  issueInstruction(): RuntimeView {
    if (this.#interactionState !== "ATTENTION_ACKNOWLEDGED") return this.view();
    const requestEventId = this.#addEvent("INSTRUCTION_RECEIVED", INSTRUCTION, "OPERATOR");
    if (!this.#tryAcknowledge(requestEventId, "INSTRUCTION_RECEIVED")) return this.view();
    this.#interactionState = "INSTRUCTION_ACKNOWLEDGED";
    this.#addEvent("INSTRUCTION_ACKNOWLEDGED", "Robot acknowledged receipt; authorization remains unresolved", "ROBOT");
    this.#evaluate();
    return this.view();
  }

  setCondition(id: RequiredConditionId, satisfied: boolean): RuntimeView {
    if (this.#interactionState !== "INSTRUCTION_ACKNOWLEDGED") return this.view();
    if (this.#authorization || this.#executionRecord) return this.view();
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
    this.#authorizationEventId = null;
    this.#authorizationAcknowledged = false;
    this.#evaluate();
    return this.view();
  }

  commitAndDispatch(): RuntimeView {
    if (this.#decision.state !== "READY_FOR_EVIDENCE") {
      this.#addEvent("BLOCKED", "Evidence commit refused while conditions are unresolved");
      return this.view();
    }
    if (this.#executionRecord) return this.view();

    const proposal = this.#proposal();
    if (!this.#authorization) {
      this.#evidenceState = "WAITING";
      this.#addEvent("COMMITTING_EVIDENCE", "Committing evidence and authorization grant");
      const result = this.#requireRepository().authorize({
        proposal,
        decision: this.#decision,
        correlationId: CORRELATION_ID,
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
      this.#authorizationEventId = this.#addEvent("AUTHORIZED", "Evidence committed; authorization completed", "EVIDENCE_STORE", {
        evidenceRecordId: result.evidenceRecord.evidenceRecordId,
        grantId: result.grant.grantId,
      });
    }
    const authorization = this.#authorization;
    if (!this.#authorizationAcknowledged) {
      if (!this.#tryAcknowledge(this.#authorizationEventId!, "AUTHORIZED")) {
        return this.view();
      }
      this.#authorizationAcknowledged = true;
      this.#addEvent(
        "AUTHORIZATION_ACKNOWLEDGED",
        "Robot acknowledged the committed authorization; dispatch has not yet occurred",
        "ROBOT",
      );
    }
    const dispatch = new Dispatcher(
      this.#requireRepository(),
      this.#robot,
    ).dispatch(authorization.grant, normalizeAction(proposal));
    if (dispatch.outcome === "EXECUTED") {
      this.#executionRecord = dispatch.executionRecord;
      this.#executionState = "EXECUTED";
      this.#addEvent(
        "DISPATCHED",
        `Validated grant delivered to ${this.#robotTarget} adapter`,
      );
      if (this.#robotTarget === "physical") {
        this.#physicalRobotView = {
          target: "physical",
          position:
            dispatch.executionRecord.finalPosition === "home-base"
              ? "home-base"
              : "unknown",
          movementState: "RETURNED",
          dispatchCount: dispatch.executionRecord.adapterCallCount,
          executedActionId: dispatch.executionRecord.actionId,
          grantId: dispatch.executionRecord.grantId,
        };
      }
      const executedEventId = this.#addEvent(
        "EXECUTED",
        this.#robotTarget === "physical"
          ? "Robot completed the protected round trip and returned to home base"
          : "Robot arrived at Room 312",
      );
      if (this.#tryAcknowledge(executedEventId, "MISSION_COMPLETED")) {
        this.#addEvent(
          "MISSION_COMPLETION_ACKNOWLEDGED",
          "Robot acknowledged mission completion",
          "ROBOT",
        );
      }
    } else if (dispatch.outcome === "ADAPTER_FAILED") {
      this.#executionRecord = dispatch.executionRecord;
      this.#executionState = "FAILED";
      if (this.#robotTarget === "physical") {
        this.#physicalRobotView = {
          target: "physical",
          position: "unknown",
          movementState: "FAILED",
          dispatchCount: dispatch.executionRecord.adapterCallCount,
          executedActionId: dispatch.executionRecord.actionId,
          grantId: dispatch.executionRecord.grantId,
        };
      }
      this.#addEvent(
        "DISPATCHED",
        `${this.#robotTarget === "physical" ? "Physical" : "Simulator"} adapter accepted the dispatch`,
      );
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

  dispose(): void {
    this.#repository?.close();
    this.#repository = null;
    if (this.#directory) {
      rmSync(this.#directory, { recursive: true, force: true });
      this.#directory = "";
    }
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
      missionId: MISSION_ID,
      instruction:
        this.#interactionState === "INSTRUCTION_ACKNOWLEDGED"
          ? INSTRUCTION
          : "",
      interaction: {
        state: this.#interactionState,
        acknowledgment:
          this.#interactionState === "IDLE"
            ? "Robot is at home base and has not been alerted."
            : this.#interactionState === "ATTENTION_ACKNOWLEDGED"
              ? "Robot acknowledged attention and is listening."
              : "Robot acknowledged the instruction. Authorization is evaluated separately.",
        canAlert: this.#interactionState === "IDLE",
        canInstruct: this.#interactionState === "ATTENTION_ACKNOWLEDGED",
      },
      runtimeStatus,
      authorizationDetail:
        this.#interactionState === "IDLE"
          ? "No request is active. Alerting the robot begins listening but grants no authority."
          : this.#interactionState === "ATTENTION_ACKNOWLEDGED"
            ? "Robot is listening. No instruction has been admitted for authorization."
            : runtimeStatus === "UNAUTHORIZED"
          ? "Authorization denied until every required condition is satisfied."
          : runtimeStatus === "READY FOR EVIDENCE"
            ? "Conditions satisfied. Authorization is still incomplete."
            : runtimeStatus === "EVIDENCE COMMIT FAILED"
              ? "Authorization denied because durable evidence could not be committed."
              : "Authorization completed only after durable evidence committed.",
      evidenceState: this.#evidenceState,
      executionState: this.#executionState,
      conditions: this.#decision.conditionResults.map(toConditionView),
      blockingReasons:
        this.#interactionState === "INSTRUCTION_ACKNOWLEDGED"
          ? this.#decision.blockingReasons
          : [],
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
      robot:
        this.#robot instanceof SimulatedRobotAdapter
          ? { target: "simulator", ...this.#robot.snapshot }
          : this.#physicalRobotView,
      events: this.#events,
      failureInjected: this.#failureInjected,
      canCommit:
        this.#interactionState === "INSTRUCTION_ACKNOWLEDGED" &&
        this.#decision.state === "READY_FOR_EVIDENCE" &&
        this.#evidenceState !== "FAILED" &&
        this.#executionRecord === null &&
        (!this.#authorization || !this.#authorizationAcknowledged),
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
      actionId: ACTION_ID,
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

  #addEvent(
    state: string,
    detail: string,
    actor: import("../evidence/repository.js").MissionEventActor = "CRAS",
    references: { evidenceRecordId?: string; grantId?: string } = {},
  ): string {
    const persisted = this.#requireRepository().appendMissionEvent({
      missionId: MISSION_ID,
      correlationId: CORRELATION_ID,
      actionId: ACTION_ID,
      eventType: state,
      actor,
      detail,
      evidenceRecordId: references.evidenceRecordId ?? null,
      grantId: references.grantId ?? null,
    });
    this.#eventSequence = persisted.sequence;
    this.#events.push({
      id: persisted.sequence,
      state,
      detail,
      timestamp: persisted.occurredAt,
    });
    return persisted.missionEventId;
  }

  #tryAcknowledge(
    requestEventId: string,
    acknowledgment: RobotAcknowledgmentType,
  ): boolean {
    if (!this.#acknowledgments) return true;
    try {
      this.#acknowledgments.acknowledge({
        missionId: MISSION_ID,
        eventId: requestEventId,
        acknowledgment,
      });
      return true;
    } catch (error) {
      this.#addEvent(
        "ACKNOWLEDGMENT_FAILED",
        `Robot acknowledgment failed (${error instanceof Error ? error.name : "unknown error"}); no authority or execution occurred`,
        "CRAS",
      );
      return false;
    }
  }

  #requireRepository(): EvidenceRepository {
    if (!this.#repository) throw new Error("Runtime repository is unavailable.");
    return this.#repository;
  }
}

function initialRobotView(
  target: "simulator" | "physical",
): RuntimeView["robot"] {
  return {
    target,
    position: target === "physical" ? "home-base" : "pharmacy",
    movementState: "STATIONARY",
    dispatchCount: 0,
    executedActionId: null,
    grantId: null,
  };
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
