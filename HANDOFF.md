# CRAS competition handoff

**Prepared:** July 20, 2026 (UTC)

**Repository:** <https://github.com/btisler-DS/CRAS>

**Branch:** `main`

**Last pushed commit before this handoff:** `9f86a05`

This is the authoritative starting document for the next coding agent. Read it in full
before changing code, deploying to the robot, or describing the project publicly.

## 1. The project in one sentence

Constitutional Runtime (CRAS) is an evidence-before-execution authorization runtime
that prevents an autonomous system from reaching its actuator adapter until required
organizational conditions are resolved and a durable evidence/grant transaction has
committed.

The memorable competition claim is:

> The organization—not the robot—is the system being governed.

The robot is a replaceable participant with no intrinsic authority. It may propose,
observe, acknowledge, and execute a validated grant. It may not grant itself permission.

## 2. Product and research provenance

- **New Build Week product:** Constitutional Runtime and all implementation in this repository.
- **Pre-existing intellectual lineage:** Edos, Edos-R, TraceStack, and Bruce Tisler's
  published work on inquiry, governance, and the minimal necessary requirements of a
  state of affairs.
- CRAS borrows principles and architectural DNA. It does **not** contain or require
  the large Edos-R project, Edos services, TraceStack, their credentials, or their code.
- Do not market the submission as “Edos-R implemented.” Describe CRAS as a small,
  independently runnable Build Week product informed by that research lineage.
- The founder story matters: Bruce is a philosopher and domain author, not a career
  programmer. GPT-5.6 Codex converted a long-developed theory into a tested embodied
  system during Build Week. This is evidence of the market Codex opens to expert
  creators outside traditional software engineering.

External research/context files are intentionally outside the public implementation
repository and currently available on the mounted Windows share:

- `/mnt/windows-share/CRAS/distributed_cras_architecture_2026-07-20.md`
- `/mnt/windows-share/CRAS/conversation_record_distributed_cras_edos_organiza_2026-07-19.md`
- `/mnt/windows-share/CRAS/Edos-R_Architecture_White_Paper_Draft.pdf`
- `/mnt/windows-share/CRAS/Edos-R_Architecture_White_Paper_Draft.docx`

Use them for conceptual context, not as evidence that their systems are integrated.

## 3. Non-negotiable architecture

1. Authorization precedes execution.
2. Authorization is incomplete until the evidence transaction commits successfully.
3. Unauthorized actions cannot reach the robot adapter.
4. Every authorized action references a durable evidence record.

```text
Untrusted request
  -> deterministic intent/request normalization
  -> authorization kernel (ceiling: READY_FOR_EVIDENCE)
  -> one SQLite evidence + grant transaction
  -> AUTHORIZED grant
  -> atomic single-use grant consumption
  -> Dispatcher
  -> ValidatedAuthorizationGrant + exact NormalizedAction
  -> PhysicalRobotAdapter
  -> authenticated private transport
  -> loopback-only robot worker
  -> one allow-listed physical behavior
  -> PiCar-X library / Robot HAT / hardware
```

Never introduce a browser-to-robot path, raw text-to-adapter path, transcript-to-motor
path, generic movement endpoint, or UI-only imitation of authorization.

The simulator and physical target keep the same kernel, evidence repository, grant,
consumption, and Dispatcher path. They differ only at the final injected `RobotAdapter`.

## 4. What is implemented and verified

### Authorization, evidence, and dispatch

- Typed medication-delivery proposal and four required conditions: patient identity,
  physician order, medication match, and administration window.
- Explicit state machines and invalid-transition rejection.
- Kernel ceiling at `READY_FOR_EVIDENCE`; the kernel cannot manufacture a grant.
- Atomic SQLite evidence/grant creation with WAL, foreign keys, and `synchronous=FULL`.
- Repository failure injection rolls back both rows and creates no grant.
- SHA-256 hash chain and JSON export. It is tamper-evident, not tamper-proof.
- Atomic grant revalidation/consumption before adapter invocation.
- Replay, expiry, revocation, digest mismatch, missing evidence, and corrupt binding fail closed.
- Post-consumption adapter failures are recorded `ADAPTER_FAILED`, never misreported.

### Browser and simulator

- Next.js 16 / React 19 full-stack application; server owns mutable transitions.
- Complete blocked, ready, success, and evidence-store-failure simulator scenes.
- Evidence/grant viewer, export, timeline, adapter count, and deterministic floor map.
- Live mission interaction: alert, acknowledge, instruct, resolve, commit, dispatch, complete.
- Observation-only OV5647 video through a CRAS proxy. Browser never receives the robot address.
- Camera is passive and releases ownership on stop or downstream disconnect.

### Speech and acknowledgments

- Bounded local Vosk STT; transient audio is erased.
- Model: `/opt/cras-runtime/models/vosk-model-small-en-us-0.15` on the robot.
- Verified phrase `deliver medication to room three twelve`, confidence `0.9453375`.
- Fixed private acknowledgment patterns physically verified with no actuator movement:
  attention (one short), instruction received (two short), authorized (one long), and
  mission completed (three short).
- Speech and intent routing have `authority: NONE`; speech may request but never authorize.

### Physical robot and camera

- Private worker: robot loopback `9300`, server forward `127.0.0.1:19300`.
- Vision worker: robot loopback `9400`, server forward `127.0.0.1:19100`.
- HMAC authentication, freshness/replay protection, bounded child, signal cleanup,
  and `finally` stop.
- Active behavior: `MEDICATION_DELIVERY_ROUND_TRIP_V1`.
- Physically verified on a wheel-off-ground stand: minimum-speed forward 1 s, full
  stop, neutral 500 ms, reverse 1 s, final stop, exactly one authenticated adapter call.
- OV5647 camera index 0, native 2592x1944; five-second and still captures passed;
  live 640x480 MJPEG works with expected latency.

## 5. What is explicitly not complete

The robot has **not** navigated the taped hospital floor on the ground. The only motion
claim currently supported is the commissioned wheel-off-ground fixed behavior.

Not implemented or not yet verified:

- ground locomotion in the 10 ft x 5 ft testbed;
- marker detection from the robot camera;
- route localization, turning, doorway entry, or reverse docking;
- QR-derived condition resolution or image/face recognition;
- a physical pharmacy -> Room 312 -> home mission;
- physical evidence-outage immobility on the ground;
- competition video, Devpost submission, and `/feedback` session ID.

Do not describe simulator animation or stand commissioning as navigation to Room 312.

## 6. Physical testbed

Operator-provided facts:

- Overall taped rectangle: 10 ft x 5 ft.
- Robot footprint: 9.5 in long x 5.5 in wide.
- Blue tape: walls, room boundaries, hallway, and outside boundary.
- Red tape: doorways.
- Ten doorways: eight are 16 in; two utility doorways are 12 in.
- Rooms approximately 12–14 in deep are utility rooms.
- One utility room is home/charging; the robot must reverse into it.
- Four patient rooms will contain bed and fictional-patient identifiers.
- Photos: `/mnt/windows-share/CRAS/photos/`.

Proposed doorway identities: pharmacy, home, nurse station, supply, lab, clean utility,
and Rooms 311–314. Confirm physical assignment with Bruce before fixing coordinates.

Nominal centered clearance is 5.25 in per side through a 16 in opening and 3.25 in
per side through a 12 in opening. This is not proof that steering/docking will succeed.

Before navigation, record one coordinate system: clear hallway width, tape reference
edges, every doorway center/width, room depth, home approach length, marker height and
facing, and the robot's measured turning radius at the chosen steering/speed.

## 7. Marker and fictional-face kit

The handoff checkpoint adds a reproducible kit under `demo-assets/markers/`:

- 40 QR Model 2 markers, ECC H, four-module quiet zone;
- ten locations, eight beds, eight fictional patients, eight medications, two staff,
  two orders, and two docking markers;
- eight deterministic fictional face drawings on a separate sheet;
- deliberate similar/duplicate patient, medication, order, and staff mismatches.

Canonical set: `STAFF-NURSE-7001`, `ORDER-8001`, `MED-2001`, `LOC-ROOM-312`,
`BED-312-A`, `PAT-1001`, `DOCK-HOME-APPROACH`, `DOCK-HOME-FINAL`.

A QR observation is evidence input, not authorization. A face is narrative context,
not biometric proof. Print PDFs are in the marker directory. Regenerate with
`npm run markers:generate`.

## 8. Deployment topology

The CRAS server keeps the Next.js UI, authorization kernel, SQLite authority store,
grant validation/consumption, Dispatcher, and server transports.

Robot SSH target previously used: `edos@192.168.68.120` with key authentication.
Robot-local artifacts live under `/opt/cras-robot`; runtime state under
`/var/lib/cras-robot`; the Vosk model under `/opt/cras-runtime/models/`.

The robot intentionally does not need Node or the full repository. Do not move the
authority store or signing authority to the robot for convenience. Do not bind private
workers to `0.0.0.0`. Do not assume services are active; check before each session.

## 9. Physical safety protocol

No agent has standing authorization to move hardware. Every run needs new, explicit
operator confirmation for the exact bounded behavior.

1. Inspect the exact code path first.
2. Start wheel-off-ground unless the phase explicitly authorizes ground motion.
3. Operator beside the Robot HAT whole-robot OFF switch.
4. Battery disconnect immediately accessible.
5. Clear the motion envelope.
6. Verify tunnel/worker health read-only.
7. Use a new evidence record and grant; never replay a consumed grant.
8. Stop on unexpected motion, binding, noise, acceleration, transport ambiguity,
   loss of visibility, or failure to stop.
9. Record operator observation separately from the software receipt.

Never run physical dispatch, microphone capture, or tone verification without the
relevant explicit authorization and preconditions.

## 10. Competition requirements and deadline

Verified from OpenAI and Devpost on July 20, 2026:

- Deadline: **July 21, 2026 at 5:00 PM PDT** (July 22 00:00 UTC).
- Working project built with Codex using GPT-5.6.
- Category; recommended **Work & Productivity** for governed hospital operations.
- Project description.
- Public YouTube video **under three minutes**, showing the project working, with audio
  explaining Codex and GPT-5.6 use.
- Repository URL with licensing, setup, sample data, and clear run guidance.
- Explain where Codex accelerated work and where key decisions were made.
- `/feedback` Codex Session ID for the session containing most core functionality.

Official pages: <https://openai.com/build-week/> and <https://openai.devpost.com/>.

The repository license is intentionally split: source is PolyForm Noncommercial 1.0.0;
documentation/media is CC BY-NC 4.0. Do not call the source license CC BY-NC.

## 11. Competition story and video

The first minute must prevent “another navigation robot,” “better planner,” or “LLM
robot” framing. The robot can move; it lacks authority.

Suggested structure:

- **0:00–0:08:** “This looks like another hospital robot. It isn't.”
- **0:08–0:35:** Request appears; robot remains still; CRAS asks what must be true.
- **0:35–0:55:** `UNAUTHORIZED`, patient identity unresolved, zero adapter calls.
- **0:55–1:20:** Resolve, commit evidence, show evidence/grant IDs, then dispatch.
- **1:20–2:15:** Working success plus one decisive fail-closed comparison.
- **2:15–2:40:** Organization -> CRAS -> human / AI agent / robot.
- **2:40–2:58:** Bruce's research-to-reality story and GPT-5.6 Codex contribution.

Key lines:

> The robot is fully capable of moving. It simply has no authority to do so.

> Authority is not produced by the language model. Authority is produced by
> organizational governance.

If ground navigation is not safely repeatable by recording time, show the complete
simulator and label physical stand footage honestly. Never fake the claim.

## 12. UI direction

The operator found the earlier UI too dense. Video should be prominent. During a
mission, emphasize: heard request -> open inquiry -> evidence -> authorization ->
dispatch -> completion. Keep authorization, evidence, and execution separate. Put
hashes/JSON behind disclosure. Preserve the no-hardware simulator. Buttons must visibly
change state without developer tools. Never show a transcript as authorized.

## 13. Recommended next order

### Gate 0 — checkpoint and reproduce

- Commit/push this handoff and marker kit.
- Clean-checkout verification of install, typecheck, tests, build, browser tests,
  Python worker tests, demo, and marker generation.
- Reconcile stale documentation.
- Capture `/feedback` session ID immediately.

### Gate 1 — freeze physical layout

- Assign ten markers to doorways.
- Add dimensioned coordinate/placement map and overhead photo.
- Verify every printed marker with the chosen decoder before motion.

### Gate 2 — read-only marker perception

- Robot-local observational decoder that imports no actuator library.
- Test approach distances/angles and all canonical/distractor payloads.
- Return typed, timestamped, untrusted observations.
- Prove a face alone cannot satisfy identity.

### Gate 3 — smallest credible ground route

- Do not build general autonomous navigation.
- Commission one declared route with bounded segments, conservative speed, stop points,
  marker checkpoints, and immediate cutoff.
- Test steering/turning on stand, then one ground segment, one turn, doorway approach,
  room entry/exit, and reverse docking separately.
- Compose pharmacy -> Room 312 -> home only after those gates pass.
- Version the physical behavior; do not silently change the commissioned V1.

### Gate 4 — bind observations safely

- Map scanned identifiers to typed conditions server-side.
- No QR payload can create a grant or call the worker.
- Wrong/missing/stale markers and evidence/worker failure fail closed.
- Every successful mission uses committed evidence and one consumed grant.

### Gate 5 — proof and submission

- Rehearse canonical success and decisive failure.
- Record robot, UI, and operator observations together; keep simulator capture fallback.
- Final README/reproduction audit, architecture/layout diagrams, hardware list, known
  limitations, clean tree, pushed tag, public video, Devpost fields, and session ID.

Competition readiness outranks product completeness. Do not rush unsafe motion.

## 14. Verification commands

```bash
npm install
npm run typecheck
npm test
npm run build
npm run test:browser
npm run test:robot-worker
npm run test:vision-worker
npm run demo
npm run markers:generate
git diff --check
```

Run the simulator with `npm run dev`, then open `http://localhost:3000`.

### Handoff checkpoint result

Verified locally on July 20, 2026 without contacting or actuating the robot:

- TypeScript: 18 files, 129 tests passed.
- Browser: 7 Playwright scenarios passed.
- Robot worker: 4 Python tests passed.
- Vision worker: 3 Python tests passed.
- Production Next.js build passed.
- Typecheck passed.
- CLI demo passed: blocked and evidence-failure paths made zero adapter calls; the
  success path committed evidence, produced one grant, dispatched once, and executed.
- Marker generator produced 40 QR markers and 8 fictional face drawings.
- QR print PDF: 10 US Letter pages; face PDF: 2 US Letter pages.
- `git diff --check` passed before commit preparation.

## 15. Questions only Bruce can answer

1. Which doorway receives each of the ten location identities?
2. Which 12-inch utility room is home, and what is the other utility room?
3. Where are pharmacy, home, and Room 312 relative to one reference corner?
4. Will markers be on vertical stands at camera height or taped another way?
5. What are the measured clear hallway width and home approach distance?
6. Has the `/feedback` session ID been captured?
7. Has the Devpost draft been created and category selected?

## 16. Agent conduct

- Lead with observed facts; label proposals and inference.
- Never claim Edos/Edos-R/TraceStack or hardware access without evidence.
- Do not interpret vague “proceed” as authorization for a new physical action.
- Preserve user work; inspect the tree before editing.
- Update `BUILD_WEEK.md` for material Build Week additions.
- Commit coherent verified checkpoints and push intentionally.
- Optimize for a reliable submission, not an expansive roadmap.

The remaining task is not to build “a robot that does X.” It is to demonstrate,
clearly and reproducibly, that a capable robot acts only after organizational inquiry
closes and durable authority exists.
