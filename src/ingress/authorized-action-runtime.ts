import type { RobotAdapter } from "../dispatch/types.js";
import type { EvidenceRepository } from "../evidence/repository.js";
import {
  ActionAuthorizationService,
  type ActionAuthorizationResult,
} from "./action-authorization-service.js";
import {
  AuthorizationDispatchBridge,
  type AuthorizationDispatchBridgeResult,
} from "./authorization-dispatch-bridge.js";

export interface AuthorizedActionRuntimeResult {
  readonly authorization: ActionAuthorizationResult;
  readonly dispatch: AuthorizationDispatchBridgeResult;
}

export interface AuthorizedActionRuntimeOptions {
  readonly repository: EvidenceRepository;
  readonly adapter: RobotAdapter;
}

/**
 * Shared execution composition for simulator and physical targets. The target
 * is injected only at the final RobotAdapter boundary.
 */
export class AuthorizedActionRuntime {
  readonly #authorization: ActionAuthorizationService;
  readonly #dispatch: AuthorizationDispatchBridge;

  constructor(options: AuthorizedActionRuntimeOptions) {
    this.#authorization = new ActionAuthorizationService({ repository: options.repository });
    this.#dispatch = new AuthorizationDispatchBridge(options);
  }

  handle(request: unknown, context: unknown): AuthorizedActionRuntimeResult {
    const authorization = this.#authorization.authorize(request, context);
    return {
      authorization,
      dispatch: this.#dispatch.dispatch(authorization),
    };
  }
}
