# Architecture

## Status

This document defines the intended architecture and trust boundary. Phase 1 implements only the deterministic policy kernel and its state machine through `READY_FOR_EVIDENCE`. Evidence persistence, authorization, dispatch, execution, UI, and integrations remain unimplemented.

## Safety objective

Constitutional Runtime sits between an action proposal and an execution adapter. Its responsibility is to ensure that no action is dispatched unless policy conditions pass and the corresponding evidence transaction has committed durably.

```text
instruction
    |
    v
action proposal
    |
    v
deterministic policy evaluation
    | blocked
    +--------------------> UNAUTHORIZED (no adapter call)
    |
    v
evidence transaction
    | commit failed
    +--------------------> UNAUTHORIZED (no adapter call)
    |
    v
authorization grant referencing committed evidence
    |
    v
robot adapter
```

## Invariants

### 1. Authorization precedes execution

An action must receive authorization before dispatch begins. Execution state cannot be used retroactively as proof of authorization.

### 2. Evidence commit is required before authorization completes

Passing policy evaluation is necessary but insufficient. The runtime must not emit an authorization grant until the evidence transaction reports a successful durable commit. A timeout, unavailable store, rejected write, or ambiguous commit result must fail closed.

### 3. Unauthorized actions cannot reach the robot adapter

The adapter boundary must accept only a valid authorization grant bound to the exact action, not raw instructions or untrusted action proposals. Blocked and evidence-failure paths must produce no adapter invocation.

### 4. Every authorized action references a durable evidence record

Every authorization grant must carry a stable reference to its committed evidence record. The record must be retrievable and exportable after authorization and across a runtime restart under the eventual durability model.

## Intended components

- **Instruction intake:** accepts a human instruction or a predefined scenario.
- **Action normalization:** produces a typed action proposal. If an AI model is later used here, its output remains untrusted.
- **Policy evaluator:** deterministically evaluates required conditions.
- **Evidence repository:** atomically persists the decision context and authorization reference.
- **Authorization runtime:** owns state transitions and emits a grant only after commit.
- **Dispatch boundary:** validates and consumes a grant before invoking an adapter.
- **Robot adapter:** drives a simulator by default and may later support hardware.
- **Demonstration UI:** displays policy state, blocking reasons, evidence state, events, and simulated motion.

## Trust boundary

The authorization runtime, deterministic policy rules, evidence transaction, and dispatch boundary form the trusted path. The instruction source, any AI interpretation, the browser UI, and robot action proposals are not authorization authorities.

Edos, TraceStack, and Edos-R are pre-existing concepts, not implemented components of this repository. Any future connection to them is optional and must not weaken fail-closed behavior.

## Planned decision progression

The eventual implementation is expected to make state transitions explicit, for example:

```text
RECEIVED -> EVALUATING -> BLOCKED
                       -> COMMITTING_EVIDENCE -> AUTHORIZED -> DISPATCHED -> EXECUTED
                                             -> EVIDENCE_COMMIT_FAILED
```

Exact states and recovery semantics remain implementation work.

## Evidence durability

The storage technology and durability guarantee have not yet been selected or implemented. Later architecture work must define what constitutes a successful commit, how ambiguous outcomes are handled, how records are exported, and what persistence guarantees survive process or host failure. Phase 0 makes no claim of production-grade immutability, replication, or external notarization.

## Hardware independence

The browser-visible simulator will be the canonical adapter for the complete demonstration. Physical hardware, if later available, will be an optional adapter and cannot be required to verify the four invariants.
