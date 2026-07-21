# Constitutional Runtime — Build Week implementation report

**Report date:** July 21, 2026 (UTC)

**Repository:** <https://github.com/btisler-DS/CRAS>

**Product:** Constitutional Runtime (CRAS)

**Status:** software demonstration complete; protected physical commissioning complete;
full Pharmacy → Room 312 → Home ground mission not yet verified

## Executive result

CRAS was built from an empty starting directory into a working evidence-before-execution
authorization runtime. Its deterministic browser simulator demonstrates the complete
competition story: unresolved conditions block execution, successful evidence commit
creates an authorization grant, a protected dispatcher executes exactly once, and an
evidence-store outage denies authorization and produces no movement opportunity.

The same authorization, evidence, grant-consumption, and Dispatcher path was extended
to a SunFounder PiCar-X through a private authenticated worker. On hardware, the team
verified camera observation, microphone recognition, audible acknowledgments, and one
evidence-backed, single-use wheel-off-ground dispatch. Ground navigation experiments
provided useful sensor evidence, but the complete medication-delivery route did not
execute successfully. This report does not represent mapping diagnostics, simulator
animation, or stand movement as autonomous navigation.

The central architectural claim was achieved:

> The robot has capability, but no intrinsic authority. Authorization comes from the
> governed organizational process and is incomplete until its evidence is durable.

## Starting state

The inspected directory contained:

- no application code;
- no valid Git history;
- no reusable implementation; and
- only empty placeholder directories named `.git`, `.agents`, and `.codex`.

Phase 0 replaced the invalid `.git` placeholder with a valid repository and created
the initial Build Week record. Edos, Edos-R, and TraceStack are pre-existing concepts
and intellectual lineage. They were not copied, integrated, or assumed to be available.
CRAS is the new product built in this repository.

## What was built

### Constitutional runtime

- Typed action proposals, required conditions, condition results, decisions, grants,
  and authorization states.
- An explicit, reject-by-default lifecycle from `RECEIVED` through `EXECUTED`, including
  `BLOCKED`, `READY_FOR_EVIDENCE`, and `EVIDENCE_COMMIT_FAILED`.
- Four medication-delivery conditions: patient identity verified, physician order
  active, medication matched, and administration window valid.
- A Phase 1 kernel ceiling at `READY_FOR_EVIDENCE`; the kernel cannot manufacture a grant.
- Strict parsing boundaries so model-generated or untyped input cannot directly satisfy
  required conditions.

### Durable evidence and authorization

- SQLite persistence using WAL mode, foreign keys, and `synchronous=FULL`.
- Atomic creation of an evidence record and its authorization grant.
- SHA-256 action binding and a hash chain across evidence records.
- Durable, exportable JSON evidence.
- Persistence-boundary failure injection proving evidence and grant writes roll back
  together.
- A documented limitation: the chain is tamper-evident, not tamper-proof.

### Protected dispatch

- Grant validation against status, expiration, revocation, consumption, evidence
  existence, action ID, and action digest.
- Atomic single-use consumption before adapter invocation.
- A `RobotAdapter` interface that accepts only a validated grant plus the exact normalized
  action—not a raw proposal, transcript, or browser command.
- Durable execution records for `AUTHORIZED`, `DISPATCHED`, `EXECUTED`, and
  `ADAPTER_FAILED` outcomes.
- Honest post-consumption failure semantics: if an adapter fails after dispatch, the
  grant remains consumed and the action is not falsely reported as undispatched.

### Canonical simulator and browser demonstration

- A deterministic medication-delivery simulator beginning at Pharmacy and ending at
  Room 312 only after protected dispatch.
- A Next.js browser application with blocked, successful, and evidence-outage presets.
- Visible separation of authorization, evidence, and execution state.
- Condition controls, blocking reasons, evidence/grant details, event timeline, JSON
  export, adapter call count, reset, and robot/floor-map presentation.
- Browser-level coverage of the complete four-scene demonstration.
- An observation-only live video panel whose routes cannot command actuators.

### Speech and ingress boundaries

- Engine-independent speech-to-text and text-to-speech contracts.
- A local Vosk microphone adapter with bounded capture, typed failures, and no retained
  audio.
- A Robot HAT tone adapter using the verified SunFounder PyAudio
  `Music.play_tone_for()` path, with timeout and amplifier/GPIO cleanup.
- A modality-independent intent resolver. Intent resolution routes requests; it never
  authorizes them.
- A single typed request-to-authorization-to-dispatch composition. Speech text and
  transcripts never reach an adapter directly.

### Physical robot boundary

- A server-owned adapter selection: simulator by default, physical only through explicit
  server configuration.
- A loopback-only, HMAC-authenticated robot worker with freshness checks and durable
  replay rejection.
- Four closed audible acknowledgment names; callers cannot select tones, files, devices,
  code, or shell commands.
- A private observation-only OV5647 camera worker and transport abstraction.
- Typed QR observations and server-side condition-resolution support.
- A server-owned prepared hospital record fixture for patient, order, medication, and
  administration-window evidence. Browser input cannot alter those facts.
- A fixed `MEDICATION_DELIVERY_MISSION_V1` implementation that is hardware-passive on
  import, uses bounded controls, consumes only a protected dispatch, writes robot-local
  mission events, and stops/centers in cleanup. This controller is hardware-free tested
  but has not completed the physical ground route.
- Printable marker, floorplan, and scenario assets, including large navigation markers
  for Pharmacy, Room 312, and Home.

## Architectural invariants and result

| Invariant | Result | Evidence |
| --- | --- | --- |
| Authorization precedes execution | PASS | Blocked and ready states produce zero adapter calls; Dispatcher receives only a committed grant. |
| Evidence commit is required before authorization completes | PASS | Evidence and grant are one SQLite transaction; injected evidence/grant failures roll back and return no grant. |
| Unauthorized actions cannot reach the robot adapter | PASS | Typed adapter boundary, strict server routes, failure-path tests, and recent physical attempts with unresolved observations produced no dispatch or movement. |
| Every authorized action references durable evidence | PASS | Grant foreign-key/action-digest binding, restart tests, JSON export, and persisted physical commissioning evidence. |

These results establish the authorization architecture. They do not establish general
autonomous navigation.

## Work performed and observed results

### Results that worked

#### Software and simulator

- The deterministic kernel blocks every missing required condition and stops at
  `READY_FOR_EVIDENCE` when all are satisfied.
- Evidence/grant commits are atomic and survive repository restart.
- Evidence outage fails closed with no grant and no adapter opportunity.
- A valid grant is consumed once; replay, expiration, revocation, mismatch, or missing
  evidence cannot invoke the adapter.
- The complete browser simulator demonstrates blocked, ready, authorized/executed, and
  evidence-failure scenes without hardware.
- The private workers and adapters are passive on import and automated tests do not
  access audio, camera, GPIO, motors, or servos.

#### Operator-observed physical results

- PiCar-X hardware, software, power cutoff, and wheel-off-ground safety posture were
  identified and commissioned in controlled stages.
- `Picarx()` initialized successfully after documented first-run provisioning. No drive
  motor or steering motion occurred; camera tilt made one brief expected positioning
  movement; `stop()` succeeded; 30-second stability passed.
- Steering, camera pan, camera tilt, both rear wheels together, and each rear wheel
  independently completed repeated characterization. Reverse drive remained deferred
  during that characterization and was not classified as a failure.
- The OV5647 camera was detected and completed a stable five-second capture, still
  capture, and browser-proxied 640×480 stream. The live view had noticeable latency but
  was usable.
- One bounded Vosk microphone verification recognized “deliver medication to room three
  twelve” with reported confidence `0.9453375`.
- The Robot HAT PyAudio speaker path was verified. The operator heard the expected
  attention (one short), instruction-received (two short), authorized (one long), and
  mission-completed (three short) patterns with no actuator movement.
- One protected wheel-off-ground dispatch committed durable evidence, consumed exactly
  one grant, invoked the adapter exactly once, ran forward and backward, stopped, and
  returned an `EXECUTED` receipt. This proved the protected physical boundary, not route
  navigation.
- One bounded one-second ground line diagnostic completed with 42 sensor samples,
  remained aligned, and stopped successfully.

### Results that did not work

#### Mapping and navigation

- The generic environment-mapping approach did not complete. In its second iteration,
  an ultrasonic value of `-1` was treated as clear space, the robot contacted a wall,
  and the operator stopped it. That mapper must not be represented or reused as proven
  autonomous navigation.
- Repeated grayscale line-following segments did not complete the route. The robot
  diverted right onto the blue boundary after several segments. On the one-inch black
  route, all three downward sensors frequently reported “black,” so the controller
  could not reliably distinguish center-line alignment, a perpendicular branch, and
  blue boundary tape.
- Small QR markers were not decoded at the required route distance. High-resolution
  still capture and passive OpenCV/pyzbar enhancement also returned no usable location
  observation at that distance.
- The larger printable Pharmacy, Room 312, and Home markers and the new camera/grayscale
  fusion mission were created in response, but they have not been physically verified
  as a complete route.

#### Mission workflow

- A card-based condition-capture attempt was operationally invalid: the operator was
  asked to present several cards without an explicit per-card capture cue or positive
  capture confirmation. No reliable observation set could result. This was a workflow
  design error, not operator error.
- Three recent physical mission attempts remained `UNAUTHORIZED` because required
  observation evidence was unresolved. They produced no evidence record, no grant, no
  adapter call, and no movement. This was correct fail-closed runtime behavior, but the
  physical mission itself failed to start.
- The complete Pharmacy → Room 312 → Home medication-delivery cycle has not been
  demonstrated on the ground.
- Wrong-patient, wrong-medication, and evidence-outage immobility are complete in the
  simulator but have not been recorded as full physical ground scenarios.

#### Integration and presentation

- The first physical browser integration run used a temporary simulator database and
  was correctly rejected as official durable evidence. Physical UI mode was then moved
  to an explicit persistent database and restart-tested.
- During development, a hot-reloaded server retained an older in-memory runtime-session
  instance and returned a missing-method error for the new prepared-record control.
  Restarting the server corrected the class-loading mismatch; unit coverage exists, but
  the complete live physical UI flow still needs final rehearsal.
- The competition video, final submission form, and reproducibility run on a second
  robot are not complete.

## Why the failed approaches were stopped

The project initially treated navigation as a sequence of narrow sensor tests. That
was insufficient for the required end-to-end outcome. The key correction was to keep
organizational authorization separate from robot-local behavior:

```text
organizational request and evidence
  -> CRAS authorization and durable grant
  -> protected dispatch of one fixed mission behavior
  -> robot-local observation and bounded navigation
```

CRAS should govern whether the mission may occur; it should not pretend that a policy
condition is a steering command. Conversely, robot navigation may observe route markers
and control a bounded behavior, but it may not create its own grant or bypass CRAS.

## Current reproducible demonstrations

### Canonical, complete, no-hardware demonstration

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and use the blocked, successful, and evidence-failure
presets. This is the complete reproducible demonstration of all four invariants.

### Protected physical boundary

The repository includes provisioning and commissioning documentation for the PiCar-X,
the private vision and robot workers, server-only transports, printable marker assets,
and gated verification commands. Physical execution requires an independently secured
robot, explicit server configuration, a local signing key, loopback transports, and an
operator at the power cutoff. No browser route exposes raw movement.

The new ground-mission controller is an implementation candidate, not a verified
reproduction claim. A second team should first print and mount the large navigation
markers, prove passive detection at route distance, and commission one bounded segment
at a time before authorizing the full route.

## Current limitations and claims boundary

CRAS can presently claim:

- a complete, tested evidence-before-execution runtime and browser simulator;
- durable, exportable, action-bound authorization evidence;
- a protected, authenticated, single-use physical dispatch path;
- physically verified audio, camera, microphone, actuator commissioning, and one
  wheel-off-ground evidence-backed action; and
- correct physical immobility when required evidence is unresolved.

CRAS must not presently claim:

- completed autonomous Pharmacy → Room 312 → Home navigation;
- a general-purpose hospital navigation stack;
- reliable route-distance QR localization with the original small markers;
- physical completion of the wrong-patient, wrong-medication, or evidence-outage
  ground scenarios;
- integration with the Edos, Edos-R, or TraceStack implementations; or
- that GPT or any language model grants authority. The shipped kernel is deterministic.

## Remaining shortest path to the intended physical video

1. Print and mount the 6.5-inch Pharmacy, Room 312, and Home navigation markers.
2. Verify each marker passively through the live camera at its actual approach distance.
3. Rehearse the server-owned prepared hospital record through the browser and confirm
   `READY_FOR_EVIDENCE` before any physical dispatch.
4. Commission `MEDICATION_DELIVERY_MISSION_V1` on the course with an operator at the
   cutoff, beginning with one route segment and retaining its robot-local mission log.
5. Run the full authorized Pharmacy → Room 312 → Home cycle once the bounded segments
   pass.
6. Record the evidence-outage case and at least one wrong-patient or wrong-medication
   case, confirming zero dispatch and zero motion.
7. Export the evidence JSON, capture the UI timeline and live camera, record the
   three-minute video, and complete the Build Week submission.

## Verification record

Final verification on July 21 produced:

- `npm run typecheck`: PASS;
- `npm test`: PASS — 20 files, 138 tests;
- `npm run test:robot-worker`: PASS — 4 tests;
- `npm run test:vision-worker`: PASS — 8 tests;
- `npm run test:environment-mapper`: PASS — 7 tests;
- `npm run test:line-follow`: PASS — 5 tests;
- `npm run test:physical-mission`: PASS — 7 tests;
- `npm run build`: PASS — optimized Next.js production build;
- `npm run test:browser`: PASS — 7 Chromium tests; and
- `git diff --check`: PASS.

This is 169 passing hardware-free unit/integration tests plus 7 passing browser tests.
The mapping and navigation test results verify deterministic code behavior with injected
boundaries; they do not override the failed physical experiments reported above.

## Conclusion

Build Week produced a technically credible constitutional authorization runtime and a
real protected robot boundary. The evidence-before-authorization and
authorization-before-execution claims are supported by deterministic tests, durable
records, browser behavior, and bounded hardware commissioning. The remaining gap is
not authorization; it is reliable ground localization and navigation. Until that gap
is closed, the simulator is the canonical complete product demonstration and the
physical robot is an honest, partially commissioned embodiment of the same protected
execution architecture.
