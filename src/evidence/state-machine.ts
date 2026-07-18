import type { AuthorizationState } from "../domain.js";
import { InvalidAuthorizationTransitionError } from "../state-machine.js";

const EVIDENCE_TRANSITIONS: Readonly<
  Partial<Record<AuthorizationState, readonly AuthorizationState[]>>
> = {
  READY_FOR_EVIDENCE: ["COMMITTING_EVIDENCE"],
  COMMITTING_EVIDENCE: ["AUTHORIZED", "EVIDENCE_COMMIT_FAILED"],
};

/** Separate Phase 2 machine; the Phase 1 kernel and its ceiling are unchanged. */
export class EvidenceAuthorizationStateMachine {
  #state: AuthorizationState = "READY_FOR_EVIDENCE";

  get state(): AuthorizationState {
    return this.#state;
  }

  transition(to: AuthorizationState): void {
    const allowed = EVIDENCE_TRANSITIONS[this.#state] ?? [];
    if (!allowed.includes(to)) {
      throw new InvalidAuthorizationTransitionError(this.#state, to);
    }
    this.#state = to;
  }
}
