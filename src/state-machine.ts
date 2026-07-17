import type { AuthorizationState } from "./domain.js";

const PHASE_ONE_TRANSITIONS: Readonly<
  Partial<Record<AuthorizationState, readonly AuthorizationState[]>>
> = {
  RECEIVED: ["EVALUATING"],
  EVALUATING: ["BLOCKED", "READY_FOR_EVIDENCE"],
};

export class InvalidAuthorizationTransitionError extends Error {
  constructor(
    readonly from: AuthorizationState,
    readonly to: AuthorizationState,
  ) {
    super(`Invalid authorization state transition: ${from} -> ${to}`);
    this.name = "InvalidAuthorizationTransitionError";
  }
}

/**
 * Phase 1 state machine. Later states are explicit domain values but are not
 * reachable until their enforcing components are implemented.
 */
export class AuthorizationStateMachine {
  #state: AuthorizationState = "RECEIVED";

  get state(): AuthorizationState {
    return this.#state;
  }

  transition(to: AuthorizationState): void {
    const allowed = PHASE_ONE_TRANSITIONS[this.#state] ?? [];
    if (!allowed.includes(to)) {
      throw new InvalidAuthorizationTransitionError(this.#state, to);
    }
    this.#state = to;
  }
}
