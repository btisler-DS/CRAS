import { Dispatcher, type DispatchResult } from "../dispatch/dispatcher.js";
import { normalizeAction } from "../dispatch/normalized-action.js";
import type { RobotAdapter } from "../dispatch/types.js";
import type { EvidenceRepository } from "../evidence/repository.js";
import type { ActionAuthorizationResult } from "./action-authorization-service.js";

export type AuthorizationDispatchBridgeResult =
  | DispatchResult
  | { readonly outcome: "NOT_AUTHORIZED"; readonly state: "REJECTED"; readonly reason: string };

export interface AuthorizationDispatchBridgeOptions {
  readonly repository: EvidenceRepository;
  readonly adapter: RobotAdapter;
}

/**
 * Phase 5D-8 bridge. Its sole input is the typed authorization result; it has
 * no transcript, text, intent-resolver, or normalization-input surface.
 */
export class AuthorizationDispatchBridge {
  readonly #dispatcher: Dispatcher;

  constructor(options: AuthorizationDispatchBridgeOptions) {
    this.#dispatcher = new Dispatcher(options.repository, options.adapter);
  }

  dispatch(result: ActionAuthorizationResult): AuthorizationDispatchBridgeResult {
    if (result.state !== "AUTHORIZED") {
      return {
        outcome: "NOT_AUTHORIZED",
        state: "REJECTED",
        reason: `Authorization result is ${result.state}.`,
      };
    }
    const action = normalizeAction(result.evidenceRecord.normalizedAction);
    return this.#dispatcher.dispatch(result.grant, action);
  }
}
