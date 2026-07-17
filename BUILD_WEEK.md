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

## Not yet implemented

- Application or UI framework.
- Evidence transaction or durable evidence store.
- Authorization-grant creation or evidence-backed authorization mechanism.
- Robot adapter, simulator, or physical hardware integration.
- User interface.
- OpenAI API integration or natural-language parser.
- CI, deployment, telemetry, authentication, or production security controls.

Phase 1 tests verify deterministic evaluation and the boundary at `READY_FOR_EVIDENCE`. Documentation describing evidence commit, authorization, dispatch, execution, UI, and integrations remains a future design rather than implemented behavior.

## Future provenance rule

Any imported code, copied configuration, external asset, or integration derived from a pre-existing system must be recorded here with its source, license or permission basis, date introduced, and the exact role it plays in Constitutional Runtime.
