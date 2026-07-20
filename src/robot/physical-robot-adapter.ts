import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type {
  NormalizedAction,
  RobotAdapter,
  RobotExecutionReceipt,
  ValidatedAuthorizationGrant,
} from "../dispatch/types.js";
import { RobotAdapterExecutionError } from "./simulated-robot-adapter.js";
import { PHYSICAL_BEHAVIOR, supportsPhysicalBehavior } from "./physical-behavior.js";

export interface PhysicalRobotTransportRequest {
  readonly body: string;
  readonly timeoutMs: number;
}

export interface PhysicalRobotTransportResponse {
  readonly status: number;
  readonly body: string;
}

export interface PhysicalRobotTransport {
  request(request: PhysicalRobotTransportRequest): PhysicalRobotTransportResponse;
}

export interface PhysicalRobotAdapterOptions {
  readonly transport: PhysicalRobotTransport;
  readonly signingKey: Uint8Array;
  readonly now?: () => number;
  readonly nonce?: () => string;
  readonly timeoutMs?: number;
}

/**
 * Optional hardware adapter. The Dispatcher is its only intended caller, so its
 * public execution surface admits only the branded, consumed grant and exact
 * normalized action produced by the protected dispatch transaction.
 */
export class PhysicalRobotAdapter implements RobotAdapter {
  readonly #transport: PhysicalRobotTransport;
  readonly #signingKey: Uint8Array;
  readonly #now: () => number;
  readonly #nonce: () => string;
  readonly #timeoutMs: number;

  constructor(options: PhysicalRobotAdapterOptions) {
    if (options.signingKey.byteLength < 32) throw new TypeError("Physical adapter signing key is too short.");
    this.#transport = options.transport;
    this.#signingKey = options.signingKey.slice();
    this.#now = options.now ?? Date.now;
    this.#nonce = options.nonce ?? randomUUID;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1_000 || this.#timeoutMs > 15_000) {
      throw new TypeError("Physical adapter timeout is outside its allowed bounds.");
    }
  }

  execute(grant: ValidatedAuthorizationGrant, action: NormalizedAction): RobotExecutionReceipt {
    if (!supportsPhysicalBehavior(action)) {
      throw new RobotAdapterExecutionError("Physical adapter accepts only the canonical demonstration action.", 0, "unknown");
    }
    const envelope = {
      version: 1,
      grant_id: grant.grantId,
      evidence_record_id: grant.evidenceRecordId,
      action_id: action.actionId,
      action_digest: grant.actionDigest,
      action: {
        kind: action.kind,
        destination: action.destination,
      },
      behavior_id: PHYSICAL_BEHAVIOR.id,
      issued_at_ms: this.#now(),
      nonce: this.#nonce(),
    } as const;
    const payload = JSON.stringify(envelope);
    const signature = createHmac("sha256", this.#signingKey).update(payload).digest("hex");
    const response = this.#transport.request({
      body: JSON.stringify({ payload, signature }),
      timeoutMs: this.#timeoutMs,
    });
    if (response.status !== 200) {
      throw new RobotAdapterExecutionError(`Physical worker rejected dispatch (${response.status}).`, 1, "unknown");
    }
    const receipt = parseReceipt(response.body);
    return { finalPosition: receipt.final_position, adapterCallCount: 1 };
  }
}

function parseReceipt(body: string): { final_position: string } {
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new RobotAdapterExecutionError("Physical worker returned invalid JSON.", 1, "unknown"); }
  if (typeof value !== "object" || value === null || !("status" in value) || value.status !== "executed" ||
      !("final_position" in value) || value.final_position !== PHYSICAL_BEHAVIOR.finalPosition ||
      !("behavior_id" in value) || value.behavior_id !== PHYSICAL_BEHAVIOR.id) {
    throw new RobotAdapterExecutionError("Physical worker returned an invalid receipt.", 1, "unknown");
  }
  return { final_position: value.final_position };
}

/** Constant-time helper used by transport-level tests and future local transports. */
export function signaturesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}
