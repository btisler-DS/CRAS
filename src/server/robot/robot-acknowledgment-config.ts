import "server-only";

import { readFileSync } from "node:fs";

import { HttpRobotAcknowledgmentTransport } from "./http-robot-acknowledgment-transport.js";
import {
  RobotAcknowledgmentClient,
  type RobotAcknowledgmentTransport,
} from "./robot-acknowledgment-client.js";

export interface RobotAcknowledgmentEnvironment {
  readonly CRAS_ROBOT_ACKNOWLEDGMENTS?: string | undefined;
  readonly CRAS_PHYSICAL_WORKER_BASE_URL?: string | undefined;
  readonly CRAS_ROBOT_SIGNING_KEY_FILE?: string | undefined;
}

export interface RobotAcknowledgmentConfiguration {
  readonly enabled: boolean;
  readonly transport?: RobotAcknowledgmentTransport;
  readonly signingKey?: Uint8Array;
}

/** Passive, server-owned factory. Browser input cannot select this capability. */
export function createRobotAcknowledgmentClient(
  configuration: RobotAcknowledgmentConfiguration,
): RobotAcknowledgmentClient | null {
  if (!configuration.enabled) return null;
  if (!configuration.transport || !configuration.signingKey) {
    throw new RobotAcknowledgmentConfigurationError(
      "CONFIGURATION_MISSING",
      "Physical acknowledgments require a transport and signing key.",
    );
  }
  return new RobotAcknowledgmentClient({
    transport: configuration.transport,
    signingKey: configuration.signingKey,
  });
}

export function createRobotAcknowledgmentClientFromEnvironment(
  environment: RobotAcknowledgmentEnvironment,
): RobotAcknowledgmentClient | null {
  const selection = environment.CRAS_ROBOT_ACKNOWLEDGMENTS ?? "disabled";
  if (selection === "disabled") return null;
  if (selection !== "physical") {
    throw new RobotAcknowledgmentConfigurationError(
      "UNSUPPORTED_SELECTION",
      "Unsupported robot acknowledgment selection.",
    );
  }
  const baseUrl = requireSetting(
    environment.CRAS_PHYSICAL_WORKER_BASE_URL,
    "CRAS_PHYSICAL_WORKER_BASE_URL",
  );
  const keyPath = requireSetting(
    environment.CRAS_ROBOT_SIGNING_KEY_FILE,
    "CRAS_ROBOT_SIGNING_KEY_FILE",
  );
  let signingKey: Uint8Array;
  try {
    signingKey = Buffer.from(readFileSync(keyPath, "utf8").trim(), "utf8");
  } catch (error) {
    throw new RobotAcknowledgmentConfigurationError(
      "SIGNING_KEY_UNAVAILABLE",
      "The robot acknowledgment signing key is unavailable.",
      error,
    );
  }
  return createRobotAcknowledgmentClient({
    enabled: true,
    transport: new HttpRobotAcknowledgmentTransport({ baseUrl }),
    signingKey,
  });
}

export type RobotAcknowledgmentConfigurationErrorCode =
  | "UNSUPPORTED_SELECTION"
  | "CONFIGURATION_MISSING"
  | "SIGNING_KEY_UNAVAILABLE";

export class RobotAcknowledgmentConfigurationError extends Error {
  constructor(
    readonly code: RobotAcknowledgmentConfigurationErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "RobotAcknowledgmentConfigurationError";
  }
}

function requireSetting(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new RobotAcknowledgmentConfigurationError(
      "CONFIGURATION_MISSING",
      `${name} is required for physical acknowledgments.`,
    );
  }
  return value;
}
