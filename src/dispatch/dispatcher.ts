import type { AuthorizationGrant, ExecutionRecord } from "../domain.js";
import type { EvidenceRepository } from "../evidence/repository.js";
import { RobotAdapterExecutionError } from "../robot/simulated-robot-adapter.js";
import { DispatchStateMachine } from "./state-machine.js";
import type { NormalizedAction, RobotAdapter } from "./types.js";

export type DispatchResult =
  | {
      readonly outcome: "EXECUTED";
      readonly state: "EXECUTED";
      readonly executionRecord: ExecutionRecord;
    }
  | {
      readonly outcome: "REJECTED";
      readonly state: "REJECTED";
      readonly reason: string;
    }
  | {
      readonly outcome: "ADAPTER_FAILED";
      readonly state: "DISPATCHED";
      readonly reason: string;
      readonly executionRecord: ExecutionRecord;
    };

export class Dispatcher {
  readonly #repository: EvidenceRepository;
  readonly #adapter: RobotAdapter;

  constructor(
    repository: EvidenceRepository,
    adapter: RobotAdapter,
  ) {
    this.#repository = repository;
    this.#adapter = adapter;
  }

  dispatch(
    grant: AuthorizationGrant,
    action: NormalizedAction,
  ): DispatchResult {
    const consumption = this.#repository.consumeGrant(grant, action);
    if (!consumption.accepted) {
      return {
        outcome: "REJECTED",
        state: "REJECTED",
        reason: consumption.reason,
      };
    }

    const stateMachine = new DispatchStateMachine();
    stateMachine.transition("DISPATCHED");
    this.#repository.markDispatched(
      consumption.executionRecord.executionId,
    );

    let receipt;
    try {
      receipt = this.#adapter.execute(
        consumption.grant,
        consumption.action,
      );
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Robot adapter failed.";
      const adapterCallCount =
        error instanceof RobotAdapterExecutionError
          ? error.adapterCallCount
          : 1;
      const finalPosition =
        error instanceof RobotAdapterExecutionError
          ? error.finalPosition
          : "unknown";
      return {
        outcome: "ADAPTER_FAILED",
        state: "DISPATCHED",
        reason,
        executionRecord: this.#repository.markAdapterFailed(
          consumption.executionRecord.executionId,
          reason,
          adapterCallCount,
          finalPosition,
        ),
      };
    }

    stateMachine.transition("EXECUTED");
    return {
      outcome: "EXECUTED",
      state: "EXECUTED",
      executionRecord: this.#repository.markExecuted(
        consumption.executionRecord.executionId,
        receipt,
      ),
    };
  }
}
