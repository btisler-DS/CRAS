import type { RequiredConditionId } from "../domain.js";

/**
 * Reproducible stand-in for the hospital systems that hold patient, order,
 * medication, and scheduling records. Browser input cannot alter these facts.
 */
export const PREPARED_MEDICATION_RECORD = Object.freeze({
  recordId: "DEMO-HOSPITAL-RECORD-8001",
  patientId: "PAT-1001",
  bedId: "BED-312-A",
  destinationId: "LOC-ROOM-312",
  orderId: "ORDER-8001",
  medicationId: "MED-2001",
  patientIdentityVerified: true,
  physicianOrderActive: true,
  medicationMatched: true,
  administrationWindowValid: true,
} as const);

export function resolvePreparedMedicationRecord() {
  const record = PREPARED_MEDICATION_RECORD;
  const conditionEvidence = {
    PATIENT_IDENTITY_VERIFIED: [
      `hospital-record:${record.recordId}:patient:${record.patientId}`,
      `hospital-record:${record.recordId}:bed:${record.bedId}`,
      `hospital-record:${record.recordId}:destination:${record.destinationId}`,
    ],
    PHYSICIAN_ORDER_ACTIVE: [
      `hospital-record:${record.recordId}:order:${record.orderId}:active`,
    ],
    MEDICATION_MATCHED: [
      `hospital-record:${record.recordId}:medication:${record.medicationId}`,
      `hospital-record:${record.recordId}:order:${record.orderId}`,
    ],
    ADMINISTRATION_WINDOW_VALID: [
      `hospital-record:${record.recordId}:administration-window:valid`,
    ],
  } satisfies Record<RequiredConditionId, readonly string[]>;
  return {
    facts: {
      patientIdentityVerified: record.patientIdentityVerified,
      physicianOrderActive: record.physicianOrderActive,
      medicationMatched: record.medicationMatched,
      administrationWindowValid: record.administrationWindowValid,
    },
    evidenceReferences: [...new Set(Object.values(conditionEvidence).flat())],
    conditionEvidence,
    record,
  } as const;
}
