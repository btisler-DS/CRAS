# Canonical Demonstration

## Status

Phase 4 implements the canonical browser presentation. Start it with `npm run dev`, open `http://localhost:3000`, and use the preset controls without developer tools. The Phase 3 CLI remains available with `npm run demo`.

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

## Phase 3 CLI demonstration

The CLI runs three isolated scenarios and prints their state transitions, evidence and grant IDs, adapter call counts, movement state, and final position:

1. Unresolved patient identity: `BLOCKED`, no evidence or grant, zero calls, pharmacy.
2. All conditions plus committed evidence: `AUTHORIZED -> DISPATCHED -> EXECUTED`, one call, Room 312.
3. Injected evidence repository failure: `EVIDENCE_COMMIT_FAILED`, rolled-back evidence, no grant, zero calls, pharmacy.

The evidence failure is injected in the repository immediately before the evidence write; it is not a presentation-only fault.

## Exact three-minute operator script

### 0:00–0:25 — Establish the rule

Open the app on the default **Blocked** preset. Read the instruction aloud: “Deliver medication to Room 312.” Point to the large `UNAUTHORIZED` status, the unresolved patient identity reason, the robot at `pharmacy`, and `Adapter calls: 0`.

Say: “The instruction exists, but authorization precedes execution. The robot cannot receive this action while identity is unresolved.”

### 0:25–0:55 — Resolve conditions without authorizing

Check **Patient identity verified**. The checklist becomes 4/4 and the large status changes to `READY FOR EVIDENCE`.

Point to the separate state row: authorization is ready, evidence is `NOT STARTED`, execution is `STATIONARY`, and adapter calls remain zero.

Say: “Passing policy is necessary, but it is not authorization. Durable evidence still has to commit.”

### 0:55–1:35 — Commit, authorize, and execute

Click **Commit evidence & execute**. Point to the large `AUTHORIZED` status, `COMMITTED` evidence, and `EXECUTED` execution state. Follow the robot moving to Room 312.

Show the evidence ID, grant ID, one adapter call, final position `Room 312`, and the timeline ending in `DISPATCHED` then `EXECUTED`. Expand **View committed JSON**, then click **Export JSON**.

Say: “The evidence row and single-use grant committed together. Only after commit did the protected dispatcher consume the grant and invoke the simulator exactly once.”

### 1:35–2:25 — Prove fail-closed evidence behavior

Click the **Evidence failure** preset. Confirm all four conditions are satisfied and the failure switch is visibly on. The status is `READY FOR EVIDENCE`, not authorized.

Click **Commit evidence & execute**. Point to `EVIDENCE COMMIT FAILED`, the authorization-denied explanation, `No evidence record`, `No authorization grant`, zero adapter calls, and the robot still at `pharmacy`.

Say: “The fault is injected in the repository, inside the transaction. Even with every condition satisfied, failed evidence persistence means no authorization and no dispatch opportunity.”

### 2:25–3:00 — Close on the invariants

Click **Reset** and show the deterministic initial blocked state.

Summarize: “Authorization precedes execution. Evidence commit completes authorization. Unauthorized actions cannot reach the adapter. Every authorized action references durable, exportable evidence. The complete proof runs locally without physical hardware.”

## Future verification targets

Automated tests verify adapter invocation counts, persisted evidence and execution references, state transitions, rollback behavior, robot position, export behavior, restart persistence, replay rejection, expiry, revocation, mismatches, missing evidence, repeated dispatch, and adapter failure. Six Chromium tests verify the four browser scenes, reset, export equality, and bypass rejection.
