import type { AuthorizationState } from "../domain.js";
import { InvalidAuthorizationTransitionError } from "../state-machine.js";

const DISPATCH_TRANSITIONS: Readonly<
  Partial<Record<AuthorizationState, readonly AuthorizationState[]>>
> = {
  AUTHORIZED: ["DISPATCHED"],
  DISPATCHED: ["EXECUTED"],
};

export class DispatchStateMachine {
  #state: AuthorizationState = "AUTHORIZED";

  get state(): AuthorizationState {
    return this.#state;
  }

  transition(to: AuthorizationState): void {
    const allowed = DISPATCH_TRANSITIONS[this.#state] ?? [];
    if (!allowed.includes(to)) {
      throw new InvalidAuthorizationTransitionError(this.#state, to);
    }
    this.#state = to;
  }
}
