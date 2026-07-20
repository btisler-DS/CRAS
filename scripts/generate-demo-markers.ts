import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";

type MarkerKind = "LOCATION" | "BED" | "PATIENT" | "MEDICATION" | "STAFF" | "ORDER" | "DOCK";

type Marker = {
  id: string;
  kind: MarkerKind;
  title: string;
  subtitle: string;
  payload: string;
  role: "canonical" | "distractor";
};

type MarkerRow = [id: string, title: string, subtitle: string, role: Marker["role"]];

const locationRows: MarkerRow[] = [
  ["LOC-PHARMACY", "PHARMACY", "Medication pickup", "canonical"],
  ["LOC-HOME", "HOME BASE", "Utility room / charging bay", "canonical"],
  ["LOC-NURSE-STATION", "NURSE STATION", "Instruction origin", "canonical"],
  ["LOC-SUPPLY", "SUPPLY ROOM", "Clinical supplies", "canonical"],
  ["LOC-LAB", "LAB", "Specimen processing", "canonical"],
  ["LOC-CLEAN-UTILITY", "CLEAN UTILITY", "Utility room", "canonical"],
  ["LOC-ROOM-311", "ROOM 311", "Patient room", "canonical"],
  ["LOC-ROOM-312", "ROOM 312", "Canonical destination", "canonical"],
  ["LOC-ROOM-313", "ROOM 313", "Patient room", "canonical"],
  ["LOC-ROOM-314", "ROOM 314", "Patient room", "canonical"],
];
const locations = locationRows.map(([id, title, subtitle, role]) =>
  marker(id, "LOCATION", title, subtitle, role),
);

const beds: Marker[] = [311, 312, 313, 314].flatMap((room) =>
  (["A", "B"] as const).map((bed) =>
    marker(`BED-${room}-${bed}`, "BED", `BED ${room}-${bed}`, `Inside Room ${room}`, "canonical"),
  ),
);

const patientRows: MarkerRow[] = [
  ["PAT-1001", "SARAH JOHNSON", "Assigned: Room 312 · Bed 312-A", "canonical"],
  ["PAT-1002", "MARCUS LEE", "Assigned: Room 311 · Bed 311-A", "canonical"],
  ["PAT-1003", "ELENA RUIZ", "Assigned: Room 313 · Bed 313-A", "canonical"],
  ["PAT-1004", "DANIEL OKAFOR", "Assigned: Room 314 · Bed 314-A", "canonical"],
  ["PAT-1901", "SARAH JOHNSTON", "DISTRACTOR · similar name", "distractor"],
  ["PAT-1902", "SARAH JOHNSON", "DISTRACTOR · wrong patient number", "distractor"],
  ["PAT-1903", "ALEX SMITH", "DISTRACTOR · ambiguous surname", "distractor"],
  ["PAT-1904", "JORDAN SMITH", "DISTRACTOR · ambiguous surname", "distractor"],
];
const patients = patientRows.map(([id, title, subtitle, role]) =>
  marker(id, "PATIENT", title, subtitle, role),
);

const medicationRows: MarkerRow[] = [
  ["MED-2001", "INSULIN LISPRO", "Canonical medication · simulated", "canonical"],
  ["MED-2002", "MORPHINE", "Simulated medication", "canonical"],
  ["MED-2003", "AMOXICILLIN", "Simulated medication", "canonical"],
  ["MED-2004", "SALINE", "Simulated medication", "canonical"],
  ["MED-2901", "INSULIN GLARGINE", "DISTRACTOR · wrong formulation", "distractor"],
  ["MED-2902", "INSULIN LISPRO", "DISTRACTOR · wrong package ID", "distractor"],
  ["MED-2903", "INSULIN LISPRO", "DISTRACTOR · expired lot", "distractor"],
  ["MED-2904", "UNLABELED ITEM", "DISTRACTOR · identity unresolved", "distractor"],
];
const medications = medicationRows.map(([id, title, subtitle, role]) =>
  marker(id, "MEDICATION", title, subtitle, role),
);

const operational: Marker[] = [
  marker("STAFF-NURSE-7001", "STAFF", "NURSE ADEYEMI", "Authorized demo nurse", "canonical"),
  marker("STAFF-VISITOR-7901", "STAFF", "VISITOR BADGE", "DISTRACTOR · not authorized", "distractor"),
  marker("ORDER-8001", "ORDER", "ACTIVE ORDER 8001", "Sarah Johnson · insulin lispro", "canonical"),
  marker("ORDER-8901", "ORDER", "ORDER 8901 ON HOLD", "DISTRACTOR · inactive order", "distractor"),
  marker("DOCK-HOME-APPROACH", "DOCK", "HOME APPROACH", "Align before reverse docking", "canonical"),
  marker("DOCK-HOME-FINAL", "DOCK", "HOME DOCK", "Final reverse-docking marker", "canonical"),
];

const markers = [...locations, ...beds, ...patients, ...medications, ...operational];
const outputDir = path.resolve("demo-assets/markers");
const svgDir = path.join(outputDir, "svg");
const faceDir = path.join(outputDir, "faces");
await mkdir(svgDir, { recursive: true });
await mkdir(faceDir, { recursive: true });

for (const item of markers) {
  const svg = await QRCode.toString(item.payload, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 4,
    color: { dark: "#000000", light: "#ffffff" },
  });
  await writeFile(path.join(svgDir, `${item.id}.svg`), svg, "utf8");
}

for (const [index, item] of patients.entries()) {
  await writeFile(path.join(faceDir, `${item.id}.svg`), renderFace(item, index), "utf8");
}

await writeFile(path.join(outputDir, "marker-manifest.json"), `${JSON.stringify(markers, null, 2)}\n`, "utf8");
await writeFile(path.join(outputDir, "print-markers.html"), renderPrintSheet(markers), "utf8");
await writeFile(path.join(outputDir, "print-patient-faces.html"), renderFaceSheet(patients), "utf8");
console.log(`Generated ${markers.length} QR markers and ${patients.length} fictional face drawings in ${outputDir}`);

function marker(
  id: string,
  kind: MarkerKind,
  title: string,
  subtitle: string,
  role: "canonical" | "distractor",
): Marker {
  return {
    id,
    kind,
    title,
    subtitle,
    role,
    payload: `cras:v1:${kind.toLowerCase()}:${id.toLowerCase()}`,
  };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderPrintSheet(items: Marker[]): string {
  const cards = items.map((item) => `
    <article class="marker ${item.role}">
      <header><span>${item.kind}</span><strong>${item.role === "distractor" ? "TEST MISMATCH" : "CRAS DEMO"}</strong></header>
      <img src="svg/${item.id}.svg" alt="QR code for ${item.id}">
      <h2>${escapeHtml(item.title)}</h2>
      <p>${escapeHtml(item.subtitle)}</p>
      <code>${item.id}</code>
      <small>SIMULATION ONLY · NO REAL PATIENT DATA</small>
    </article>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>CRAS Demonstration Markers</title>
<style>
@page { size: letter portrait; margin: 0.35in; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; }
.sheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.18in; }
.marker { height: 4.95in; border: 3px solid #111; padding: 0.14in; break-inside: avoid; display: grid; grid-template-rows: auto 3.05in auto auto auto auto; text-align: center; align-items: center; }
.marker.distractor { border-style: dashed; }
header { display: flex; justify-content: space-between; font: 700 10pt monospace; letter-spacing: .06em; }
header strong { color: #9b1c1c; }
img { width: 3.05in; height: 3.05in; justify-self: center; image-rendering: pixelated; }
h2 { font-size: 19pt; line-height: 1; margin: .04in 0; }
p { font-size: 10pt; margin: 0; }
code { font-size: 11pt; font-weight: 700; }
small { font-size: 7pt; letter-spacing: .05em; }
@media screen { body { max-width: 8.5in; margin: .25in auto; } }
</style></head><body><main class="sheet">${cards}</main></body></html>`;
}

function renderFace(item: Marker, index: number): string {
  const skins = ["#8d5524", "#c68642", "#f1c27d", "#6f3b24", "#d6a06b", "#9f683f", "#e0ac69", "#7d4b35"];
  const hair = ["#17120f", "#3a2518", "#5d3422", "#111827", "#654321", "#2d1b12", "#7c4a2d", "#1f2937"];
  const shirts = ["#2563eb", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#0369a1", "#4d7c0f", "#6d28d9"];
  const glasses = index === 1 || index === 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img" aria-label="Fictional drawn portrait for ${item.id}">
  <rect width="600" height="600" fill="#e7eef2"/>
  <circle cx="300" cy="275" r="205" fill="#cbd5e1"/>
  <path d="M80 600c25-150 105-220 220-220s195 70 220 220" fill="${shirts[index]}"/>
  <rect x="260" y="340" width="80" height="105" rx="34" fill="${skins[index]}"/>
  <ellipse cx="300" cy="265" rx="130" ry="155" fill="${skins[index]}"/>
  <path d="M176 255c-14-128 50-196 132-196 99 0 143 71 122 196-22-70-69-108-130-108-61 0-101 38-124 108z" fill="${hair[index]}"/>
  <ellipse cx="252" cy="267" rx="11" ry="14" fill="#151515"/><ellipse cx="348" cy="267" rx="11" ry="14" fill="#151515"/>
  ${glasses ? '<g fill="none" stroke="#111" stroke-width="8"><rect x="207" y="232" width="88" height="70" rx="20"/><rect x="305" y="232" width="88" height="70" rx="20"/><path d="M295 258h10"/></g>' : "<!-- no glasses -->"}
  <path d="M255 334q45 40 90 0" fill="none" stroke="#7c2d12" stroke-width="9" stroke-linecap="round"/>
  <circle cx="300" cy="300" r="7" fill="#9a5c39"/>
  </svg>`;
}

function renderFaceSheet(items: Marker[]): string {
  const cards = items.map((item) => `
    <article class="face ${item.role}">
      <header>FICTIONAL DEMO PATIENT</header>
      <img src="faces/${item.id}.svg" alt="Fictional drawing for ${item.title}">
      <h2>${escapeHtml(item.title)}</h2>
      <code>${item.id}</code>
      <p>${escapeHtml(item.subtitle)}</p>
      <small>DRAWING ONLY · NOT AN IDENTITY CREDENTIAL</small>
    </article>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CRAS Fictional Patient Faces</title>
<style>
@page { size: letter portrait; margin: .35in; } *{box-sizing:border-box} body{margin:0;font-family:Arial,sans-serif;color:#000;background:#fff}
.sheet{display:grid;grid-template-columns:repeat(2,1fr);gap:.18in}.face{height:4.95in;border:3px solid #111;padding:.14in;break-inside:avoid;display:grid;grid-template-rows:auto 3in auto auto auto auto;text-align:center;align-items:center}.face.distractor{border-style:dashed}header{font:700 10pt monospace;letter-spacing:.08em;color:#9b1c1c}img{width:3in;height:3in;object-fit:contain;justify-self:center}h2{font-size:19pt;line-height:1;margin:.04in 0}code{font-size:11pt;font-weight:700}p{font-size:9pt;margin:0}small{font-size:7pt;letter-spacing:.04em}@media screen{body{max-width:8.5in;margin:.25in auto}}
</style></head><body><main class="sheet">${cards}</main></body></html>`;
}
