import { z } from "zod";

import type { RequiredConditionId } from "../domain.js";
import { markerObservationSchema, type MarkerObservation } from "../server/vision/vision-client.js";

const observationArraySchema = z.array(markerObservationSchema).max(128);

export interface MedicationMissionRegistry {
  readonly patientMarkerId: string;
  readonly bedMarkerId: string;
  readonly destinationMarkerId: string;
  readonly medicationMarkerId: string;
  readonly orderMarkerId: string;
}

export interface MedicationObservationPolicy {
  readonly administrationWindowValid: boolean;
  readonly evaluatedAt: string;
  readonly maximumObservationAgeMs: number;
}

export interface ResolvedMedicationConditions {
  readonly facts: {
    readonly patientIdentityVerified: boolean;
    readonly physicianOrderActive: boolean;
    readonly medicationMatched: boolean;
    readonly administrationWindowValid: boolean;
  };
  readonly evidenceReferences: readonly string[];
  readonly conditionEvidence: Readonly<Record<RequiredConditionId, readonly string[]>>;
}

export const ROOM_312_MISSION_REGISTRY: MedicationMissionRegistry = {
  patientMarkerId: "PAT-1001",
  bedMarkerId: "BED-312-A",
  destinationMarkerId: "LOC-ROOM-312",
  medicationMarkerId: "MED-2001",
  orderMarkerId: "ORDER-8001",
};

/**
 * Converts untrusted camera observations into condition facts using a trusted,
 * server-owned mission registry. Observations route evidence; they never grant
 * authorization or dispatch an action.
 */
export function resolveMedicationObservations(
  observationInput: unknown,
  registry: MedicationMissionRegistry,
  policy: MedicationObservationPolicy,
): ResolvedMedicationConditions {
  const observations = observationArraySchema.parse(observationInput);
  const evaluatedAtMs = Date.parse(policy.evaluatedAt);
  if (!Number.isFinite(evaluatedAtMs)) throw new TypeError("Policy evaluation time is invalid.");
  if (!Number.isSafeInteger(policy.maximumObservationAgeMs) || policy.maximumObservationAgeMs <= 0) {
    throw new TypeError("Maximum observation age must be a positive safe integer.");
  }

  const freshById = new Map<string, MarkerObservation>();
  for (const observation of observations) {
    const age = evaluatedAtMs - Date.parse(observation.observed_at);
    if (age < 0 || age > policy.maximumObservationAgeMs) continue;
    const previous = freshById.get(observation.marker_id);
    if (!previous || previous.sequence < observation.sequence) {
      freshById.set(observation.marker_id, observation);
    }
  }

  const patient = exact(freshById, registry.patientMarkerId, "patient");
  const bed = exact(freshById, registry.bedMarkerId, "bed");
  const destination = exact(freshById, registry.destinationMarkerId, "location");
  const medication = exact(freshById, registry.medicationMarkerId, "medication");
  const order = exact(freshById, registry.orderMarkerId, "order");
  const patientEvidence = compact(patient, bed, destination);
  const orderEvidence = compact(order);
  const medicationEvidence = compact(medication, order);
  const windowEvidence = policy.administrationWindowValid
    ? [`policy:administration-window:${policy.evaluatedAt}`]
    : [];

  const conditionEvidence = {
    PATIENT_IDENTITY_VERIFIED: patientEvidence.map(reference),
    PHYSICIAN_ORDER_ACTIVE: orderEvidence.map(reference),
    MEDICATION_MATCHED: medicationEvidence.map(reference),
    ADMINISTRATION_WINDOW_VALID: windowEvidence,
  } satisfies Record<RequiredConditionId, readonly string[]>;

  return {
    facts: {
      patientIdentityVerified: patientEvidence.length === 3,
      physicianOrderActive: orderEvidence.length === 1,
      medicationMatched: medicationEvidence.length === 2,
      administrationWindowValid: policy.administrationWindowValid,
    },
    evidenceReferences: [...new Set(Object.values(conditionEvidence).flat())],
    conditionEvidence,
  };
}

function exact(
  observations: ReadonlyMap<string, MarkerObservation>,
  markerId: string,
  kind: MarkerObservation["kind"],
): MarkerObservation | null {
  const observation = observations.get(markerId);
  return observation?.kind === kind ? observation : null;
}

function compact(...items: readonly (MarkerObservation | null)[]): MarkerObservation[] {
  return items.filter((item): item is MarkerObservation => item !== null);
}

function reference(observation: MarkerObservation): string {
  return `observation:${observation.observation_id}:${observation.marker_id}`;
}
