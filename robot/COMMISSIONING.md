# Physical behavior commissioning record

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
