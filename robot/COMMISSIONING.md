# Physical behavior commissioning record

## Private acknowledgment verification — attention

Verified July 20, 2026 with the robot secured on its stand:

- Request: fixed `ATTENTION` acknowledgment through the signed, loopback-only worker
  boundary.
- Worker receipt: HTTP 200, `acknowledged`, cleanup completed.
- Operator observation: one short tone heard; no actuator movement.
- Postcondition: worker healthy, GPIO20 restored to `PCM_DIN` (`a0`, pull-down), no
  acknowledgment or motion child remained, and no PCM playback owner remained.
- `INSTRUCTION_RECEIVED`, `AUTHORIZED`, and `MISSION_COMPLETED` patterns were not
  exercised in that verification.

## Private acknowledgment verification — instruction received

Verified July 20, 2026 with the robot secured on its stand:

- Request: fixed `INSTRUCTION_RECEIVED` acknowledgment through the signed,
  loopback-only worker boundary.
- Worker receipt: HTTP 200, `acknowledged`, cleanup completed.
- Operator observation: exactly two short tones heard; no actuator movement.
- Postcondition: worker healthy, GPIO20 restored to `PCM_DIN`, no acknowledgment or
  motion child remained, and no PCM playback owner remained.
- `AUTHORIZED` and `MISSION_COMPLETED` remain unverified on hardware.

## Private acknowledgment verification — authorized

Verified July 20, 2026 with the robot secured on its stand:

- Request: fixed `AUTHORIZED` acknowledgment through the signed, loopback-only worker
  boundary. This pattern-only commissioning request did not create a grant or dispatch.
- Worker receipt: HTTP 200, `acknowledged`, cleanup completed.
- Operator observation: one long tone heard; no actuator movement.
- Postcondition: worker healthy, GPIO20 restored to `PCM_DIN`, no acknowledgment or
  motion child remained, and no PCM playback owner remained.
- `MISSION_COMPLETED` remains unverified on hardware.

## Private acknowledgment verification — mission completed

Verified July 20, 2026 with the robot secured on its stand:

- Request: fixed `MISSION_COMPLETED` acknowledgment through the signed, loopback-only
  worker boundary.
- Worker receipt: HTTP 200, `acknowledged`, cleanup completed.
- Operator observation: exactly three short tones heard; no actuator movement.
- Postcondition: worker healthy, GPIO20 restored to `PCM_DIN`, no acknowledgment or
  motion child remained, and no PCM playback owner remained.

All four fixed patterns are physically verified: attention (one short), instruction
received (two short), authorized (one long), and mission completed (three short).

## Former round-trip contract — physically verified checkpoint

`MEDICATION_DELIVERY_ROUND_TRIP_V1` superseded the forward-only behavior as the one
active physical contract at this checkpoint. It commands minimum-speed forward for 1,000 ms, stops,
holds neutral for 500 ms, commands minimum-speed reverse for 1,000 ms, and stops in
`finally`. A successful receipt reports `home-base`.

The exact command order passes a hardware-free injected-controller test.

Verified July 20, 2026 on the wheel-off-ground stand:

- Evidence record: `48105638-fa5e-440d-8fa3-d808f921120a`
- Authorization grant: `7667e470-3128-4949-9d43-9b77ad007bfa`
- Execution record: `7b7afbfd-d6a5-4ebd-a809-27ad1e046e3d`
- Server execution state: `EXECUTED`
- Authenticated adapter calls: exactly one
- Worker replay record: durably persisted
- Worker receipt: `home-base`
- Operator observation: both wheels ran forward and backward with the intended stop;
  final stop succeeded and no other issue or unintended actuator movement occurred.
- Post-action state: worker active and healthy; no motion child remained.

The current code admits the versioned successor `MEDICATION_DELIVERY_MISSION_V1`, a
bounded Pharmacy → Room 312 → Home behavior. Its hardware-free tests pass, but it has
not completed the physical ground route. Do not use this earlier round-trip checkpoint
as evidence that the successor navigated the course. See
[`BUILD_WEEK_REPORT.md`](../BUILD_WEEK_REPORT.md).

Constitutional Runtime exposes exactly one physical behavior for the competition demonstration.

```text
behavior: MEDICATION_DELIVERY_DEMO_V1
admitted action: MEDICATION_DELIVERY
destination: Room 312
left motor: 1
right motor: 2
speed: 1 (minimum supported nonzero command)
duration: 1,000 ms
termination: stop() in finally
test posture: every driven wheel off the ground
```

Verified July 19, 2026:

- Evidence record: `3fcbb08c-af28-43d0-98b0-197e52b497a1`
- Authorization grant: `56ce94f8-91e2-4e79-82d4-0b322a9f761b`
- Server execution state: `EXECUTED`
- Authenticated worker calls: exactly one
- Remote replay record: persisted
- Operator observation: both raised rear wheels moved for approximately one second and fully stopped
- Post-action state: worker healthy; no motion child remained

This behavior is a commissioning/demo maneuver. It does not claim physical navigation to Room 312.

Repeatability verification, July 19, 2026:

- Evidence record: `59289496-f525-4627-a1e9-99ada4d6ad82`
- Authorization grant: `803f377d-cb87-4cc1-9517-2fe16aae7eca`
- Server execution state: `EXECUTED`
- Authenticated worker calls: exactly one
- Remote replay record: persisted
- Operator observation: both raised rear wheels again moved for approximately one second and fully stopped
- Post-action state: worker healthy and passive; no motion child remained

## QR seek commissioning — physically verified

Verified July 21, 2026 on the taped ground testbed as a bounded commissioning
diagnostic, not as a CRAS-authorized mission or production actuator path:

- Contract label: `QR_SEEK_COMMISSIONING_V1`.
- Pre-run battery: 8.09 V; both private workers healthy and passive.
- Initial state: robot centered in a clear hallway; operator beside the whole-robot
  OFF switch with the battery connector accessible.
- Camera pose: pan `20`, tilt `65`; capture: 1296 x 972.
- Bound: at most three straight advances, speed `1`, 500 ms each, with a complete
  stop and two-second pause before every subsequent scan.
- Initial stationary scan: no marker decoded.
- Advance 1: both drive motors commanded for 500 ms, followed by `stop()`.
- Second stationary scan: decoded `cras:v1:location:loc-home` as `LOC-HOME`.
- Termination: marker detection ended the run; advances 2 and 3 were not executed.
- Software cleanup: final `stop()` completed and all temporary images were deleted.
- Operator observation: the robot moved straight briefly and stopped cleanly; no
  unexpected actuator behavior occurred.
- Postcondition: no motion or camera child remained; robot and vision workers were
  active, healthy, and actuator/camera idle.

This result verifies one bounded stop-scan-advance-stop-recognize sequence. It does
not establish general navigation, route completion, doorway traversal, or a protected
mission dispatch. The temporary commissioning script was removed from the robot.

The follow-up passive observation was then repeated through the deployed vision worker
and CRAS server proxy with no actuator access or movement. The fixed 1296 x 972 scan
emitted `marker-00000002` for `LOC-HOME`; its typed payload and normalized image
geometry passed the server schema. This verifies physical observation transport, not
authorization or execution.
