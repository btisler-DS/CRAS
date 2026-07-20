import "server-only";

import { createHmac, randomUUID } from "node:crypto";

export const ROBOT_ACKNOWLEDGMENT_TYPES = [
  "ATTENTION",
  "INSTRUCTION_RECEIVED",
  "AUTHORIZED",
  "MISSION_COMPLETED",
] as const;

export type RobotAcknowledgmentType =
  (typeof ROBOT_ACKNOWLEDGMENT_TYPES)[number];

export interface RobotAcknowledgmentTransportRequest {
  readonly path: "/acknowledge";
  readonly body: string;
  readonly timeoutMs: number;
}

export interface RobotAcknowledgmentTransportResponse {
  readonly status: number;
  readonly body: string;
}

export interface RobotAcknowledgmentTransport {
  request(
    request: RobotAcknowledgmentTransportRequest,
  ): RobotAcknowledgmentTransportResponse;
}

export interface RobotAcknowledgmentClientOptions {
  readonly transport: RobotAcknowledgmentTransport;
  readonly signingKey: Uint8Array;
  readonly now?: () => number;
  readonly nonce?: () => string;
  readonly timeoutMs?: number;
}

export interface RobotAcknowledgmentRequest {
  readonly missionId: string;
  readonly eventId: string;
  readonly acknowledgment: RobotAcknowledgmentType;
}

export interface RobotAcknowledgmentResult {
  readonly status: "ACKNOWLEDGED";
  readonly acknowledgment: RobotAcknowledgmentType;
  readonly cleanupCompleted: true;
}

/** Server-only admission boundary for four fixed robot-local tone patterns. */
export class RobotAcknowledgmentClient {
  readonly #transport: RobotAcknowledgmentTransport;
  readonly #signingKey: Uint8Array;
  readonly #now: () => number;
  readonly #nonce: () => string;
  readonly #timeoutMs: number;

  constructor(options: RobotAcknowledgmentClientOptions) {
    if (options.signingKey.byteLength < 32) {
      throw new RobotAcknowledgmentError(
        "CONFIGURATION_INVALID",
        "Robot acknowledgment signing key is too short.",
      );
    }
    const timeoutMs = options.timeoutMs ?? 5_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 8_000) {
      throw new RobotAcknowledgmentError(
        "CONFIGURATION_INVALID",
        "Robot acknowledgment timeout is outside its allowed bounds.",
      );
    }
    this.#transport = options.transport;
    this.#signingKey = options.signingKey.slice();
    this.#now = options.now ?? Date.now;
    this.#nonce = options.nonce ?? randomUUID;
    this.#timeoutMs = timeoutMs;
  }

  acknowledge(request: RobotAcknowledgmentRequest): RobotAcknowledgmentResult {
    requireIdentifier(request.missionId, "missionId");
    requireIdentifier(request.eventId, "eventId");
    if (!ROBOT_ACKNOWLEDGMENT_TYPES.includes(request.acknowledgment)) {
      throw new RobotAcknowledgmentError(
        "REQUEST_INVALID",
        "Unsupported robot acknowledgment type.",
      );
    }
    const envelope = {
      version: 1,
      mission_id: request.missionId,
      event_id: request.eventId,
      acknowledgment: request.acknowledgment,
      issued_at_ms: this.#now(),
      nonce: this.#nonce(),
    } as const;
    const payload = JSON.stringify(envelope);
    const signature = createHmac("sha256", this.#signingKey)
      .update(payload)
      .digest("hex");
    let response: RobotAcknowledgmentTransportResponse;
    try {
      response = this.#transport.request({
        path: "/acknowledge",
        body: JSON.stringify({ payload, signature }),
        timeoutMs: this.#timeoutMs,
      });
    } catch (error) {
      throw new RobotAcknowledgmentError(
        "TRANSPORT_FAILED",
        "Robot acknowledgment transport failed.",
        error,
      );
    }
    if (response.status !== 200) {
      throw new RobotAcknowledgmentError(
        response.status === 409 ? "REPLAY_REJECTED" : "WORKER_REJECTED",
        `Robot worker rejected acknowledgment (${response.status}).`,
      );
    }
    const result = parseResult(response.body, request.acknowledgment);
    return result;
  }
}

export type RobotAcknowledgmentErrorCode =
  | "CONFIGURATION_INVALID"
  | "REQUEST_INVALID"
  | "TRANSPORT_FAILED"
  | "WORKER_REJECTED"
  | "REPLAY_REJECTED"
  | "RESPONSE_INVALID";

export class RobotAcknowledgmentError extends Error {
  constructor(
    readonly code: RobotAcknowledgmentErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "RobotAcknowledgmentError";
  }
}

function requireIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new RobotAcknowledgmentError(
      "REQUEST_INVALID",
      `${name} is invalid.`,
    );
  }
}

function parseResult(
  body: string,
  expected: RobotAcknowledgmentType,
): RobotAcknowledgmentResult {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new RobotAcknowledgmentError(
      "RESPONSE_INVALID",
      "Robot worker returned invalid acknowledgment JSON.",
    );
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    value.status !== "acknowledged" ||
    !("acknowledgment" in value) ||
    value.acknowledgment !== expected ||
    !("cleanup_completed" in value) ||
    value.cleanup_completed !== true
  ) {
    throw new RobotAcknowledgmentError(
      "RESPONSE_INVALID",
      "Robot worker returned an invalid acknowledgment receipt.",
    );
  }
  return {
    status: "ACKNOWLEDGED",
    acknowledgment: expected,
    cleanupCompleted: true,
  };
}
