import { readFileSync } from "node:fs";

import type { RobotAdapter } from "../../dispatch/types.js";
import { HttpPhysicalRobotTransport } from "../../robot/http-physical-robot-transport.js";
import {
  PhysicalRobotAdapter,
  type PhysicalRobotTransport,
} from "../../robot/physical-robot-adapter.js";
import { SimulatedRobotAdapter } from "../../robot/simulated-robot-adapter.js";

export type RobotAdapterSelection = "simulator" | "physical";

export interface RobotAdapterConfiguration {
  readonly selection: RobotAdapterSelection;
  readonly physicalTransport?: PhysicalRobotTransport;
  readonly physicalSigningKey?: Uint8Array;
  readonly physicalTimeoutMs?: number;
}

export interface RobotAdapterEnvironment {
  readonly CRAS_ROBOT_ADAPTER?: string;
  readonly CRAS_PHYSICAL_WORKER_BASE_URL?: string;
  readonly CRAS_ROBOT_SIGNING_KEY_FILE?: string;
}

/** Passive factory. The simulator remains the default and canonical adapter. */
export function createRobotAdapter(configuration: RobotAdapterConfiguration): RobotAdapter {
  if (configuration.selection === "simulator") return new SimulatedRobotAdapter();
  if (configuration.physicalTransport === undefined || configuration.physicalSigningKey === undefined) {
    throw new RobotAdapterConfigurationError(
      "PHYSICAL_CONFIGURATION_MISSING",
      "Physical selection requires an injected transport and signing key.",
    );
  }
  return new PhysicalRobotAdapter({
    transport: configuration.physicalTransport,
    signingKey: configuration.physicalSigningKey,
    ...(configuration.physicalTimeoutMs === undefined ? {} : { timeoutMs: configuration.physicalTimeoutMs }),
  });
}

/** Reads only server-owned configuration. Never call this with browser input. */
export function createRobotAdapterFromEnvironment(
  environment: RobotAdapterEnvironment,
): RobotAdapter {
  const selection = parseSelection(environment.CRAS_ROBOT_ADAPTER);
  if (selection === "simulator") return createRobotAdapter({ selection });
  const baseUrl = requireSetting(environment.CRAS_PHYSICAL_WORKER_BASE_URL, "CRAS_PHYSICAL_WORKER_BASE_URL");
  const keyPath = requireSetting(environment.CRAS_ROBOT_SIGNING_KEY_FILE, "CRAS_ROBOT_SIGNING_KEY_FILE");
  let key: Uint8Array;
  try {
    key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "utf8");
  } catch (error) {
    throw new RobotAdapterConfigurationError(
      "SIGNING_KEY_UNAVAILABLE",
      "The physical robot signing key is unavailable.",
      error,
    );
  }
  return createRobotAdapter({
    selection,
    physicalTransport: new HttpPhysicalRobotTransport({ baseUrl }),
    physicalSigningKey: key,
  });
}

export type RobotAdapterConfigurationErrorCode =
  | "UNSUPPORTED_SELECTION"
  | "PHYSICAL_CONFIGURATION_MISSING"
  | "SIGNING_KEY_UNAVAILABLE";

export class RobotAdapterConfigurationError extends Error {
  constructor(
    readonly code: RobotAdapterConfigurationErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "RobotAdapterConfigurationError";
  }
}

function parseSelection(value: string | undefined): RobotAdapterSelection {
  if (value === undefined || value === "simulator") return "simulator";
  if (value === "physical") return value;
  throw new RobotAdapterConfigurationError("UNSUPPORTED_SELECTION", "Unsupported robot adapter selection.");
}

function requireSetting(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new RobotAdapterConfigurationError(
      "PHYSICAL_CONFIGURATION_MISSING",
      `${name} is required for physical robot selection.`,
    );
  }
  return value;
}
