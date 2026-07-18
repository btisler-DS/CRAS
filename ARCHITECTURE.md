# Architecture

## Status

This document defines the intended architecture and trust boundary. Phase 2 implements the deterministic policy kernel through `READY_FOR_EVIDENCE` and a separate SQLite transaction that atomically persists evidence and its authorization grant. Dispatch, execution, UI, and external integrations remain unimplemented.

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

## Decision progression

The eventual implementation is expected to make state transitions explicit, for example:

```text
RECEIVED -> EVALUATING -> BLOCKED
                       -> READY_FOR_EVIDENCE -> COMMITTING_EVIDENCE -> AUTHORIZED -> DISPATCHED -> EXECUTED
                                                                  -> EVIDENCE_COMMIT_FAILED
```

Phase 1 owns the progression through `READY_FOR_EVIDENCE`. Phase 2 owns `COMMITTING_EVIDENCE`, `AUTHORIZED`, and `EVIDENCE_COMMIT_FAILED`. Dispatch and execution transitions remain future work.

## Evidence transaction and durability

Phase 2 uses `better-sqlite3` with WAL journaling, foreign keys enabled, and `synchronous=FULL`. Two migrations create `evidence_records` and `authorization_grants`. A composite foreign key binds each grant to the same evidence record, action ID, and action digest.

The exact transaction sequence is:

1. Begin the SQLite transaction.
2. Verify the decision and state are `READY_FOR_EVIDENCE`.
3. Transition to `COMMITTING_EVIDENCE` and insert the evidence record.
4. Insert the authorization grant referencing that evidence record.
5. Commit the transaction.
6. Only after the transaction API returns from commit, transition to and return `AUTHORIZED`.

An evidence or grant write error throws within the transaction, causing rollback. The state becomes `EVIDENCE_COMMIT_FAILED`, the result contains no grant, and there is no dispatch path.

Evidence records contain a SHA-256 hash of their canonical content and the previous committed record hash. The resulting chain is **tamper-evident, not tamper-proof**. It can reveal broken links or changed content when independently verified, but an attacker with sufficient database write access could rewrite records and recompute the chain. This phase does not claim independent notarization, append-only hardware, replication, or protection from host loss.

## Hardware independence

The browser-visible simulator will be the canonical adapter for the complete demonstration. Physical hardware, if later available, will be an optional adapter and cannot be required to verify the four invariants.
