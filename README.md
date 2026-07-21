# Constitutional Runtime

> Current physical status (July 21): typed QR observation and server-side condition
> resolution are implemented and tested. A bounded ground commissioning diagnostic
> decoded `LOC-HOME` after one stopped 500 ms approach increment. That diagnostic was
> not a CRAS-authorized mission; the protected Pharmacy → Room 312 → Home route remains
> uncommissioned and is not claimed as complete navigation.

> **Competition continuation:** Start with [HANDOFF.md](HANDOFF.md). It distinguishes
> verified implementation from pending ground navigation and records the deadline,
> testbed, safety protocol, and recommended completion order. Track final gates in
> [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md).

## Gated Robot HAT tone verification

Phase 5D-3B includes a concrete local controller for the verified SunFounder PyAudio
tone path. It remains disabled by default and the hardware verification is never part
of the automated test suite.

After separate physical authorization, run on the Robot HAT host from this repository:

```bash
sudo -n env CRAS_ENABLE_ROBOT_HAT_TONE_TEST=I_UNDERSTAND_THIS_PLAYS_AUDIO \
  npm run verify:robot-hat-tone
```

This command produces one approved 440 Hz tone with a requested duration of one second
through `RobotHatToneAdapter`. Do not run it on an unsecured robot or without an
operator at the power cutoff.

## Speech adapter status

The repository now contains server-only STT/TTS interfaces, a bounded Vosk microphone
path, deterministic intent routing, and a passive Robot HAT tone boundary based on
the verified SunFounder PyAudio path. Speech and physical acknowledgment capabilities
remain disabled by default. There is no conversational loop, browser audio, or network
speech engine.

## Observation-only vision transport

The server-only vision transport, robot-local OV5647 worker, proxy routes, and browser
video panel are implemented. The camera worker is passive until the operator starts
the stream, exposes no actuator operations, and releases camera ownership when the
stream stops or its sole downstream viewer disconnects.

The server reads `ROBOT_VISION_BASE_URL`. The example value is a local endpoint supplied
by separately managed transport infrastructure. Robot addresses, SSH credentials, and
tunnel lifecycle must not be placed in browser code or committed configuration.

Constitutional Runtime is a new OpenAI Build Week product: a pre-execution authorization runtime for autonomous systems. Its purpose is to prevent an autonomous system from executing an unauthorized action and to require a durable evidence record before authorization completes.

The canonical demonstration follows a robot asked to deliver medication to Room 312. The robot remains stationary while patient identity is unresolved, the interface displays `UNAUTHORIZED` and the blocking reason, and execution becomes possible only after all required conditions are satisfied and the evidence transaction commits. A second scenario makes the evidence store unavailable; authorization then fails and the robot remains stationary even though every other condition is satisfied.

## Project status

The complete local browser demonstration runs over the deterministic kernel, SQLite
evidence repository, Dispatcher, and canonical simulator. A separately deployed,
loopback-only physical worker and server-side physical adapter have also completed a
wheel-off-ground protected dispatch. The browser cannot address either adapter or the
robot worker directly, and the simulator remains the no-hardware fallback. No OpenAI
API integration or autonomous navigation has been implemented.

SQLite is configured with WAL journaling, foreign keys enabled, and `synchronous=FULL`. Evidence records form a SHA-256 hash chain and can be exported as JSON. This chain is **tamper-evident, not tamper-proof**: modification can break detectable links, but a party able to rewrite the database may also be able to recompute the chain.

The inspected starting directory contained no application code, no valid Git history, and no reusable implementation. It contained only empty placeholder directories named `.git`, `.agents`, and `.codex`. The empty `.git` placeholder was not valid repository metadata and was replaced during Phase 0 by a valid Git repository.

See:

- [BUILD_WEEK.md](BUILD_WEEK.md) for provenance and event scope.
- [ARCHITECTURE.md](ARCHITECTURE.md) for the intended trust boundary and invariants.
- [DEMO.md](DEMO.md) for the canonical demonstration.
- [demo-assets/markers/README.md](demo-assets/markers/README.md) for the printable
  hospital location, patient, medication, order, staff, and docking marker kit.
- [demo-assets/floorplans/README.md](demo-assets/floorplans/README.md) for the proposed
  ten-room placement plan and eight printable success/failure scenario maps.

## License

CRAS source code is available under the
[PolyForm Noncommercial License 1.0.0](LICENSE). Documentation, diagrams,
screenshots, and original demonstration media are available under the
[Creative Commons Attribution-NonCommercial 4.0 International license](LICENSE-DOCS).
See [NOTICE](NOTICE) for the required attribution and scope. Third-party
components retain their original license terms.

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

The main screen includes an observation-only robot video panel. When
`ROBOT_VISION_BASE_URL` points at the independently supervised loopback forward, the
operator may start or stop the OV5647 MJPEG stream. The browser talks only to CRAS;
the camera worker exposes no actuator commands and receives no browser-selected robot
address.

The deployed reference path uses robot loopback port `9400` and server loopback port
`19100`. Camera capture is stopped explicitly by the UI and is also released when the
sole downstream stream disconnects.

For a supervised physical stand demonstration, the server process—not the browser—may
be configured with:

```sh
CRAS_ROBOT_ADAPTER=physical \
CRAS_ROBOT_ACKNOWLEDGMENTS=physical \
CRAS_PHYSICAL_WORKER_BASE_URL=http://127.0.0.1:19300 \
CRAS_ROBOT_SIGNING_KEY_FILE=.runtime/dispatch.key \
CRAS_PHYSICAL_EVIDENCE_DB=.runtime/physical-ui-evidence.db \
npm run dev
```

This mode requires the independently supervised loopback forward and a secured robot
with an operator at the cutoff. It admits only the fixed round-trip behavior through
the evidence-backed Dispatcher. Do not expose this unauthenticated local demonstration
server to an untrusted network.

Robot-local acknowledgments are an optional private capability. With
`CRAS_ROBOT_ACKNOWLEDGMENTS=physical`, the server sends only four fixed, signed names
to the loopback worker: attention, instruction received, authorized, and mission
completed. Callers cannot select frequency, duration, device, file, or command.
Attention and instruction receipt are currently connected to the live mission flow;
the latter two remain reserved until that flow owns physical execution state.

The single active protected hardware behavior is
`MEDICATION_DELIVERY_ROUND_TRIP_V1`. It is a fixed minimum-speed
outbound/stop/return/stop stand maneuver and accepts no caller-selected motion
parameters. It is verified by deterministic tests and one separately authorized
wheel-off-ground physical dispatch. This stand maneuver does not yet constitute
autonomous navigation to a physical Room 312.

### Optional local speech recognition artifact

Phase 5D-4 adds a server-only, disabled-by-default Vosk adapter. It requires the explicitly provisioned model directory configured by `CRAS_VOSK_MODEL_PATH`; the application does not download models. Microphone capture is bounded to at most three seconds from `hw:CARD=Device,DEV=0`, is held only in memory, and is zeroed after transcription. This phase adds no speech routing, authorization, UI, or robot action.

## Dispatch safety

The public `RobotAdapter` interface accepts only a branded, validated authorization grant and the branded exact normalized action. Grant revalidation, consumption, and initial execution-record creation occur in one SQLite transaction. Only after commit does the dispatcher call the simulator.

If consumption commits but the adapter subsequently fails, the grant remains consumed and cannot be replayed. The execution is recorded as `ADAPTER_FAILED`, while the dispatch result remains `DISPATCHED` rather than falsely claiming the action was never dispatched or executed successfully. Manual reconciliation is required before any new authorization attempt.
