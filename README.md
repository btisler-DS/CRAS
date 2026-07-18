# Constitutional Runtime

Constitutional Runtime is a new OpenAI Build Week product: a pre-execution authorization runtime for autonomous systems. Its purpose is to prevent an autonomous system from executing an unauthorized action and to require a durable evidence record before authorization completes.

The canonical demonstration follows a robot asked to deliver medication to Room 312. The robot remains stationary while patient identity is unresolved, the interface displays `UNAUTHORIZED` and the blocking reason, and execution becomes possible only after all required conditions are satisfied and the evidence transaction commits. A second scenario makes the evidence store unavailable; authorization then fails and the robot remains stationary even though every other condition is satisfied.

## Project status

Phase 4 adds the complete local browser demonstration over the unchanged Phase 1–3 runtime. A Next.js server owns the deterministic session, SQLite repository, dispatcher, and simulator; the React client sends only preset, condition, reset, and commit intents and receives a read-only view. No OpenAI API integration, deployment, HTTP dispatch endpoint, or physical robot adapter has been implemented.

SQLite is configured with WAL journaling, foreign keys enabled, and `synchronous=FULL`. Evidence records form a SHA-256 hash chain and can be exported as JSON. This chain is **tamper-evident, not tamper-proof**: modification can break detectable links, but a party able to rewrite the database may also be able to recompute the chain.

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

Install dependencies and run the Phase 4 verification gates:

```sh
npm install
npm run typecheck
npm run build
npm test
npm run test:browser
npm run demo
```

Start the complete browser demonstration with one command:

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app creates temporary SQLite databases and resets to a deterministic blocked scenario. The separate CLI demo remains available with `npm run demo`.

## Dispatch safety

The public `RobotAdapter` interface accepts only a branded, validated authorization grant and the branded exact normalized action. Grant revalidation, consumption, and initial execution-record creation occur in one SQLite transaction. Only after commit does the dispatcher call the simulator.

If consumption commits but the adapter subsequently fails, the grant remains consumed and cannot be replayed. The execution is recorded as `ADAPTER_FAILED`, while the dispatch result remains `DISPATCHED` rather than falsely claiming the action was never dispatched or executed successfully. Manual reconciliation is required before any new authorization attempt.
