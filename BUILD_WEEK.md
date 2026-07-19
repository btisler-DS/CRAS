# Build Week Record

## Phase 5D-3B — concrete Robot HAT tone controller

Phase 5D-3B implements the concrete, robot-local subprocess bridge behind the existing
`RobotHatToneController` injection contract. `RobotHatToneAdapter.speak(ApprovedSpeech)`
remains the sole public text-to-speech execution boundary.

The controller is passive on import and construction. Contract calls use fixed
argument-vector subprocesses with `shell: false`, bounded output, hard timeouts, and
typed failures. Tone playback independently revalidates frequency and duration, then
calls the verified PyAudio-backed `Music.play_tone_for()` method. It deliberately uses
`Music.__new__(Music)` rather than `Music()` because the adapter separately owns the
GPIO20 enable/disable lifecycle.

An explicitly gated hardware verification script was added but was not executed. It
constructs an approved 440 Hz/one-second tone and enters only through
`RobotHatToneAdapter.speak()`.

## Phase 5D-3A — audio adapter contracts

Phase 5D-3A implements server-only, engine-independent speech adapter contracts. It
does not implement microphone capture, speech recognition, browser audio, intent
routing, physical motion, or an audio network worker.

Built during this phase:

- `SpeechToTextAdapter.transcribe(AudioInput) -> TranscriptResult`;
- `TextToSpeechAdapter.speak(ApprovedSpeech) -> SpeechResult`;
- opaque, bounded `AudioInput` and `ApprovedSpeech` construction boundaries;
- deterministic test STT and TTS adapters that access no hardware or network;
- `RobotHatToneAdapter`, which accepts only approved bounded tones and delegates
  playback to an injected controller constrained to the verified
  `Music.play_tone_for()` path;
- a single public Robot HAT execution entry point: `speak(ApprovedSpeech)`;
- hard Robot HAT tone timeout and ordered amplifier-disable/pin-restoration cleanup;
- explicit failure when cleanup or restoration is incomplete;
- server-only allow-listed adapter selection, disabled by default.

No concrete Robot HAT controller is instantiated or selected in this phase. Automated
tests use an inert controller and cannot import Robot HAT Python, open audio, or change
GPIO state.

Verification on 2026-07-19:

- `npm run typecheck`: passed;
- `npm test`: 57 passed across 5 files.

## Phase 5C-4A — vision transport foundation

Phase 5C-4A adds the server-side, implementation-independent communication boundary
for the future observational vision feature. It does not add the robot-local worker,
camera access, proxy routes, browser UI, actuator commands, or a physical robot
adapter.

Built during this phase:

- `VisionTransport`, the dependency used by the typed `VisionClient`;
- `HttpVisionTransport`, with bounded JSON responses, request and stream-connection
  timeouts, frame-idle detection, and downstream cancellation propagation;
- strict Zod contracts for worker health, stream state, still capture, telemetry, and
  structured errors;
- lazy, server-only resolution of `ROBOT_VISION_BASE_URL`;
- in-memory transport tests, allowing client verification without a robot or network;
- tests for response limits, stream cancellation, frame-idle timeout, contract
  rejection, and safe error serialization.

SSH is an operational way to forward the initial HTTP endpoint, not a dependency of
the application architecture. No SSH implementation, credential, robot address, or
tunnel lifecycle is present in the source.

Verification on 2026-07-18:

- `npm run typecheck`: passed;
- `npm test`: 45 passed across 4 files;
- `npm run build`: passed;
- `npm run test:browser`: 6 passed.

The existing Phase 4 simulator remains the canonical complete demonstration.

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

## Work completed during Phase 4

- Added a local Next.js 16 and React 19 full-stack application with a polished high-contrast browser demonstration.
- Added a server-owned deterministic runtime session using the existing authorization kernel, evidence repository, dispatcher, and simulator APIs.
- Added one strict command route for reset, presets, condition changes, and commit-and-dispatch; it exposes no raw dispatch or robot-adapter command.
- Added distinct authorization, evidence, and execution status displays; condition controls; blocking reasons; evidence and grant records; JSON export; floor-map animation; event timeline; adapter call count; reset; and three scenario presets.
- Connected the visible evidence-failure control to the existing repository-boundary `EVIDENCE_WRITE` injection.
- Added browser tests for all four scenes, deterministic reset, committed JSON export equality, and rejected dispatch bypass.
- Added no OpenAI integration, physical robot integration, deployment configuration, or public robot endpoint.

### Phase 4 verification

Verified on July 18, 2026:

- `npm run typecheck`: passed (`tsc --noEmit`).
- `npm test`: passed with 3 test files and all existing 37 tests.
- `npm run build`: passed with Next.js 16.2.10 production compilation.
- `npm run test:browser`: passed with 6 Chromium tests and 0 failures.
- Visual browser verification: meaningful content rendered, 0 Next.js error overlays, and all six primary buttons were present.
- Production dependency audit: 0 known vulnerabilities after pinning patched PostCSS 8.5.19 through a package override.

## Not yet implemented

- Physical robot adapter or hardware integration.
- OpenAI API integration or natural-language parser.
- CI, deployment, telemetry, authentication, or production security controls.

## Work completed during Phase 5D-4

- Provisioned one deployment artifact, `vosk-model-small-en-us-0.15`, outside Git at `/opt/cras-runtime/models/vosk-model-small-en-us-0.15` on the robot host.
- Source: `https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip`; version `0.15`; archive size `41,205,931` bytes; installed size `70,898,967` bytes; SHA-256 `30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498`.
- Added a passive Vosk `SpeechToTextAdapter`, a bounded explicit-device ALSA microphone adapter, typed configuration and runtime failures, transient-buffer deletion, and a separately gated one-utterance verifier.
- Vosk remains disabled by default. Startup refuses a configured missing model, and application startup never downloads models.
- No microphone was accessed during automated verification. Early robot-host checks returned `unintelligible` because the spoken cue preceded SSH/capture readiness. The deployed bridge now uses an explicit no-capture operator-ready handshake, reports non-retaining signal metrics, and locally resamples the USB device's 48 kHz PCM to Vosk's 16 kHz input. The synchronized verification recognized `deliver medication to room three twelve` at `0.9453375` confidence (peak `-10.78 dBFS`, RMS `-27.24 dBFS`) and erased both audio buffers.

## Competition-minimum robot deployment

- Added and deployed bounded Python microphone and speaker bridges; no Node or application repository is installed on the robot.
- Added a loopback-only, authenticated, replay-protected physical worker and a server-side `PhysicalRobotAdapter` that preserves the validated-grant boundary.
- Added supervised robot-worker and SSH-forward services, health checks, fixed action admission, motor `finally` cleanup, and SIGTERM/SIGINT emergency stopping.
- The CRAS server retains the UI, authorization kernel, evidence store, and Dispatcher.
- The physical dispatch verifier is explicitly gated by wheel-off-ground confirmation. No physical dispatch had occurred when this record was written.
- The first authorized physical verification failed closed after local grant consumption: the worker returned `401 invalid_signature`, created no replay record, and admitted no motor action. Root cause was a trailing newline in the server-side text key while the worker used the trimmed key. The verifier now normalizes the provisioned text key; no retry was performed without renewed authorization.
- A separately authorized retry passed authentication and durable replay admission but failed before motor commands when the Robot HAT GPIO backend attempted to create `//.lgd-nfy0` inside the hardened service. The worker returned `500`, the local execution record accurately became `ADAPTER_FAILED`, and the remote grant replay record remained consumed. The service now supplies `/var/lib/cras-robot` as its writable working directory and home; no automatic retry occurs.
- Subsequent commissioning exposed SunFounder's `Picarx()` dependency on `os.getlogin()`, which is unavailable in a system service. A robot-local fixed-action child now resolves only the actual service UID as a compatibility fallback; vendor source remains unchanged. The child is bounded, receives no caller-controlled command, and stops on completion, error, timeout, SIGTERM, and SIGINT.
- The protected physical path then completed successfully: evidence `3fcbb08c-af28-43d0-98b0-197e52b497a1`, grant `56ce94f8-91e2-4e79-82d4-0b322a9f761b`, one authenticated worker call, durable remote replay consumption, and local execution state `EXECUTED` with no lingering motion process. The operator confirmed both raised rear wheels moved for approximately one second and then fully stopped.

## Work completed during Phase 5D-5

- Added a passive `SpeechPipeline` that composes one injected `MicrophoneCaptureAdapter` with one injected `SpeechToTextAdapter` and returns only an untrusted `TranscriptResult`.
- Capture failure prevents transcription, cancellation before invocation prevents microphone access, and construction performs no hardware operation.
- The pipeline has no dependency on intent resolution, authorization, evidence, dispatch, robot adapters, browser state, or persistence.

## Work completed during Phase 5D-6

- Added a shared deterministic `ConversationIntentResolver` for voice and typed input.
- It classifies `action_request`, `status_request`, `information_request`, `clarification`, `cancel`, and ordinary `conversation`, then returns a typed destination.
- Every result declares `authority: NONE`. Intent resolution routes input; it never authorizes, creates grants, commits evidence, dispatches, or executes.
- Clarification answers require explicit pending-clarification context, and unknown or conversational text does not fall through to the action normalizer.
- Added the voice composition boundary from `SpeechPipeline` to the shared resolver. Incomplete, empty, timed-out, and low-confidence transcripts remain unresolved and are not routed.

## Work completed during Phase 5D-7

- Added an authorization-only ingress service. It re-resolves strict voice or typed input, deterministically admits only the canonical medication-delivery command, evaluates separately supplied typed condition facts, and uses the existing atomic evidence transaction.
- Blocked, non-action, unsupported, and evidence-failure outcomes return no grant. A satisfied request returns an unconsumed `AUTHORIZED` grant referencing its committed evidence record.
- The service has no Dispatcher or robot-adapter dependency; Phase 5D-7 cannot execute an action.

## Work completed during Phase 5D-8

- Added a narrow bridge whose only input is the typed Phase 5D-7 authorization result.
- Only `AUTHORIZED` results reach the existing Dispatcher. The exact normalized action is recovered from the committed evidence record; transcripts, raw text, and intent objects are not accepted by the bridge.
- Blocked and other non-authorized results make zero adapter calls. Grant replay remains rejected, and tests use only an in-memory robot spy.
- No browser route or physical-hardware selection was added.

## Work completed during Phase 5D-9

- Formalized server-only robot-adapter selection around the existing `RobotAdapter` interface.
- The simulator remains the default and canonical selection. Physical selection requires an explicit environment mode, loopback worker URL, and signing-key file; missing or unknown configuration fails closed with typed errors.
- Physical construction is passive and still accepts execution only through `ValidatedAuthorizationGrant + NormalizedAction`. Tests inject an inert transport and perform no hardware operation.
- Browser input cannot select an adapter, worker address, transport, signing key, or physical mode.

## Work completed during Phase 5D-10

- Formalized the single physical behavior as `MEDICATION_DELIVERY_DEMO_V1`: both rear wheels at minimum speed `1` for 1,000 ms on the wheel-off-ground stand, followed by `stop()` in `finally`.
- Added the behavior ID to the authenticated dispatch envelope and required the robot worker to reject unknown behavior IDs. Successful receipts must bind to the same behavior ID and final-position marker.
- Added a commissioning record distinguishing this fixed demonstration maneuver from real navigation to Room 312.
- No second behavior, reverse motion, steering, navigation, or ground movement was added.
- A separately authorized repeatability run completed with evidence `59289496-f525-4627-a1e9-99ada4d6ad82` and grant `803f377d-cb87-4cc1-9517-2fe16aae7eca`. The worker recorded one call and returned to passive health with no motion child; the operator confirmed both raised rear wheels again moved for approximately one second and fully stopped.

## Work completed during Phase 5D-11

- Added one shared `AuthorizedActionRuntime` composition for request resolution, deterministic authorization, evidence commit, grant creation, atomic Dispatcher consumption, and adapter invocation.
- Simulator and physical targets differ only at the injected `RobotAdapter` boundary. Matrix tests run the same request and condition context through both targets and prove equivalent authorization and execution progression.
- The blocked matrix proves zero simulator calls, zero physical-transport calls, zero evidence records, and zero grants for both targets.
- Physical alignment tests inject an inert transport; no hardware command occurs.

Phase 1 tests verify deterministic evaluation and the boundary at `READY_FOR_EVIDENCE`. Phase 2 tests verify local SQLite evidence-backed authorization. Phase 3 tests verify protected dispatch and simulation. Phase 4 browser tests verify the complete local demonstration. External integrations remain future work.

## Future provenance rule

Any imported code, copied configuration, external asset, or integration derived from a pre-existing system must be recorded here with its source, license or permission basis, date introduced, and the exact role it plays in Constitutional Runtime.
