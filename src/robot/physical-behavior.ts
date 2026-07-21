import type { NormalizedAction } from "../dispatch/types.js";

export const PHYSICAL_BEHAVIOR = Object.freeze({
  id: "MEDICATION_DELIVERY_MISSION_V1",
  actionKind: "MEDICATION_DELIVERY",
  destination: "Room 312",
  startLocation: "LOC-PHARMACY",
  deliveryLocation: "LOC-ROOM-312",
  homeLocation: "LOC-HOME",
  finalPosition: "home-base",
} as const);

export function supportsPhysicalBehavior(action: NormalizedAction): boolean {
  return action.kind === PHYSICAL_BEHAVIOR.actionKind &&
    action.destination === PHYSICAL_BEHAVIOR.destination;
}
