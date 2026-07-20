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

## Active round-trip contract — physically verified

`MEDICATION_DELIVERY_ROUND_TRIP_V1` supersedes the forward-only behavior as the one
active physical contract. It commands minimum-speed forward for 1,000 ms, stops,
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
