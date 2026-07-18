import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";

import { canonicalJson, sha256 } from "../canonical-json.js";
import type {
  ActionProposal,
  AuthorizationDecision,
  AuthorizationGrant,
  ConditionResult,
  EvidenceRecord,
} from "../domain.js";
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
