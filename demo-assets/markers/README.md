# CRAS demonstration marker kit

These markers contain fictional identifiers for the physical hospital testbed. They
contain no real patient or clinical information.

## Code specification

- Symbology: QR Code Model 2
- Payload encoding: UTF-8 text using the `cras:v1:<kind>:<id>` namespace
- Error correction: H (approximately 30% codeword recovery)
- Colors: pure black modules on a matte white background
- Quiet zone: four modules on every side
- Printed QR area: 3.05 inches square on the supplied sheet
- Paper: white, non-glossy letter paper or matte card stock
- Printing: 100% / actual size; disable “fit to page” and color enhancement

Open `print-markers.html` in a browser and print at actual size. Do not crop the white
quiet zone, laminate with glossy film, recolor, stretch, or place tape over the QR area.
The human-readable text is part of the demonstration but is not the scanned payload.

`print-navigation-markers.html` contains three full-page, high-visibility location
markers for the physical route. They remain mounted in the environment; the operator
does not present them to the camera. Print at 100% scale without fit-to-page reduction.

`print-patient-faces.html` contains eight deliberately simple fictional portrait
drawings. Place the appropriate QR patient marker beside, not over, the face. A face is
demonstration context only and must never satisfy patient identity by itself.

Regenerate the manifest, SVG files, and print sheet with:

```bash
npm run markers:generate
```

## Placement

- Location markers: vertical stand at or immediately before the red doorway; keep the
  marker facing the hallway and use the same camera height everywhere.
- Bed markers: inside the patient room, visually separated from the doorway marker.
- Patient markers: beside a printed fictional face; never encode the face or use it as
  identity proof.
- Medication markers: attach to empty demonstration packages only.
- `DOCK-HOME-APPROACH`: forward-facing, before the reverse-docking maneuver.
- `DOCK-HOME-FINAL`: centered at the rear of the home bay.

Test scan distance, glare, and camera focus before taping markers permanently. QR
recognition supplies a typed observation; it does not itself authorize execution.

## Canonical medication scenario

- Destination: `LOC-ROOM-312`
- Bed: `BED-312-A`
- Patient: `PAT-1001` (Sarah Johnson, fictional)
- Medication: `MED-2001` (insulin lispro, simulated)
- Staff: `STAFF-NURSE-7001`
- Order: `ORDER-8001`

Use the markers labeled `TEST MISMATCH` to demonstrate wrong-patient, wrong-medication,
ambiguous-identity, inactive-order, and unauthorized-request failures.
