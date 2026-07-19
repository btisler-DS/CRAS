# Repository Guidance

## Product identity

This repository contains Constitutional Runtime, the new Build Week product. Edos, TraceStack, and Edos-R are pre-existing concepts only; do not imply that their code, services, credentials, data, or hardware are available.

## Current phase

Phase 5D-11 proves simulator and physical targets use one shared authorization/evidence/Dispatcher composition and differ only at the final injected adapter. Do not create a target-specific bypass. Until a later phase is explicitly authorized:

- Do not create authorization grants outside the evidence repository transaction.
- Do not add OpenAI, deployment, or physical robot integrations.
- Do not expose dispatch or the robot adapter through HTTP.
- Do not add a physical robot adapter; the deterministic simulator is canonical.
- Do not add a vision worker, camera access, vision proxy route, or Robot Status page.
- Do not add speech routing, intent resolution, browser speech behavior, or audible automated tests.
- Do not run `verify:vosk-microphone` without explicit physical-test authorization.
- Do not run `verify:physical-dispatch` unless the operator has explicitly confirmed every driven wheel is off the ground and immediate power cutoff is available.
- Never download a speech model during application startup or commit a model to Git.
- Keep speech engines disabled by default; Robot HAT output requires an explicitly injected controller.
- Do not run `verify:robot-hat-tone` without explicit physical-test authorization.
- Keep `ROBOT_VISION_BASE_URL` server-only and all tunnel credentials and lifecycle outside this repository.
- Make vision route handlers depend on `VisionClient`; never put SSH, socket, robot-address, or direct `fetch` logic in a route.
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
- Keep all mutable runtime state and transitions server-side; clients may send only the closed command union documented in `ARCHITECTURE.md`.
- Do not duplicate policy, evidence, grant, dispatch, or simulator logic in React components.
- Keep the complete demonstration operable without developer tools or physical hardware.
- Document any reused code, assets, or external integration in `BUILD_WEEK.md` before merging it.
- Do not commit secrets, patient data, generated evidence databases, or evidence exports.

## Verification expectations

Each implementation phase must add tests proportionate to its claims. In particular, blocked and evidence-failure paths must prove zero robot-adapter calls. Documentation must distinguish intended behavior from behavior verified by tests.

Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:browser` after UI or server-handler changes.
