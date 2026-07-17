# Canonical Demonstration

## Status

This is the required demonstration specification. It has not yet been implemented.

## Scenario A: Authorization succeeds only after evidence commit

### Initial conditions

- The robot is stationary.
- The runtime and evidence store are available.
- No patient identity has been resolved for the requested delivery.

### Script

1. Submit the instruction: **“Deliver medication to Room 312.”**
2. The runtime identifies patient identity as an unresolved required condition.
3. The UI displays `UNAUTHORIZED` and a specific patient-identity blocking reason.
4. The robot remains stationary, and the robot adapter receives no action.
5. Resolve the required patient identity and any other required conditions through the demonstration controls.
6. The runtime reevaluates the exact proposed action.
7. The runtime begins and successfully commits an evidence transaction.
8. The UI exposes the committed evidence reference and allows the evidence record to be exported.
9. Only after the commit succeeds, the decision changes to `AUTHORIZED`.
10. A grant bound to the action and evidence record reaches the robot adapter.
11. The simulated robot executes the delivery movement.

### Required observations

- Resolution of policy conditions alone is not presented as authorization.
- `AUTHORIZED` appears only after evidence commit succeeds.
- Movement begins only after authorization.
- The authorized action has a durable, exportable evidence record.

## Scenario B: Evidence store unavailable

### Initial conditions

- The robot is stationary.
- Patient identity and every other policy condition are satisfied.
- The demonstration fault control makes the evidence repository unavailable at the actual repository boundary.

### Script

1. Submit or reevaluate the medication-delivery action.
2. The policy evaluator reports that all non-evidence conditions are satisfied.
3. The evidence transaction fails because the store is unavailable.
4. The runtime fails closed and does not issue an authorization grant.
5. The UI displays `UNAUTHORIZED` or an explicit authorization-failure state and identifies evidence commit failure as the reason.
6. The robot adapter receives no action.
7. The robot remains stationary.

### Required observations

- The outage is injected at the evidence repository boundary, not simulated only as a visual UI state.
- There is no committed evidence record or authorization grant for the failed attempt.
- Satisfying all other conditions cannot bypass evidence persistence.
- No robot-adapter invocation occurs.

## Hardware fallback

The simulated robot and browser UI must demonstrate both scenarios completely without physical hardware. A later hardware adapter may supplement, but must not replace, the canonical simulation.

## Future verification targets

Automated tests should eventually verify adapter invocation counts, persisted evidence references, state transitions, rollback behavior, robot position, export behavior, and restart persistence. None of these tests exists in Phase 0.
