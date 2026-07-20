# CRAS hospital floorplan scenarios

These maps show proposed marker and fictional-image placement for the 10 ft x 5 ft
taped hospital testbed. They are planning and filming artifacts. They do not claim
that QR perception or ground navigation has been implemented.

## Important status

The room assignment is an initial proposal derived from the photographs and current
demo story. Bruce must confirm the ten physical doorway assignments before markers
are permanently installed or coordinates are used in robot code.

Proposed north-to-south assignment:

| Left side | Right side |
| --- | --- |
| Pharmacy | Nurse Station |
| Room 311 | Room 312 |
| Room 313 | Room 314 |
| Supply | Lab |
| Home / charging | Clean Utility |

The proposed 12-inch utility doors are Home and Clean Utility. All other doors are
shown as 16 inches. Change `floorplan-config.json` after physical confirmation.

## Placement convention

- Location QR: vertical at or immediately inside the red doorway, facing the hallway.
- Bed QR: inside a patient room near the simulated bed.
- Patient portrait: inside the room, with its patient QR beside it.
- Medication QR: on an empty simulated package in Pharmacy.
- Staff and order QR: at Nurse Station.
- Home approach QR: facing the arriving robot in the hallway.
- Home final QR: centered at the back of the charging bay for reverse alignment.
- Never tape over a QR quiet zone or use glossy lamination.

The face drawing is not an identity credential. A scanned QR is an untrusted
observation and cannot itself create an authorization grant.

## Generated maps

1. `00-master-placement.svg` — proposed identity and image placement.
2. `01-success-room-312.svg` — canonical insulin delivery to Sarah Johnson.
3. `02-similar-name-mismatch.svg` — Sarah Johnston presented instead.
4. `03-same-name-wrong-id.svg` — Sarah Johnson with the wrong patient number.
5. `04-wrong-medication.svg` — insulin glargine substituted for insulin lispro.
6. `05-order-on-hold.svg` — inactive order at Nurse Station.
7. `06-patient-moved.svg` — correct patient found in Room 314, not ordered Room 312.
8. `07-evidence-outage.svg` — all physical facts satisfied but evidence commit fails;
   the robot remains at Home.

Open `print-floorplans.html` or print `CRAS-floorplan-scenarios-letter.pdf` in landscape
at actual size. Regenerate after configuration changes with:

```bash
npm run markers:generate
npm run floorplans:generate
```

## Before converting a plan into motion

Record measured hallway width, doorway centers, marker height, approach distance, and
turning radius. Commission each straight segment, turn, doorway approach, room entry,
exit, and reverse dock independently. A diagram is not motion authorization.
