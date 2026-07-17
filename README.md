# Constitutional Runtime

Constitutional Runtime is a new OpenAI Build Week product: a pre-execution authorization runtime for autonomous systems. Its purpose is to prevent an autonomous system from executing an unauthorized action and to require a durable evidence record before authorization completes.

The canonical demonstration follows a robot asked to deliver medication to Room 312. The robot remains stationary while patient identity is unresolved, the interface displays `UNAUTHORIZED` and the blocking reason, and execution becomes possible only after all required conditions are satisfied and the evidence transaction commits. A second scenario makes the evidence store unavailable; authorization then fails and the robot remains stationary even though every other condition is satisfied.

## Project status

Phase 1 implements and verifies the deterministic authorization kernel. It evaluates the medication-delivery conditions and stops at `READY_FOR_EVIDENCE`; it cannot authorize or dispatch an action. No user interface, evidence store, OpenAI API integration, deployment, or robot adapter has been implemented yet.

The inspected starting directory contained no application code, no valid Git history, and no reusable implementation. It contained only empty placeholder directories named `.git`, `.agents`, and `.codex`. The empty `.git` placeholder was not valid repository metadata and was replaced during Phase 0 by a valid Git repository.

See:

- [BUILD_WEEK.md](BUILD_WEEK.md) for provenance and event scope.
- [ARCHITECTURE.md](ARCHITECTURE.md) for the intended trust boundary and invariants.
- [DEMO.md](DEMO.md) for the canonical demonstration.

## Product boundary

Edos, TraceStack, and Edos-R are pre-existing concepts that may inform later design decisions. They are not the product created in this repository, are not present as integrations or reusable code, and no access to them is assumed.

Constitutional Runtime is the new Build Week product. Any future reuse or integration must be identified explicitly in `BUILD_WEEK.md`.

## Architectural invariants

1. Authorization precedes execution.
2. Authorization is incomplete until the evidence transaction commits successfully.
3. Unauthorized actions cannot reach the robot adapter.
4. Every authorized action references a durable evidence record.

## Development

Install dependencies and run the Phase 1 verification gates:

```sh
npm install
npm run build
npm test
```

There is no application run command in Phase 1.
