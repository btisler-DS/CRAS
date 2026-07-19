import type { NormalizedAction } from "../dispatch/types.js";

export const PHYSICAL_BEHAVIOR = Object.freeze({
  id: "MEDICATION_DELIVERY_DEMO_V1",
  actionKind: "MEDICATION_DELIVERY",
  destination: "Room 312",
  leftMotor: 1,
  rightMotor: 2,
  speed: 1,
  durationMs: 1_000,
  finalPosition: "physical-demo-complete",
} as const);

export function supportsPhysicalBehavior(action: NormalizedAction): boolean {
  return action.kind === PHYSICAL_BEHAVIOR.actionKind &&
    action.destination === PHYSICAL_BEHAVIOR.destination;
}
