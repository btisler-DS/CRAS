import { z } from "zod";

import { evaluateAuthorization } from "../authorization-kernel.js";
import type { AuthorizationDecision, AuthorizationGrant, EvidenceRecord } from "../domain.js";
import type { EvidenceRepository } from "../evidence/repository.js";
import { ConversationIntentResolver } from "./conversation-intent-resolver.js";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(500),
  source: z.enum(["voice", "typed"]),
}).strict();

const contextSchema = z.object({
  actionId: z.string().trim().min(1).max(200),
  medicationId: z.string().trim().min(1).max(200),
  patientId: z.string().trim().min(1).max(200).nullable(),
  patientIdentityVerified: z.boolean(),
  physicianOrderActive: z.boolean(),
  medicationMatched: z.boolean(),
  administrationWindowValid: z.boolean(),
  correlationId: z.string().trim().min(1).max(200),
  policyVersion: z.string().trim().min(1).max(200),
  identityReferences: z.array(z.string().trim().min(1).max(300)).max(20),
}).strict();

export type ActionAuthorizationResult =
  | { readonly state: "NOT_ACTION"; readonly grant: null; readonly reason: string }
  | { readonly state: "UNSUPPORTED_ACTION"; readonly grant: null; readonly reason: string }
  | { readonly state: "BLOCKED"; readonly grant: null; readonly decision: AuthorizationDecision }
  | { readonly state: "EVIDENCE_COMMIT_FAILED"; readonly grant: null; readonly reason: string }
  | { readonly state: "AUTHORIZED"; readonly grant: AuthorizationGrant; readonly evidenceRecord: EvidenceRecord };

export interface ActionAuthorizationServiceOptions {
  readonly repository: EvidenceRepository;
  readonly resolver?: ConversationIntentResolver;
}

const CANONICAL_DELIVERY = /^(?:please\s+)?deliver medication to room (?:312|three twelve)[.!?]?$/i;

/** Phase 5D-7 ends at a committed grant. It has no Dispatcher dependency. */
export class ActionAuthorizationService {
  readonly #repository: EvidenceRepository;
  readonly #resolver: ConversationIntentResolver;

  constructor(options: ActionAuthorizationServiceOptions) {
    this.#repository = options.repository;
    this.#resolver = options.resolver ?? new ConversationIntentResolver();
  }

  authorize(requestInput: unknown, contextInput: unknown): ActionAuthorizationResult {
    const request = requestSchema.parse(requestInput);
    const context = contextSchema.parse(contextInput);
    const resolution = this.#resolver.resolve(request);
    if (resolution.intent !== "action_request") {
      return { state: "NOT_ACTION", grant: null, reason: `Intent routed to ${resolution.destination}.` };
    }
    if (!CANONICAL_DELIVERY.test(resolution.normalizedText)) {
      return { state: "UNSUPPORTED_ACTION", grant: null, reason: "Action request is not the canonical medication-delivery command." };
    }

    const proposal = {
      actionId: context.actionId,
      kind: "MEDICATION_DELIVERY" as const,
      instruction: "Deliver medication to Room 312.",
      destination: "Room 312",
      medicationId: context.medicationId,
      patientId: context.patientId,
    };
    const decision = evaluateAuthorization(proposal, {
      patientIdentityVerified: context.patientIdentityVerified,
      physicianOrderActive: context.physicianOrderActive,
      medicationMatched: context.medicationMatched,
      administrationWindowValid: context.administrationWindowValid,
    });
    if (decision.state === "BLOCKED") return { state: "BLOCKED", grant: null, decision };

    const result = this.#repository.authorize({
      proposal,
      decision,
      correlationId: context.correlationId,
      policyVersion: context.policyVersion,
      identityReferences: context.identityReferences,
    });
    if (result.state === "EVIDENCE_COMMIT_FAILED") {
      return { state: result.state, grant: null, reason: result.error };
    }
    return { state: "AUTHORIZED", grant: result.grant, evidenceRecord: result.evidenceRecord };
  }
}
