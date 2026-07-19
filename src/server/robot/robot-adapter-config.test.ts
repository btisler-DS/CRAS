import { describe, expect, it } from "vitest";

import type { PhysicalRobotTransport } from "../../robot/physical-robot-adapter.js";
import { PhysicalRobotAdapter } from "../../robot/physical-robot-adapter.js";
import { SimulatedRobotAdapter } from "../../robot/simulated-robot-adapter.js";
import {
  createRobotAdapter,
  createRobotAdapterFromEnvironment,
} from "./robot-adapter-config.js";

describe("server-only robot adapter selection", () => {
  it("defaults to the canonical simulator without hardware access", () => {
    expect(createRobotAdapterFromEnvironment({})).toBeInstanceOf(SimulatedRobotAdapter);
  });

  it("rejects arbitrary or browser-like adapter names", () => {
    expect(() => createRobotAdapterFromEnvironment({ CRAS_ROBOT_ADAPTER: "http://robot/move" })).toThrow(
      "Unsupported robot adapter selection",
    );
  });

  it("fails closed when physical configuration is incomplete", () => {
    expect(() => createRobotAdapterFromEnvironment({ CRAS_ROBOT_ADAPTER: "physical" })).toThrow(
      "CRAS_PHYSICAL_WORKER_BASE_URL is required",
    );
    expect(() => createRobotAdapter({ selection: "physical" })).toThrow(
      "requires an injected transport and signing key",
    );
  });

  it("constructs the physical adapter passively from injected server dependencies", () => {
    let calls = 0;
    const transport: PhysicalRobotTransport = {
      request() { calls += 1; return { status: 503, body: "{}" }; },
    };
    const adapter = createRobotAdapter({
      selection: "physical",
      physicalTransport: transport,
      physicalSigningKey: new Uint8Array(32).fill(3),
    });
    expect(adapter).toBeInstanceOf(PhysicalRobotAdapter);
    expect(calls).toBe(0);
  });
});
