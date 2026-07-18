# Repository Guidance

## Product identity

This repository contains Constitutional Runtime, the new Build Week product. Edos, TraceStack, and Edos-R are pre-existing concepts only; do not imply that their code, services, credentials, data, or hardware are available.

## Current phase

Phase 3 implements the protected dispatch boundary, atomic grant consumption, execution records, and canonical simulator. Until a later phase is explicitly authorized:

- Do not build a UI or initialize an application framework.
- Do not create authorization grants outside the evidence repository transaction.
- Do not add OpenAI, deployment, or physical robot integrations.
- Do not expose dispatch or the robot adapter through HTTP.
- Do not add a physical robot adapter; the deterministic simulator is canonical.
- Do not claim that later-phase proposed behavior has been implemented or verified.

## Non-negotiable invariants

All future designs, code, and tests must preserve these rules:

1. Authorization precedes execution.
2. Authorization is incomplete until the evidence transaction commits successfully.
3. Unauthorized actions cannot reach the robot adapter.
4. Every authorized action references a durable evidence record.

Fail closed on missing conditions, storage errors, timeouts, and ambiguous commit results.

## Architecture rules for future phases

- Keep authorization deterministic and server-side.
- Treat natural-language instructions and any AI-produced structure as untrusted proposals.
- Never let an AI model, browser UI, or raw instruction invoke the robot adapter directly.
- Make the simulator the canonical demonstration adapter; hardware must remain optional.
- Inject the evidence-outage scenario at the repository boundary, not only in presentation state.
- Preserve the Phase 1 kernel ceiling at `READY_FOR_EVIDENCE`; evidence-backed authorization belongs to the separate Phase 2 transaction.
- Treat the local SHA-256 evidence chain as tamper-evident, not tamper-proof.
- Pass only `ValidatedAuthorizationGrant` and `NormalizedAction` across the robot-adapter boundary.
- Consume a grant atomically before adapter invocation; consumed grants are single-use even when the adapter fails.
- Record post-consumption adapter failures as dispatched failures, never as undispatched or executed successes.
- Document any reused code, assets, or external integration in `BUILD_WEEK.md` before merging it.
- Do not commit secrets, patient data, generated evidence databases, or evidence exports.

## Verification expectations

Each implementation phase must add tests proportionate to its claims. In particular, blocked and evidence-failure paths must prove zero robot-adapter calls. Documentation must distinguish intended behavior from behavior verified by tests.
