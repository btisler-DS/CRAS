import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";

import { canonicalJson, sha256 } from "../canonical-json.js";
import type {
  ActionProposal,
  AuthorizationDecision,
  AuthorizationGrant,
  ConditionResult,
  EvidenceRecord,
  ExecutionRecord,
} from "../domain.js";
import { digestNormalizedAction } from "../dispatch/normalized-action.js";
import type {
  NormalizedAction,
  RobotExecutionReceipt,
  ValidatedAuthorizationGrant,
} from "../dispatch/types.js";
import { parseActionProposal } from "../medication-delivery.js";
import { migrate } from "./migrations.js";
import { EvidenceAuthorizationStateMachine } from "./state-machine.js";

export type RepositoryFailureMode =
  | "NONE"
  | "EVIDENCE_WRITE"
  | "GRANT_WRITE";

export interface EvidenceRepositoryOptions {
  readonly failureMode?: RepositoryFailureMode;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly grantLifetimeMilliseconds?: number;
}

export interface EvidenceAuthorizationRequest {
  readonly proposal: unknown;
  readonly decision: AuthorizationDecision;
  readonly correlationId: string;
  readonly policyVersion: string;
  readonly identityReferences: readonly string[];
}

export type EvidenceAuthorizationResult =
  | {
      readonly state: "AUTHORIZED";
      readonly grant: AuthorizationGrant;
      readonly evidenceRecord: EvidenceRecord;
    }
  | {
      readonly state: "EVIDENCE_COMMIT_FAILED";
      readonly grant: null;
      readonly error: string;
    };

interface EvidenceRow {
  evidence_record_id: string;
  action_id: string;
  correlation_id: string;
  normalized_action: string;
  action_digest: string;
  policy_version: string;
  condition_results: string;
  identity_references: string;
  decision_timestamp: string;
  previous_record_hash: string | null;
  current_record_hash: string;
}

interface GrantRow {
  grant_id: string;
  action_id: string;
  evidence_record_id: string;
  action_digest: string;
  status: AuthorizationGrant["status"];
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
}

interface ExecutionRow {
  execution_id: string;
  grant_id: string;
  action_id: string;
  state: ExecutionRecord["state"];
  consumed_at: string;
  dispatched_at: string | null;
  executed_at: string | null;
  adapter_error: string | null;
  adapter_call_count: number;
  final_position: string | null;
}

export type MissionEventActor =
  | "OPERATOR"
  | "ROBOT"
  | "CRAS"
  | "EVIDENCE_STORE"
  | "DISPATCHER"
  | "ADAPTER";

export interface MissionEventRecord {
  readonly missionEventId: string;
  readonly missionId: string;
  readonly sequence: number;
  readonly correlationId: string;
  readonly actionId: string | null;
  readonly eventType: string;
  readonly actor: MissionEventActor;
  readonly detail: string;
  readonly occurredAt: string;
  readonly evidenceRecordId: string | null;
  readonly grantId: string | null;
}

export interface AppendMissionEventInput {
  readonly missionId: string;
  readonly correlationId: string;
  readonly actionId?: string | null;
  readonly eventType: string;
  readonly actor: MissionEventActor;
  readonly detail: string;
  readonly evidenceRecordId?: string | null;
  readonly grantId?: string | null;
}

interface MissionEventRow {
  mission_event_id: string;
  mission_id: string;
  sequence: number;
  correlation_id: string;
  action_id: string | null;
  event_type: string;
  actor: MissionEventActor;
  detail: string;
  occurred_at: string;
  evidence_record_id: string | null;
  grant_id: string | null;
}

export type GrantConsumptionResult =
  | {
      readonly accepted: true;
      readonly grant: ValidatedAuthorizationGrant;
      readonly action: NormalizedAction;
      readonly executionRecord: ExecutionRecord;
    }
  | {
      readonly accepted: false;
      readonly reason: string;
    };

export class EvidenceRepository {
  readonly #database: Database.Database;
  readonly #failureMode: RepositoryFailureMode;
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #grantLifetimeMilliseconds: number;

  constructor(databasePath: string, options: EvidenceRepositoryOptions = {}) {
    this.#database = new Database(databasePath);
    this.#failureMode = options.failureMode ?? "NONE";
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
    this.#grantLifetimeMilliseconds =
      options.grantLifetimeMilliseconds ?? 5 * 60 * 1000;

    this.#database.pragma("journal_mode = WAL");
    this.#database.pragma("foreign_keys = ON");
    this.#database.pragma("synchronous = FULL");
    migrate(this.#database);
  }

  get sqliteConfiguration(): Readonly<{
    journalMode: string;
    foreignKeys: number;
    synchronous: number;
  }> {
    return {
      journalMode: this.#database.pragma("journal_mode", {
        simple: true,
      }) as string,
      foreignKeys: this.#database.pragma("foreign_keys", {
        simple: true,
      }) as number,
      synchronous: this.#database.pragma("synchronous", {
        simple: true,
      }) as number,
    };
  }

  authorize(request: EvidenceAuthorizationRequest): EvidenceAuthorizationResult {
    const stateMachine = new EvidenceAuthorizationStateMachine();

    try {
      const committed = this.#database.transaction(() => {
        if (
          stateMachine.state !== "READY_FOR_EVIDENCE" ||
          request.decision.state !== "READY_FOR_EVIDENCE" ||
          request.decision.outcome !== "PENDING_EVIDENCE"
        ) {
          throw new Error("Authorization decision is not READY_FOR_EVIDENCE.");
        }

        stateMachine.transition("COMMITTING_EVIDENCE");
        const proposal = parseActionProposal(request.proposal);
        if (proposal.actionId !== request.decision.actionId) {
          throw new Error("Action proposal does not match the authorization decision.");
        }

        const now = this.#now();
        const issuedAt = now.toISOString();
        const expiresAt = new Date(
          now.getTime() + this.#grantLifetimeMilliseconds,
        ).toISOString();
        const normalizedAction = canonicalJson(proposal);
        const actionDigest = sha256(normalizedAction);
        const previousRecordHash = this.#latestRecordHash();
        const evidenceRecordId = this.#createId();
        const grantId = this.#createId();

        const evidenceWithoutHash = {
          evidenceRecordId,
          actionId: proposal.actionId,
          correlationId: request.correlationId,
          normalizedAction: proposal,
          actionDigest,
          policyVersion: request.policyVersion,
          conditionResults: request.decision.conditionResults,
          identityReferences: [...request.identityReferences],
          decisionTimestamp: issuedAt,
          previousRecordHash,
        };
        const currentRecordHash = sha256(canonicalJson(evidenceWithoutHash));
        const evidenceRecord: EvidenceRecord = {
          ...evidenceWithoutHash,
          currentRecordHash,
        };

        this.#injectFailure("EVIDENCE_WRITE");
        this.#insertEvidence(evidenceRecord);

        const grant: AuthorizationGrant = {
          grantId,
          actionId: proposal.actionId,
          evidenceRecordId,
          actionDigest,
          status: "AUTHORIZED",
          issuedAt,
          expiresAt,
          consumedAt: null,
          revokedAt: null,
        };

        this.#injectFailure("GRANT_WRITE");
        this.#insertGrant(grant);

        return { evidenceRecord, grant };
      })();

      // better-sqlite3 returns from transaction() only after COMMIT succeeds.
      stateMachine.transition("AUTHORIZED");
      return { state: "AUTHORIZED", ...committed };
    } catch (error) {
      if (stateMachine.state === "COMMITTING_EVIDENCE") {
        stateMachine.transition("EVIDENCE_COMMIT_FAILED");
      }
      return {
        state: "EVIDENCE_COMMIT_FAILED",
        grant: null,
        error: error instanceof Error ? error.message : "Unknown evidence failure.",
      };
    }
  }

  findEvidenceRecord(evidenceRecordId: string): EvidenceRecord | null {
    const row = this.#database
      .prepare(
        `SELECT evidence_record_id, action_id, correlation_id,
                normalized_action, action_digest, policy_version,
                condition_results, identity_references, decision_timestamp,
                previous_record_hash, current_record_hash
           FROM evidence_records
          WHERE evidence_record_id = ?`,
      )
      .get(evidenceRecordId) as EvidenceRow | undefined;
    return row ? mapEvidenceRow(row) : null;
  }

  findAuthorizationGrant(grantId: string): AuthorizationGrant | null {
    const row = this.#database
      .prepare(
        `SELECT grant_id, action_id, evidence_record_id, action_digest,
                status, issued_at, expires_at, consumed_at, revoked_at
           FROM authorization_grants
          WHERE grant_id = ?`,
      )
      .get(grantId) as GrantRow | undefined;
    return row ? mapGrantRow(row) : null;
  }

  /**
   * Atomically revalidates and consumes a grant. Returning accepted=true means
   * the COMMIT has completed; callers may invoke an adapter only after this.
   */
  consumeGrant(
    suppliedGrant: AuthorizationGrant,
    suppliedAction: NormalizedAction,
  ): GrantConsumptionResult {
    try {
      return this.#database.transaction(() => {
        if (
          suppliedGrant.status !== "AUTHORIZED" ||
          suppliedGrant.consumedAt !== null ||
          suppliedGrant.revokedAt !== null
        ) {
          throw new Error("Supplied grant is not an unconsumed authorization.");
        }

        const storedGrant = this.findAuthorizationGrant(suppliedGrant.grantId);
        if (!storedGrant) {
          throw new Error("Authorization grant does not exist.");
        }
        if (
          storedGrant.evidenceRecordId !== suppliedGrant.evidenceRecordId ||
          storedGrant.actionId !== suppliedGrant.actionId ||
          storedGrant.actionDigest !== suppliedGrant.actionDigest ||
          storedGrant.issuedAt !== suppliedGrant.issuedAt ||
          storedGrant.expiresAt !== suppliedGrant.expiresAt
        ) {
          throw new Error("Supplied grant does not match the persisted grant.");
        }
        if (storedGrant.status !== "AUTHORIZED") {
          throw new Error(`Grant status is ${storedGrant.status}, not AUTHORIZED.`);
        }
        if (storedGrant.revokedAt !== null) {
          throw new Error("Authorization grant has been revoked.");
        }
        if (storedGrant.consumedAt !== null) {
          throw new Error("Authorization grant has already been consumed.");
        }

        const consumedAt = this.#now().toISOString();
        if (Date.parse(storedGrant.expiresAt) <= Date.parse(consumedAt)) {
          throw new Error("Authorization grant has expired.");
        }

        const evidence = this.findEvidenceRecord(storedGrant.evidenceRecordId);
        if (!evidence) {
          throw new Error("Referenced evidence record does not exist.");
        }
        if (evidence.actionId !== storedGrant.actionId) {
          throw new Error("Evidence and grant action IDs do not match.");
        }
        if (evidence.actionDigest !== storedGrant.actionDigest) {
          throw new Error("Evidence and grant action digests do not match.");
        }

        const suppliedDigest = digestNormalizedAction(suppliedAction);
        if (suppliedDigest !== storedGrant.actionDigest) {
          throw new Error("Supplied action digest does not match the grant.");
        }
        if (
          canonicalJson(suppliedAction) !== canonicalJson(evidence.normalizedAction)
        ) {
          throw new Error("Supplied action is not the committed normalized action.");
        }

        const update = this.#database
          .prepare(
            `UPDATE authorization_grants
                SET status = 'CONSUMED', consumed_at = ?
              WHERE grant_id = ?
                AND status = 'AUTHORIZED'
                AND consumed_at IS NULL
                AND revoked_at IS NULL`,
          )
          .run(consumedAt, storedGrant.grantId);
        if (update.changes !== 1) {
          throw new Error("Authorization grant could not be consumed atomically.");
        }

        const executionRecord: ExecutionRecord = {
          executionId: this.#createId(),
          grantId: storedGrant.grantId,
          actionId: storedGrant.actionId,
          state: "AUTHORIZED",
          consumedAt,
          dispatchedAt: null,
          executedAt: null,
          adapterError: null,
          adapterCallCount: 0,
          finalPosition: null,
        };
        this.#insertExecutionRecord(executionRecord);

        return {
          accepted: true as const,
          grant: storedGrant as ValidatedAuthorizationGrant,
          action: suppliedAction,
          executionRecord,
        };
      })();
    } catch (error) {
      return {
        accepted: false,
        reason: error instanceof Error ? error.message : "Grant consumption failed.",
      };
    }
  }

  markDispatched(executionId: string): ExecutionRecord {
    const dispatchedAt = this.#now().toISOString();
    const update = this.#database
      .prepare(
        `UPDATE execution_records
            SET state = 'DISPATCHED', dispatched_at = ?
          WHERE execution_id = ? AND state = 'AUTHORIZED'`,
      )
      .run(dispatchedAt, executionId);
    if (update.changes !== 1) {
      throw new Error("Execution could not transition to DISPATCHED.");
    }
    return this.#requireExecutionRecord(executionId);
  }

  markExecuted(
    executionId: string,
    receipt: RobotExecutionReceipt,
  ): ExecutionRecord {
    const executedAt = this.#now().toISOString();
    const update = this.#database
      .prepare(
        `UPDATE execution_records
            SET state = 'EXECUTED', executed_at = ?,
                adapter_call_count = ?, final_position = ?
          WHERE execution_id = ? AND state = 'DISPATCHED'`,
      )
      .run(
        executedAt,
        receipt.adapterCallCount,
        receipt.finalPosition,
        executionId,
      );
    if (update.changes !== 1) {
      throw new Error("Execution could not transition to EXECUTED.");
    }
    return this.#requireExecutionRecord(executionId);
  }

  markAdapterFailed(
    executionId: string,
    error: string,
    adapterCallCount: number,
    finalPosition: string,
  ): ExecutionRecord {
    const update = this.#database
      .prepare(
        `UPDATE execution_records
            SET state = 'ADAPTER_FAILED', adapter_error = ?,
                adapter_call_count = ?, final_position = ?
          WHERE execution_id = ? AND state = 'DISPATCHED'`,
      )
      .run(error, adapterCallCount, finalPosition, executionId);
    if (update.changes !== 1) {
      throw new Error("Adapter failure could not be recorded.");
    }
    return this.#requireExecutionRecord(executionId);
  }

  findExecutionRecord(executionId: string): ExecutionRecord | null {
    const row = this.#database
      .prepare(
        `SELECT execution_id, grant_id, action_id, state, consumed_at,
                dispatched_at, executed_at, adapter_error,
                adapter_call_count, final_position
           FROM execution_records
          WHERE execution_id = ?`,
      )
      .get(executionId) as ExecutionRow | undefined;
    return row ? mapExecutionRow(row) : null;
  }

  revokeGrant(grantId: string, revokedAt = this.#now().toISOString()): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE authorization_grants
              SET status = 'REVOKED', revoked_at = ?
            WHERE grant_id = ? AND status = 'AUTHORIZED'
              AND consumed_at IS NULL AND revoked_at IS NULL`,
        )
        .run(revokedAt, grantId).changes === 1
    );
  }

  countEvidenceRecords(): number {
    return (
      this.#database
        .prepare("SELECT COUNT(*) AS count FROM evidence_records")
        .get() as { count: number }
    ).count;
  }

  countAuthorizationGrants(): number {
    return (
      this.#database
        .prepare("SELECT COUNT(*) AS count FROM authorization_grants")
        .get() as { count: number }
    ).count;
  }

  appendMissionEvent(input: AppendMissionEventInput): MissionEventRecord {
    return this.#database.transaction(() => {
      const row = this.#database
        .prepare(
          `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
             FROM mission_events
            WHERE mission_id = ?`,
        )
        .get(input.missionId) as { sequence: number };
      const sequence = row.sequence;
      const event: MissionEventRecord = {
        missionEventId: `${input.missionId}:event:${sequence}`,
        missionId: input.missionId,
        sequence,
        correlationId: input.correlationId,
        actionId: input.actionId ?? null,
        eventType: input.eventType,
        actor: input.actor,
        detail: input.detail,
        occurredAt: this.#now().toISOString(),
        evidenceRecordId: input.evidenceRecordId ?? null,
        grantId: input.grantId ?? null,
      };
      this.#database
        .prepare(
          `INSERT INTO mission_events (
             mission_event_id, mission_id, sequence, correlation_id,
             action_id, event_type, actor, detail, occurred_at,
             evidence_record_id, grant_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.missionEventId,
          event.missionId,
          event.sequence,
          event.correlationId,
          event.actionId,
          event.eventType,
          event.actor,
          event.detail,
          event.occurredAt,
          event.evidenceRecordId,
          event.grantId,
        );
      return event;
    })();
  }

  listMissionEvents(missionId: string): readonly MissionEventRecord[] {
    const rows = this.#database
      .prepare(
        `SELECT mission_event_id, mission_id, sequence, correlation_id,
                action_id, event_type, actor, detail, occurred_at,
                evidence_record_id, grant_id
           FROM mission_events
          WHERE mission_id = ?
          ORDER BY sequence ASC`,
      )
      .all(missionId) as MissionEventRow[];
    return rows.map(mapMissionEventRow);
  }

  exportEvidenceRecord(evidenceRecordId: string): string {
    const record = this.findEvidenceRecord(evidenceRecordId);
    if (!record) {
      throw new Error(`Evidence record not found: ${evidenceRecordId}`);
    }
    return `${JSON.stringify(record, null, 2)}\n`;
  }

  close(): void {
    this.#database.close();
  }

  #latestRecordHash(): string | null {
    const row = this.#database
      .prepare(
        `SELECT current_record_hash
           FROM evidence_records
          ORDER BY sequence DESC
          LIMIT 1`,
      )
      .get() as { current_record_hash: string } | undefined;
    return row?.current_record_hash ?? null;
  }

  #insertEvidence(record: EvidenceRecord): void {
    this.#database
      .prepare(
        `INSERT INTO evidence_records (
           evidence_record_id, action_id, correlation_id, normalized_action,
           action_digest, policy_version, condition_results,
           identity_references, decision_timestamp, previous_record_hash,
           current_record_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.evidenceRecordId,
        record.actionId,
        record.correlationId,
        canonicalJson(record.normalizedAction),
        record.actionDigest,
        record.policyVersion,
        canonicalJson(record.conditionResults),
        canonicalJson(record.identityReferences),
        record.decisionTimestamp,
        record.previousRecordHash,
        record.currentRecordHash,
      );
  }

  #insertGrant(grant: AuthorizationGrant): void {
    this.#database
      .prepare(
        `INSERT INTO authorization_grants (
           grant_id, action_id, evidence_record_id, action_digest, status,
           issued_at, expires_at, consumed_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        grant.grantId,
        grant.actionId,
        grant.evidenceRecordId,
        grant.actionDigest,
        grant.status,
        grant.issuedAt,
        grant.expiresAt,
        grant.consumedAt,
        grant.revokedAt,
      );
  }

  #insertExecutionRecord(record: ExecutionRecord): void {
    this.#database
      .prepare(
        `INSERT INTO execution_records (
           execution_id, grant_id, action_id, state, consumed_at,
           dispatched_at, executed_at, adapter_error,
           adapter_call_count, final_position
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.executionId,
        record.grantId,
        record.actionId,
        record.state,
        record.consumedAt,
        record.dispatchedAt,
        record.executedAt,
        record.adapterError,
        record.adapterCallCount,
        record.finalPosition,
      );
  }

  #requireExecutionRecord(executionId: string): ExecutionRecord {
    const record = this.findExecutionRecord(executionId);
    if (!record) {
      throw new Error(`Execution record not found: ${executionId}`);
    }
    return record;
  }

  #injectFailure(point: Exclude<RepositoryFailureMode, "NONE">): void {
    if (this.#failureMode === point) {
      throw new Error(`Injected repository failure at ${point}.`);
    }
  }
}

function mapEvidenceRow(row: EvidenceRow): EvidenceRecord {
  return {
    evidenceRecordId: row.evidence_record_id,
    actionId: row.action_id,
    correlationId: row.correlation_id,
    normalizedAction: JSON.parse(row.normalized_action) as ActionProposal,
    actionDigest: row.action_digest,
    policyVersion: row.policy_version,
    conditionResults: JSON.parse(row.condition_results) as ConditionResult[],
    identityReferences: JSON.parse(row.identity_references) as string[],
    decisionTimestamp: row.decision_timestamp,
    previousRecordHash: row.previous_record_hash,
    currentRecordHash: row.current_record_hash,
  };
}

function mapGrantRow(row: GrantRow): AuthorizationGrant {
  return {
    grantId: row.grant_id,
    actionId: row.action_id,
    evidenceRecordId: row.evidence_record_id,
    actionDigest: row.action_digest,
    status: row.status,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    revokedAt: row.revoked_at,
  };
}

function mapExecutionRow(row: ExecutionRow): ExecutionRecord {
  return {
    executionId: row.execution_id,
    grantId: row.grant_id,
    actionId: row.action_id,
    state: row.state,
    consumedAt: row.consumed_at,
    dispatchedAt: row.dispatched_at,
    executedAt: row.executed_at,
    adapterError: row.adapter_error,
    adapterCallCount: row.adapter_call_count,
    finalPosition: row.final_position,
  };
}

function mapMissionEventRow(row: MissionEventRow): MissionEventRecord {
  return {
    missionEventId: row.mission_event_id,
    missionId: row.mission_id,
    sequence: row.sequence,
    correlationId: row.correlation_id,
    actionId: row.action_id,
    eventType: row.event_type,
    actor: row.actor,
    detail: row.detail,
    occurredAt: row.occurred_at,
    evidenceRecordId: row.evidence_record_id,
    grantId: row.grant_id,
  };
}
