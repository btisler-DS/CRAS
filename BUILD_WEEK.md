# Build Week Record

## Product

**Working name:** Constitutional Runtime

**Definition:** A pre-execution authorization runtime for autonomous systems. It prevents a robot from executing an unauthorized action and requires a durable evidence record to be committed before authorization completes.

## Inspected starting state

The repository workspace was inspected on July 17, 2026, before product files were created.

Observed facts:

- There was no application code.
- There was no valid Git history.
- There was no reusable implementation.
- There were no documentation files, dependency manifests, lockfiles, tests, or CI configuration.
- The workspace contained only empty placeholder directories: `.git`, `.agents`, and `.codex`.
- The `.git` placeholder was an empty, read-only environment mount and did not contain valid Git metadata.

The starting state is therefore classified as empty, not partially initialized.

## Provenance boundary

### Pre-existing concepts

- Edos
- TraceStack
- Edos-R

These concepts predate this Build Week project and may inform its design. This repository does not currently contain their code, integrations, credentials, data, or documentation. No access to Edos, TraceStack, Edos-R, or a physical robot is claimed or assumed.

### New Build Week product

Constitutional Runtime is the product being created during the event. Work committed to this repository after its documented empty starting state belongs to this project unless a later entry explicitly identifies reused material and its provenance.

## Work completed during Phase 0

- Replaced the invalid empty `.git` placeholder with valid Git metadata.
- Initialized the repository with `main` as its initial branch.
- Established product, architecture, demonstration, and contributor documentation.
- Defined the authorization and evidence invariants.
- Documented the canonical success and evidence-outage scenarios.

## Work completed during Phase 1

- Initialized a minimal, framework-free TypeScript project.
- Defined typed domain objects for action proposals, required conditions, condition results, authorization decisions, authorization grants, and authorization states.
- Implemented strict runtime validation for untrusted action proposals and medication-delivery facts.
- Implemented deterministic evaluation of patient identity, physician order, medication match, and administration window conditions.
- Implemented an explicit Phase 1 state machine that rejects invalid transitions.
- Enforced `READY_FOR_EVIDENCE` as the furthest successful Phase 1 state; no code constructs an authorization grant or dispatches an action.
- Added automated verification for blocked decisions, every required condition, complete condition reporting, the evidence boundary, zero dispatch calls, invalid transitions, and untrusted/model-style input rejection.

### Phase 1 verification

Verified on July 17, 2026:

- `npm run build`: passed (`tsc --noEmit`).
- `npm test`: passed with 1 test file and 12 tests.
- Vitest result: 1 file passed, 12 tests passed, 0 failures.
- No UI, SQLite evidence store, OpenAI integration, deployment, or physical robot integration was added.

## Work completed during Phase 2

- Added `better-sqlite3` persistence and SQL migrations for `evidence_records` and `authorization_grants`.
- Configured SQLite for WAL journaling, foreign keys, and `synchronous=FULL`.
- Added a separate evidence-authorization state machine without changing the Phase 1 kernel or its `READY_FOR_EVIDENCE` ceiling.
- Implemented one atomic transaction that verifies readiness, creates evidence, creates the bound grant, commits, and only then returns `AUTHORIZED`.
- Added repository-boundary failure injection for evidence and grant writes; both paths roll back and return `EVIDENCE_COMMIT_FAILED` with no grant.
- Added canonical action digests, a SHA-256 evidence hash chain, restart persistence, record lookup, and JSON evidence export.
- Added a composite foreign key binding each grant to its evidence record, action ID, and action digest.

The evidence hash chain is tamper-evident, not tamper-proof. It does not provide independent notarization or prevent a sufficiently privileged party from rewriting and rehashing the database.

### Phase 2 verification

Verified on July 18, 2026:

- `npm run build`: passed (`tsc --noEmit`).
- `npm test`: passed with 2 test files and 22 tests.
- Vitest result: 2 files passed, 22 tests passed, 0 failures.
- Tests cover SQLite configuration, committed evidence/grant binding, shared action digests, evidence-write rollback, grant-write rollback, no grant or dispatch opportunity after rollback, failure state, successful authorization, restart persistence, JSON export, and a two-record hash-chain link.
- No UI, simulator, OpenAI integration, deployment, or physical robot integration was added.

## Work completed during Phase 3

- Added a protected dispatcher and a `RobotAdapter` interface whose execution method accepts only branded `ValidatedAuthorizationGrant` and `NormalizedAction` values.
- Added atomic grant revalidation and single-use consumption with an execution record created in the same transaction.
- Added checks for authorization status, evidence existence, action ID and digest binding, exact normalized action, expiry, revocation, and prior consumption.
- Added an execution lifecycle state machine for `AUTHORIZED -> DISPATCHED -> EXECUTED` with invalid-transition rejection.
- Added the deterministic `SimulatedRobotAdapter`, starting at `pharmacy` and moving to `Room 312` only after valid dispatch.
- Added persistent execution outcomes, adapter call count, final position, executed action ID, and grant ID.
- Added explicit post-consumption adapter-failure behavior: the grant remains consumed, the result is `DISPATCHED`, and the execution record is `ADAPTER_FAILED`; it is never reported as undispatched or successfully executed.
- Added a local CLI demonstration for blocked, successful, and repository-failure scenarios.
- Added no HTTP endpoint, browser UI, OpenAI integration, deployment, or physical robot adapter.

### Phase 3 verification

Verified on July 18, 2026:

- `npm run build`: passed (`tsc --noEmit`).
- `npm test`: passed with 3 test files and 37 tests.
- Vitest result: 3 files passed, 37 tests passed, 0 failures.
- `npm run demo`: passed; blocked and evidence-failure scenarios made 0 adapter calls and remained at `pharmacy`, while the successful scenario made exactly 1 call and ended at `Room 312`.
- Tests cover blocked, pre-evidence, and evidence-failure immobility; valid execution; replay; expiry; revocation; action mismatch; missing/corrupt evidence binding; typed raw-action exclusion; restart persistence; repeated dispatch; lifecycle validation; and adapter failure.

## Not yet implemented

- Application or UI framework.
- Physical robot adapter or hardware integration.
- User interface.
- OpenAI API integration or natural-language parser.
- CI, deployment, telemetry, authentication, or production security controls.

Phase 1 tests verify deterministic evaluation and the boundary at `READY_FOR_EVIDENCE`. Phase 2 tests verify local SQLite evidence-backed authorization. Dispatch, execution, UI, and integrations remain future work.

## Future provenance rule

Any imported code, copied configuration, external asset, or integration derived from a pre-existing system must be recorded here with its source, license or permission basis, date introduced, and the exact role it plays in Constitutional Runtime.
