import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  RobotAcknowledgmentClient,
  RobotAcknowledgmentError,
  type RobotAcknowledgmentTransport,
  type RobotAcknowledgmentTransportRequest,
} from "./robot-acknowledgment-client.js";

const signingKey = new Uint8Array(32).fill(17);

function successTransport(
  calls: RobotAcknowledgmentTransportRequest[],
): RobotAcknowledgmentTransport {
  return {
    request(request) {
      calls.push(request);
      const outer = JSON.parse(request.body) as {
        payload: string;
        signature: string;
      };
      const envelope = JSON.parse(outer.payload) as {
        acknowledgment: string;
      };
      expect(outer.signature).toBe(
        createHmac("sha256", signingKey).update(outer.payload).digest("hex"),
      );
      return {
        status: 200,
        body: JSON.stringify({
          status: "acknowledged",
          acknowledgment: envelope.acknowledgment,
          cleanup_completed: true,
        }),
      };
    },
  };
}

describe("RobotAcknowledgmentClient", () => {
  it("sends a signed, bounded request for a fixed acknowledgment", () => {
    const calls: RobotAcknowledgmentTransportRequest[] = [];
    const client = new RobotAcknowledgmentClient({
      transport: successTransport(calls),
      signingKey,
      now: () => 42,
      nonce: () => "nonce_1",
      timeoutMs: 2_000,
    });

    expect(
      client.acknowledge({
        missionId: "mission_1",
        eventId: "event_1",
        acknowledgment: "ATTENTION",
      }),
    ).toEqual({
      status: "ACKNOWLEDGED",
      acknowledgment: "ATTENTION",
      cleanupCompleted: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/acknowledge");
    expect(calls[0]?.timeoutMs).toBe(2_000);
    const outer = JSON.parse(calls[0]!.body) as { payload: string };
    expect(JSON.parse(outer.payload)).toEqual({
      version: 1,
      mission_id: "mission_1",
      event_id: "event_1",
      acknowledgment: "ATTENTION",
      issued_at_ms: 42,
      nonce: "nonce_1",
    });
  });

  it("performs no transport work during construction", () => {
    const request = vi.fn();
    new RobotAcknowledgmentClient({
      transport: { request },
      signingKey,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects invalid configuration and runtime-untyped input", () => {
    expect(
      () =>
        new RobotAcknowledgmentClient({
          transport: { request: vi.fn() },
          signingKey: new Uint8Array(31),
        }),
    ).toThrowError(RobotAcknowledgmentError);

    const request = vi.fn();
    const client = new RobotAcknowledgmentClient({
      transport: { request },
      signingKey,
    });
    expect(() =>
      client.acknowledge({
        missionId: "../mission",
        eventId: "event_1",
        acknowledgment: "ATTENTION",
      }),
    ).toThrowError(/missionId is invalid/);
    expect(() =>
      client.acknowledge({
        missionId: "mission_1",
        eventId: "event_1",
        acknowledgment: "CUSTOM_TONE",
      } as never),
    ).toThrowError(/Unsupported robot acknowledgment/);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [409, "REPLAY_REJECTED"],
    [422, "WORKER_REJECTED"],
  ] as const)("maps worker status %i to %s", (status, code) => {
    const client = new RobotAcknowledgmentClient({
      transport: { request: () => ({ status, body: "{}" }) },
      signingKey,
    });
    try {
      client.acknowledge({
        missionId: "mission_1",
        eventId: "event_1",
        acknowledgment: "MISSION_COMPLETED",
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RobotAcknowledgmentError);
      expect((error as RobotAcknowledgmentError).code).toBe(code);
    }
  });

  it("returns typed transport and receipt failures", () => {
    const transportFailure = new RobotAcknowledgmentClient({
      transport: {
        request() {
          throw new Error("offline");
        },
      },
      signingKey,
    });
    expect(() =>
      transportFailure.acknowledge({
        missionId: "mission_1",
        eventId: "event_1",
        acknowledgment: "AUTHORIZED",
      }),
    ).toThrowError(expect.objectContaining({ code: "TRANSPORT_FAILED" }));

    const badReceipt = new RobotAcknowledgmentClient({
      transport: { request: () => ({ status: 200, body: "{}" }) },
      signingKey,
    });
    expect(() =>
      badReceipt.acknowledge({
        missionId: "mission_1",
        eventId: "event_1",
        acknowledgment: "AUTHORIZED",
      }),
    ).toThrowError(expect.objectContaining({ code: "RESPONSE_INVALID" }));
  });
});
