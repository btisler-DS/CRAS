import type {
  NormalizedAction,
  RobotAdapter,
  RobotExecutionReceipt,
  ValidatedAuthorizationGrant,
} from "../dispatch/types.js";

export type RobotPosition = "pharmacy" | "Room 312";
export type RobotMovementState =
  | "STATIONARY"
  | "MOVING"
  | "ARRIVED"
  | "FAILED";

export class RobotAdapterExecutionError extends Error {
  constructor(
    message: string,
    readonly adapterCallCount: number,
    readonly finalPosition: string,
  ) {
    super(message);
    this.name = "RobotAdapterExecutionError";
  }
}

export interface SimulatedRobotOptions {
  readonly failOnExecute?: boolean;
}

/** Canonical deterministic simulator. It has no network or hardware surface. */
export class SimulatedRobotAdapter implements RobotAdapter {
  #position: RobotPosition = "pharmacy";
  #movementState: RobotMovementState = "STATIONARY";
  #dispatchCount = 0;
  #executedActionId: string | null = null;
  #grantId: string | null = null;
  readonly #failOnExecute: boolean;

  constructor(options: SimulatedRobotOptions = {}) {
    this.#failOnExecute = options.failOnExecute ?? false;
  }

  get snapshot(): Readonly<{
    position: RobotPosition;
    movementState: RobotMovementState;
    dispatchCount: number;
    executedActionId: string | null;
    grantId: string | null;
  }> {
    return {
      position: this.#position,
      movementState: this.#movementState,
      dispatchCount: this.#dispatchCount,
      executedActionId: this.#executedActionId,
      grantId: this.#grantId,
    };
  }

  execute(
    grant: ValidatedAuthorizationGrant,
    action: NormalizedAction,
  ): RobotExecutionReceipt {
    this.#dispatchCount += 1;
    this.#grantId = grant.grantId;
    this.#executedActionId = action.actionId;
    this.#movementState = "MOVING";

    if (this.#failOnExecute) {
      this.#movementState = "FAILED";
      throw new RobotAdapterExecutionError(
        "Simulated robot adapter failed after dispatch.",
        this.#dispatchCount,
        this.#position,
      );
    }

    if (
      action.kind !== "MEDICATION_DELIVERY" ||
      action.destination !== "Room 312"
    ) {
      this.#movementState = "FAILED";
      throw new RobotAdapterExecutionError(
        "Simulator accepts only medication delivery to Room 312.",
        this.#dispatchCount,
        this.#position,
      );
    }

    this.#position = "Room 312";
    this.#movementState = "ARRIVED";
    return {
      finalPosition: this.#position,
      adapterCallCount: this.#dispatchCount,
    };
  }
}
