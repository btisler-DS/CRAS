# Architecture

## Concrete Robot HAT tone controller (Phase 5D-3B)

```text
ApprovedSpeech
  -> RobotHatToneAdapter.speak()
  -> RobotHatToneController
  -> fixed, bounded Python subprocess
  -> Music.play_tone_for()
```

The concrete controller implements exactly the five injected lifecycle operations:
record GPIO20, enable amplifier, play the bounded tone, disable amplifier, and restore
the recorded pin state. The adapter determines their order and owns cleanup policy.

The Python bridge has no caller-controlled executable, script, device, model path, or
shell command. Frequency and duration are validated in both the approved-speech
constructor and controller immediately before crossing the process boundary. The
playback script skips `Music.__init__()` so it cannot duplicate amplifier enable; it
invokes only the verified PyAudio method on an uninitialized instance.

Typed controller failures distinguish missing Python, missing Robot HAT library,
playback failure, timeout/cancellation, abnormal exit, amplifier failure, and invalid
or failed GPIO state. Construction performs no subprocess or hardware operation.

## Speech engine boundary (Phase 5D-3A)

Speech engines are injected behind two server-only contracts:

```text
bounded transient audio -> SpeechToTextAdapter -> TranscriptResult
ApprovedSpeech          -> TextToSpeechAdapter -> SpeechResult
```

`TranscriptResult` is provenance-bearing data, not authorization. Phase 5D-3A does
not route transcripts or connect them to the authorization kernel.

`ApprovedSpeech` carries a runtime-only opaque brand and is created through a bounded
server function. Browser JSON cannot satisfy this boundary by structural coincidence.
Engine names are selected from a closed server configuration union and never from a
request payload.

The provisional Robot HAT output adapter exposes only the canonical
`TextToSpeechAdapter.speak(ApprovedSpeech)` entry point and supports approved bounded
tones only. It records the
pre-call GPIO20 state, enables the amplifier, calls an injected controller whose
contract requires the verified PyAudio-backed `Music.play_tone_for()` implementation,
and always attempts amplifier disable followed by exact pin restoration. Playback has
a hard timeout. Any playback, disable, or restoration failure produces a failed result;
cleanup is reported complete only when both disable and restoration succeed.

The injected controller is deliberately not implemented by a browser route or local
shell executor in this phase. Production engine selection defaults to `disabled`.

## Observational vision transport (Phase 5C-4A)

The future vision proxy is separated from its connection mechanism:

```text
Browser (future)
  -> public CRAS observational API (future)
  -> VisionClient
  -> VisionTransport
  -> HttpVisionTransport (initial implementation)
  -> private vision worker (future)
```

`VisionClient` owns the worker API contract and response validation. It receives a
`VisionTransport`; it does not know whether the underlying HTTP endpoint is reached
through an SSH forward, a Unix-socket bridge, mTLS, or a local process. Route handlers
will depend only on `VisionClient` and therefore cannot contain SSH-specific behavior.

The initial production transport reads `ROBOT_VISION_BASE_URL` lazily on the server.
The intended development value, `http://127.0.0.1:19100`, may be backed by an
independently managed SSH local forward to a loopback-only worker. Tunnel creation,
credentials, and lifecycle remain outside this repository.

Transport controls include request and stream-connection timeouts, a stream
frame-idle timeout, bounded non-streaming responses, cancellation propagation, and
schema-safe errors without upstream stack traces. Replacing the transport must not
change the browser UI, public CRAS routes, route behavior, or worker contracts.

This boundary is observational only. Phase 5C-4A exposes no route and contains no
motor, steering, pan, tilt, GPIO, PWM, calibration, or arbitrary-execution operation.

## Status

This document defines the implemented trust boundary through Phase 4. Phase 1 evaluates through `READY_FOR_EVIDENCE`, Phase 2 atomically persists evidence and its grant, Phase 3 consumes a revalidated grant before invoking the canonical simulator, and Phase 4 presents those server-owned states in a local browser. External integrations remain unimplemented.

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

Phase 1 owns the progression through `READY_FOR_EVIDENCE`. Phase 2 owns `COMMITTING_EVIDENCE`, `AUTHORIZED`, and `EVIDENCE_COMMIT_FAILED`. Phase 3 owns the valid `AUTHORIZED -> DISPATCHED -> EXECUTED` progression and rejects lifecycle shortcuts.

## Evidence transaction and durability

Phase 2 uses `better-sqlite3` with WAL journaling, foreign keys enabled, and `synchronous=FULL`. Migrations create `evidence_records` and `authorization_grants`; Phase 3 adds `execution_records`. A composite foreign key binds each grant to the same evidence record, action ID, and action digest.

The exact transaction sequence is:

1. Begin the SQLite transaction.
2. Verify the decision and state are `READY_FOR_EVIDENCE`.
3. Transition to `COMMITTING_EVIDENCE` and insert the evidence record.
4. Insert the authorization grant referencing that evidence record.
5. Commit the transaction.
6. Only after the transaction API returns from commit, transition to and return `AUTHORIZED`.

An evidence or grant write error throws within the transaction, causing rollback. The state becomes `EVIDENCE_COMMIT_FAILED`, the result contains no grant, and there is no dispatch path.

Evidence records contain a SHA-256 hash of their canonical content and the previous committed record hash. The resulting chain is **tamper-evident, not tamper-proof**. It can reveal broken links or changed content when independently verified, but an attacker with sufficient database write access could rewrite records and recompute the chain. This phase does not claim independent notarization, append-only hardware, replication, or protection from host loss.

## Protected dispatch sequence

The dispatcher accepts a persisted `AuthorizationGrant` and branded `NormalizedAction`. It does not accept a raw `ActionProposal`. Within a SQLite transaction it:

1. Re-reads and verifies the persisted grant is `AUTHORIZED`, unconsumed, unrevoked, and unexpired.
2. Verifies the referenced evidence exists and matches the grant action ID and digest.
3. Digests the supplied exact normalized action and compares it with the grant and evidence.
4. Atomically updates the grant to `CONSUMED` with `consumed_at`.
5. Creates an `AUTHORIZED` execution record.
6. Commits.

Only after commit, the dispatcher records `DISPATCHED` and invokes the `RobotAdapter`. Successful simulator completion records `EXECUTED`, final position, call count, action ID, and grant ID.

### Adapter failure after consumption

Consumption is intentionally not rolled back after adapter invocation: the adapter may have received or partially executed the command. If the adapter throws, the grant remains `CONSUMED`, the lifecycle result remains `DISPATCHED`, and the execution record becomes `ADAPTER_FAILED` with the error, adapter call count, and last known position. It is never reported as undispatched or successfully executed. Replay is rejected; recovery requires reconciliation and a new authorization.

There is no public HTTP endpoint for the dispatcher or adapter.

## Browser application boundary

The Next.js application has one local route handler at `/api/runtime`. It accepts a strict, closed command union:

- `reset`
- `preset` with `blocked`, `successful`, or `evidence-failure`
- `set-condition` with a known condition ID and boolean value
- `commit-and-dispatch`

The route does not accept evidence, grants, authorization states, robot positions, raw dispatch commands, or adapter calls. Unsupported fields and commands are rejected. A server-side runtime session owns every mutable object and returns a read-only `RuntimeView` projection.

`GET /api/runtime?export=1` exports only the currently committed evidence record. It does not mutate runtime state.

The visible failure toggle resets the deterministic scenario with the existing `EvidenceRepository` failure mode set to `EVIDENCE_WRITE`. The failure therefore occurs inside the evidence transaction, not in client presentation state.

## Hardware independence

The browser-visible simulator will be the canonical adapter for the complete demonstration. Physical hardware, if later available, will be an optional adapter and cannot be required to verify the four invariants.

## Phase 5D-4 microphone boundary

The optional microphone path is `AlsaMicrophoneCaptureAdapter -> transient AudioInput -> VoskSpeechToTextAdapter -> TranscriptResult`. Imports and construction are passive. Capture uses a fixed server-side ALSA device, PCM format, duration, timeout, and byte ceiling; clients cannot select devices or executables. Vosk runs locally through a bounded process and requires a pre-provisioned model outside the repository. The transient byte buffer is overwritten after every recognition outcome.

A transcript is untrusted input. Phase 5D-4 does not route it, normalize it into an action, authorize it, persist it, dispatch it, or expose it to the browser. Missing model configuration fails closed with a typed error.

## Modality-independent intent boundary

Voice transcripts and typed text enter the same deterministic `ConversationIntentResolver`. It distinguishes action requests, status and information queries, clarification answers, cancellation, and ordinary conversation. The resolver returns only a destination and always declares `authority: NONE`.

Routing determines where input goes. It does not determine whether an action may occur. Only `action_request` is eligible to reach a future shared action normalizer; it still has to pass the existing authorization, evidence, and dispatch boundaries.

Phase 5D-7 implements that authorization-only connection for one deterministic command. The speech text cannot supply or override condition facts. The service stops after a committed, unconsumed grant and has no reference to the Dispatcher or any robot adapter.

Phase 5D-8 adds a typed authorization-to-dispatch bridge. It accepts no transcript or raw text. For an authorized result, it recovers the exact action from the committed evidence record and hands the grant and normalized action to the existing Dispatcher, which still performs atomic revalidation and consumption before invoking an adapter.

Phase 5D-9 makes adapter selection an explicit server-owned deployment choice. `simulator` is the default. `physical` requires a loopback transport and signing key loaded from a server file; selection is never accepted through a browser route. Changing adapters does not change the intent, authorization, evidence, or Dispatcher contracts.

Phase 5D-10 originally fixed the physical capability to the commissioning behavior
`MEDICATION_DELIVERY_DEMO_V1`. The active successor is
`MEDICATION_DELIVERY_ROUND_TRIP_V1`: one fixed minimum-speed outbound interval, full
stop, neutral pause, one fixed minimum-speed return interval, and final stop. The
behavior ID is HMAC-bound with the grant and exact action. The worker rejects every
other behavior and returns a receipt bound to the same ID. On the wheel-off-ground
stand this verifies controlled outbound/return actuation; it is not represented as
autonomous navigation to the physical Room 312.

Phase 5D-11 composes the shared request-to-execution path once. Simulator and physical execution use identical intent, authorization, evidence, grant-consumption, and Dispatcher objects; only the final injected `RobotAdapter` differs. Neither target has a parallel authorization or dispatch route.

## Competition-minimum physical deployment

The Next.js UI, deterministic authorization kernel, SQLite evidence repository, and Dispatcher remain on the CRAS server. `PhysicalRobotAdapter` receives only the branded validated grant and normalized action after atomic grant consumption. It signs a bounded dispatch envelope and sends it through a server-local loopback transport.

An independently supervised SSH forward connects that loopback port to the robot worker, which itself binds only to `127.0.0.1:9300`. The worker verifies the HMAC, freshness, exact canonical action, and durable replay record before constructing `Picarx`. Its only active action is the fixed minimum-speed outbound/stop/return/stop wheel-off-ground maneuver, with `stop()` in `finally` and on SIGTERM/SIGINT. There is no generic movement endpoint.

## Private robot acknowledgments

Audible acknowledgments are not an alternate action or authorization path. The
server-owned `RobotAcknowledgmentClient` signs one of four closed names and sends it
through a loopback-only transport to `/acknowledge`. The worker verifies the HMAC and
freshness, durably rejects event/nonce replay, serializes acknowledgment against
motion, and maps the name to robot-local fixed tone data. No frequency, duration,
device, filename, Python expression, or shell command crosses the boundary.

The robot-local child imports `robot_hat` only after explicit invocation, uses the
verified `Music.play_tone_for()` PyAudio backend, disables the amplifier in `finally`,
and restores GPIO20 to its verified idle function. The capability is disabled by
default. Attention and instruction-received acknowledgments do not imply authority;
they only confirm receipt. Automated tests inject transports and processes and never
touch audio or GPIO.

The interactive mission composes these boundaries in one server-owned order:

```text
alert -> ATTENTION acknowledgment
instruction -> INSTRUCTION_RECEIVED acknowledgment
conditions -> evidence + grant transaction
committed AUTHORIZED -> AUTHORIZED acknowledgment
Dispatcher -> selected RobotAdapter -> EXECUTED record
EXECUTED -> MISSION_COMPLETED acknowledgment
```

Acknowledgment receipt is not authority. In physical mode, failure to produce the
authorization acknowledgment conservatively prevents dispatch and leaves the grant
unconsumed. Adapter selection and acknowledgment enablement are server environment
choices, never browser payload fields. Simulator mode remains the default.

Simulator sessions intentionally use disposable deterministic SQLite databases so
presets reset cleanly. Physical UI sessions instead use the server-owned persistent
database configured by `CRAS_PHYSICAL_EVIDENCE_DB`; they use unique mission and record
identifiers and never delete that database during reset or shutdown. This distinction
prevents demonstration convenience from weakening physical evidence durability.
