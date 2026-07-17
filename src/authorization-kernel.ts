import type { AuthorizationDecision } from "./domain.js";
import {
  evaluateMedicationDeliveryConditions,
  parseActionProposal,
  parseMedicationDeliveryFacts,
} from "./medication-delivery.js";
import { AuthorizationStateMachine } from "./state-machine.js";

/**
 * Deterministic Phase 1 boundary. Unknown inputs are validated strictly and
 * the furthest successful state is READY_FOR_EVIDENCE.
 */
export function evaluateAuthorization(
  proposalInput: unknown,
  factsInput: unknown,
): AuthorizationDecision {
  const proposal = parseActionProposal(proposalInput);
  const facts = parseMedicationDeliveryFacts(factsInput);
  const stateMachine = new AuthorizationStateMachine();

  stateMachine.transition("EVALUATING");
  const conditionResults = evaluateMedicationDeliveryConditions(proposal, facts);
  const blockingReasons = conditionResults
    .filter((result) => !result.satisfied)
    .map((result) => result.reason);

  if (blockingReasons.length > 0) {
    stateMachine.transition("BLOCKED");
    return {
      actionId: proposal.actionId,
      outcome: "UNAUTHORIZED",
      state: "BLOCKED",
      conditionResults,
      blockingReasons,
    };
  }

  stateMachine.transition("READY_FOR_EVIDENCE");
  return {
    actionId: proposal.actionId,
    outcome: "PENDING_EVIDENCE",
    state: "READY_FOR_EVIDENCE",
    conditionResults,
    blockingReasons: [],
  };
}
