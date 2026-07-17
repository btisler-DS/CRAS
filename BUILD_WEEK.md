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

## Not yet implemented

- Application framework or package manifest.
- Authorization engine or policy evaluator.
- Evidence transaction or durable evidence store.
- Authorization-grant mechanism.
- Robot adapter, simulator, or physical hardware integration.
- User interface.
- OpenAI API integration or natural-language parser.
- Tests, CI, deployment, telemetry, authentication, or production security controls.

Documentation in this phase describes intended behavior; it is not evidence that the runtime exists or that an invariant has been technically enforced.

## Future provenance rule

Any imported code, copied configuration, external asset, or integration derived from a pre-existing system must be recorded here with its source, license or permission basis, date introduced, and the exact role it plays in Constitutional Runtime.
