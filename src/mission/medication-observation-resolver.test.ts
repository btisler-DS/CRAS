import { describe, expect, it } from "vitest";

import type { MarkerKind, MarkerObservation } from "../server/vision/vision-client.js";
import {
  resolveMedicationObservations,
  ROOM_312_MISSION_REGISTRY,
} from "./medication-observation-resolver.js";

const NOW = "2026-07-20T22:00:00.000Z";

function marker(sequence: number, kind: MarkerKind, markerId: string, observedAt = NOW): MarkerObservation {
  return {
    sequence,
    observation_id: `marker-${String(sequence).padStart(8, "0")}`,
    marker_id: markerId,
    kind,
    payload: `cras:v1:${kind}:${markerId.toLowerCase()}`,
    observed_at: observedAt,
    frame_sequence: sequence,
    decoder: "opencv-qrcode-detector",
    confidence: null,
    corners: null,
  };
}

const policy = { administrationWindowValid: true, evaluatedAt: NOW, maximumObservationAgeMs: 30_000 };

describe("resolveMedicationObservations", () => {
  it("resolves the four conditions only from the exact registered evidence set", () => {
    const result = resolveMedicationObservations([
      marker(1, "patient", "PAT-1001"),
      marker(2, "bed", "BED-312-A"),
      marker(3, "location", "LOC-ROOM-312"),
      marker(4, "medication", "MED-2001"),
      marker(5, "order", "ORDER-8001"),
    ], ROOM_312_MISSION_REGISTRY, policy);

    expect(result.facts).toEqual({
      patientIdentityVerified: true,
      physicianOrderActive: true,
      medicationMatched: true,
      administrationWindowValid: true,
    });
    expect(result.evidenceReferences).toHaveLength(6);
  });

  it("fails closed for wrong patient and wrong medication markers", () => {
    const result = resolveMedicationObservations([
      marker(1, "patient", "PAT-1002"),
      marker(2, "bed", "BED-312-A"),
      marker(3, "location", "LOC-ROOM-312"),
      marker(4, "medication", "MED-2002"),
      marker(5, "order", "ORDER-8001"),
    ], ROOM_312_MISSION_REGISTRY, policy);

    expect(result.facts.patientIdentityVerified).toBe(false);
    expect(result.facts.medicationMatched).toBe(false);
    expect(result.facts.physicianOrderActive).toBe(true);
  });

  it("rejects stale observations and does not interpret a face as identity evidence", () => {
    const result = resolveMedicationObservations([
      marker(1, "patient", "PAT-1001", "2026-07-20T21:58:00.000Z"),
      marker(2, "bed", "BED-312-A"),
      marker(3, "location", "LOC-ROOM-312"),
      marker(4, "medication", "MED-2001"),
      marker(5, "order", "ORDER-8001"),
    ], ROOM_312_MISSION_REGISTRY, policy);

    expect(result.facts.patientIdentityVerified).toBe(false);
    expect(() => resolveMedicationObservations([{ face: "PAT-1001" }], ROOM_312_MISSION_REGISTRY, policy)).toThrow();
  });
});
