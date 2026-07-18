import type { ActionProposal, AuthorizationGrant } from "../domain.js";

declare const normalizedActionBrand: unique symbol;
declare const validatedGrantBrand: unique symbol;

/** A strictly parsed and canonically digestible action, not a raw proposal. */
export type NormalizedAction = Readonly<ActionProposal> & {
  readonly [normalizedActionBrand]: true;
};

/** An authorized grant snapshot validated and atomically consumed in SQLite. */
export type ValidatedAuthorizationGrant = Readonly<
  Omit<AuthorizationGrant, "status" | "consumedAt" | "revokedAt"> & {
    readonly status: "AUTHORIZED";
    readonly consumedAt: null;
    readonly revokedAt: null;
    readonly [validatedGrantBrand]: true;
  }
>;

export interface RobotExecutionReceipt {
  readonly finalPosition: string;
  readonly adapterCallCount: number;
}

export interface RobotAdapter {
  execute(
    grant: ValidatedAuthorizationGrant,
    action: NormalizedAction,
  ): RobotExecutionReceipt;
}
