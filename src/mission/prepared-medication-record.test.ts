import { describe, expect, it } from "vitest";

import {
  PREPARED_MEDICATION_RECORD,
  resolvePreparedMedicationRecord,
} from "./prepared-medication-record.js";

describe("prepared hospital medication record", () => {
  it("resolves the canonical scenario from server-owned immutable facts", () => {
    const resolved = resolvePreparedMedicationRecord();
    expect(resolved.facts).toEqual({
      patientIdentityVerified: true,
      physicianOrderActive: true,
      medicationMatched: true,
      administrationWindowValid: true,
    });
    expect(resolved.evidenceReferences).toContain(
      `hospital-record:${PREPARED_MEDICATION_RECORD.recordId}:patient:PAT-1001`,
    );
    expect(resolved.evidenceReferences).toHaveLength(7);
  });
});
