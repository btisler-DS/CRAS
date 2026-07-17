import { z } from "zod";

import type {
  ActionProposal,
  ConditionResult,
  RequiredCondition,
  RequiredConditionId,
} from "./domain.js";

const nonEmptyString = z.string().trim().min(1);

const actionProposalSchema = z
  .object({
    actionId: nonEmptyString,
    kind: z.literal("MEDICATION_DELIVERY"),
    instruction: nonEmptyString,
    destination: nonEmptyString,
    medicationId: nonEmptyString,
    patientId: nonEmptyString.nullable(),
  })
  .strict();

const medicationDeliveryFactsSchema = z
  .object({
    patientIdentityVerified: z.boolean(),
    physicianOrderActive: z.boolean(),
    medicationMatched: z.boolean(),
    administrationWindowValid: z.boolean(),
  })
  .strict();

export type MedicationDeliveryFacts = z.infer<
  typeof medicationDeliveryFactsSchema
>;

export const MEDICATION_DELIVERY_CONDITIONS: Readonly<
  Record<RequiredConditionId, RequiredCondition>
> = {
  PATIENT_IDENTITY_VERIFIED: {
    id: "PATIENT_IDENTITY_VERIFIED",
    label: "Patient identity verified",
    blockingReason: "Patient identity is unresolved or has not been verified.",
  },
  PHYSICIAN_ORDER_ACTIVE: {
    id: "PHYSICIAN_ORDER_ACTIVE",
    label: "Physician order active",
    blockingReason: "The physician order is not active.",
  },
  MEDICATION_MATCHED: {
    id: "MEDICATION_MATCHED",
    label: "Medication matched",
    blockingReason: "The medication does not match the active order.",
  },
  ADMINISTRATION_WINDOW_VALID: {
    id: "ADMINISTRATION_WINDOW_VALID",
    label: "Administration window valid",
    blockingReason: "The medication administration window is not valid.",
  },
};

export function parseActionProposal(input: unknown): ActionProposal {
  return actionProposalSchema.parse(input);
}

export function parseMedicationDeliveryFacts(
  input: unknown,
): MedicationDeliveryFacts {
  return medicationDeliveryFactsSchema.parse(input);
}

export function evaluateMedicationDeliveryConditions(
  proposal: ActionProposal,
  facts: MedicationDeliveryFacts,
): readonly ConditionResult[] {
  const values: Readonly<Record<RequiredConditionId, boolean>> = {
    PATIENT_IDENTITY_VERIFIED:
      proposal.patientId !== null && facts.patientIdentityVerified,
    PHYSICIAN_ORDER_ACTIVE: facts.physicianOrderActive,
    MEDICATION_MATCHED: facts.medicationMatched,
    ADMINISTRATION_WINDOW_VALID: facts.administrationWindowValid,
  };

  return Object.values(MEDICATION_DELIVERY_CONDITIONS).map((condition) => ({
    condition,
    satisfied: values[condition.id],
    reason: values[condition.id]
      ? `${condition.label}.`
      : condition.blockingReason,
  }));
}
