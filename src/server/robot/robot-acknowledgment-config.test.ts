import { describe, expect, it, vi } from "vitest";

import { RobotAcknowledgmentClient } from "./robot-acknowledgment-client.js";
import {
  createRobotAcknowledgmentClient,
  createRobotAcknowledgmentClientFromEnvironment,
  RobotAcknowledgmentConfigurationError,
} from "./robot-acknowledgment-config.js";

describe("robot acknowledgment configuration", () => {
  it("is disabled and passive by default", () => {
    expect(createRobotAcknowledgmentClientFromEnvironment({})).toBeNull();
  });

  it("constructs an injected physical client without executing it", () => {
    const request = vi.fn();
    const client = createRobotAcknowledgmentClient({
      enabled: true,
      transport: { request },
      signingKey: new Uint8Array(32).fill(2),
    });
    expect(client).toBeInstanceOf(RobotAcknowledgmentClient);
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed on incomplete or browser-like arbitrary selection", () => {
    expect(() =>
      createRobotAcknowledgmentClient({ enabled: true }),
    ).toThrowError(RobotAcknowledgmentConfigurationError);
    expect(() =>
      createRobotAcknowledgmentClientFromEnvironment({
        CRAS_ROBOT_ACKNOWLEDGMENTS: "http://robot/tones",
      }),
    ).toThrowError(/Unsupported robot acknowledgment selection/);
  });
});
