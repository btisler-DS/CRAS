import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Side = "left" | "right";
type Role = "expected" | "mismatch" | "context";

type Room = {
  id: string;
  label: string;
  side: Side;
  row: number;
  utility?: boolean;
};

type Placement = {
  marker: string;
  room: string;
  label: string;
  role: Role;
  face?: string;
};

type Scenario = {
  slug: string;
  title: string;
  instruction: string;
  outcome: string;
  status: "PLACEMENT" | "AUTHORIZED PATH" | "UNAUTHORIZED" | "COMMIT FAILED";
  placements: Placement[];
  route?: string[];
  robotAt?: string;
  note: string;
};

const rooms: Room[] = [
  { id: "LOC-PHARMACY", label: "PHARMACY", side: "left", row: 0 },
  { id: "LOC-NURSE-STATION", label: "NURSE STATION", side: "right", row: 0 },
  { id: "LOC-ROOM-311", label: "ROOM 311", side: "left", row: 1 },
  { id: "LOC-ROOM-312", label: "ROOM 312", side: "right", row: 1 },
  { id: "LOC-ROOM-313", label: "ROOM 313", side: "left", row: 2 },
  { id: "LOC-ROOM-314", label: "ROOM 314", side: "right", row: 2 },
  { id: "LOC-SUPPLY", label: "SUPPLY", side: "left", row: 3 },
  { id: "LOC-LAB", label: "LAB", side: "right", row: 3 },
  { id: "LOC-HOME", label: "HOME / CHARGING", side: "left", row: 4, utility: true },
  { id: "LOC-CLEAN-UTILITY", label: "CLEAN UTILITY", side: "right", row: 4, utility: true },
];

const standardPatientPlacements: Placement[] = [
  { marker: "BED-311-A", room: "LOC-ROOM-311", label: "Bed 311-A", role: "context" },
  { marker: "PAT-1002", room: "LOC-ROOM-311", label: "Marcus Lee", role: "context", face: "PAT-1002" },
  { marker: "BED-312-A", room: "LOC-ROOM-312", label: "Bed 312-A", role: "expected" },
  { marker: "PAT-1001", room: "LOC-ROOM-312", label: "Sarah Johnson · PAT-1001", role: "expected", face: "PAT-1001" },
  { marker: "BED-313-A", room: "LOC-ROOM-313", label: "Bed 313-A", role: "context" },
  { marker: "PAT-1003", room: "LOC-ROOM-313", label: "Elena Ruiz", role: "context", face: "PAT-1003" },
  { marker: "BED-314-A", room: "LOC-ROOM-314", label: "Bed 314-A", role: "context" },
  { marker: "PAT-1004", room: "LOC-ROOM-314", label: "Daniel Okafor", role: "context", face: "PAT-1004" },
];

const baseOperational: Placement[] = [
  { marker: "MED-2001", room: "LOC-PHARMACY", label: "Insulin lispro · MED-2001", role: "expected" },
  { marker: "STAFF-NURSE-7001", room: "LOC-NURSE-STATION", label: "Nurse Adeyemi", role: "expected" },
  { marker: "ORDER-8001", room: "LOC-NURSE-STATION", label: "Active order 8001", role: "expected" },
  { marker: "DOCK-HOME-APPROACH", room: "LOC-HOME", label: "Approach marker", role: "context" },
  { marker: "DOCK-HOME-FINAL", room: "LOC-HOME", label: "Final dock marker", role: "context" },
];

const scenarios: Scenario[] = [
  {
    slug: "00-master-placement",
    title: "Master marker and image placement",
    instruction: "Place the printed marker library consistently before running a scenario.",
    outcome: "PROPOSED LAYOUT — OPERATOR CONFIRMATION REQUIRED",
    status: "PLACEMENT",
    placements: [...baseOperational, ...standardPatientPlacements],
    note: "Every doorway also receives its matching LOC-* QR facing the hallway.",
  },
  {
    slug: "01-success-room-312",
    title: "Scenario 1 · Authorized medication delivery",
    instruction: "Deliver insulin lispro to Sarah Johnson in Room 312, Bed 312-A.",
    outcome: "All identities match; evidence commits; one grant permits the declared mission.",
    status: "AUTHORIZED PATH",
    placements: [...baseOperational, ...standardPatientPlacements],
    route: ["LOC-HOME", "LOC-NURSE-STATION", "LOC-PHARMACY", "LOC-ROOM-312", "LOC-HOME"],
    note: "Show evidence ID and grant ID before movement; return and reverse into Home.",
  },
  {
    slug: "02-similar-name-mismatch",
    title: "Scenario 2 · Similar-name patient mismatch",
    instruction: "Deliver insulin lispro to Sarah Johnson, PAT-1001, in Room 312.",
    outcome: "PAT-1901 is Sarah Johnston. Patient identity remains unresolved; no dispatch.",
    status: "UNAUTHORIZED",
    placements: [
      ...baseOperational,
      ...standardPatientPlacements.filter((item) => item.marker !== "PAT-1001"),
      { marker: "PAT-1901", room: "LOC-ROOM-312", label: "Sarah Johnston · PAT-1901", role: "mismatch", face: "PAT-1901" },
    ],
    note: "The similar spelling is intentionally insufficient. Robot remains at Home.",
  },
  {
    slug: "03-same-name-wrong-id",
    title: "Scenario 3 · Same name, wrong patient number",
    instruction: "Deliver insulin lispro to Sarah Johnson, PAT-1001, in Room 312.",
    outcome: "Presented PAT-1902 has the same name but a different identifier; no dispatch.",
    status: "UNAUTHORIZED",
    placements: [
      ...baseOperational,
      ...standardPatientPlacements.filter((item) => item.marker !== "PAT-1001"),
      { marker: "PAT-1902", room: "LOC-ROOM-312", label: "Sarah Johnson · PAT-1902", role: "mismatch", face: "PAT-1902" },
    ],
    note: "Human-readable name equality never overrides the patient identifier.",
  },
  {
    slug: "04-wrong-medication",
    title: "Scenario 4 · Wrong medication formulation",
    instruction: "Deliver insulin lispro, MED-2001, to Sarah Johnson in Room 312.",
    outcome: "MED-2901 is insulin glargine; medication match fails; no dispatch.",
    status: "UNAUTHORIZED",
    placements: [
      ...baseOperational.filter((item) => item.marker !== "MED-2001"),
      { marker: "MED-2901", room: "LOC-PHARMACY", label: "Insulin glargine · MED-2901", role: "mismatch" },
      ...standardPatientPlacements,
    ],
    note: "A related medication name is not an acceptable substitution.",
  },
  {
    slug: "05-order-on-hold",
    title: "Scenario 5 · Physician order on hold",
    instruction: "Deliver insulin lispro to Sarah Johnson in Room 312.",
    outcome: "ORDER-8901 is on hold; physician-order condition fails; no dispatch.",
    status: "UNAUTHORIZED",
    placements: [
      ...baseOperational.filter((item) => item.marker !== "ORDER-8001"),
      { marker: "ORDER-8901", room: "LOC-NURSE-STATION", label: "Order 8901 · ON HOLD", role: "mismatch" },
      ...standardPatientPlacements,
    ],
    note: "Correct patient and medication do not compensate for an inactive order.",
  },
  {
    slug: "06-patient-moved",
    title: "Scenario 6 · Patient moved to another room",
    instruction: "Deliver insulin lispro to Sarah Johnson in Room 312, Bed 312-A.",
    outcome: "PAT-1001 is now in Room 314; ordered location is stale; withhold and re-resolve.",
    status: "UNAUTHORIZED",
    placements: [
      ...baseOperational,
      ...standardPatientPlacements.filter((item) => !["PAT-1001", "PAT-1004"].includes(item.marker)),
      { marker: "PAT-1001", room: "LOC-ROOM-314", label: "Sarah Johnson · moved", role: "mismatch", face: "PAT-1001" },
    ],
    note: "Do not silently redirect. Open a new inquiry and require updated evidence.",
  },
  {
    slug: "07-evidence-outage",
    title: "Scenario 7 · Evidence store unavailable",
    instruction: "Deliver insulin lispro to Sarah Johnson in Room 312, Bed 312-A.",
    outcome: "All physical facts match, but evidence cannot commit; no grant and no movement.",
    status: "COMMIT FAILED",
    placements: [...baseOperational, ...standardPatientPlacements],
    note: "This is the constitutional failure case: capability and conditions are insufficient without durable evidence.",
  },
  {
    slug: "08-video-authorized-departure",
    title: "Video movement 1 · Authorized departure",
    instruction: "A committed evidence record and single-use grant now permit the declared Room 312 mission.",
    outcome: "Robot leaves Home only after AUTHORIZED appears in the live runtime.",
    status: "AUTHORIZED PATH",
    placements: [...baseOperational, ...standardPatientPlacements],
    route: ["LOC-HOME", "LOC-PHARMACY", "LOC-ROOM-312", "LOC-HOME"],
    robotAt: "LOC-HOME",
    note: "Video shot: hold on the stationary robot, show the evidence/grant IDs, then begin movement.",
  },
  {
    slug: "09-video-pharmacy-pickup",
    title: "Video movement 2 · Medication collected",
    instruction: "Collect the matched insulin lispro package at Pharmacy.",
    outcome: "Robot reaches Pharmacy; MED-2001 remains bound to the authorized action.",
    status: "AUTHORIZED PATH",
    placements: [...baseOperational, ...standardPatientPlacements],
    route: ["LOC-HOME", "LOC-PHARMACY", "LOC-ROOM-312", "LOC-HOME"],
    robotAt: "LOC-PHARMACY",
    note: "Video shot: show the robot beside the MED-2001 image, then continue down the hallway.",
  },
  {
    slug: "10-video-room-312-arrival",
    title: "Video movement 3 · Room 312 arrival",
    instruction: "Approach Room 312 and confirm Bed 312-A and PAT-1001.",
    outcome: "Destination, bed, patient, and medication agree with the committed mission evidence.",
    status: "AUTHORIZED PATH",
    placements: [...baseOperational, ...standardPatientPlacements],
    route: ["LOC-HOME", "LOC-PHARMACY", "LOC-ROOM-312", "LOC-HOME"],
    robotAt: "LOC-ROOM-312",
    note: "Video shot: show the doorway QR, bed QR, fictional face, and patient QR separately.",
  },
  {
    slug: "11-video-return-home",
    title: "Video movement 4 · Return and complete",
    instruction: "Return from Room 312 to Home after the declared delivery completes.",
    outcome: "Robot returns to Home; execution and mission-completion records close the interaction.",
    status: "AUTHORIZED PATH",
    placements: [...baseOperational, ...standardPatientPlacements],
    route: ["LOC-HOME", "LOC-PHARMACY", "LOC-ROOM-312", "LOC-HOME"],
    robotAt: "LOC-HOME",
    note: "Video shot: reverse into the 12-inch Home bay only after docking is separately commissioned.",
  },
];

const outputDir = path.resolve("demo-assets/floorplans");
const svgDir = path.join(outputDir, "svg");
await mkdir(svgDir, { recursive: true });

const manifest = JSON.parse(
  await readFile(path.resolve("demo-assets/markers/marker-manifest.json"), "utf8"),
) as Array<{ id: string }>;
const knownMarkers = new Set(manifest.map((item) => item.id));

for (const scenario of scenarios) {
  for (const placement of scenario.placements) {
    if (!knownMarkers.has(placement.marker)) {
      throw new Error(`Unknown marker ${placement.marker} in ${scenario.slug}`);
    }
  }
  const svg = (await renderScenario(scenario)).replace(/^[ \t]+$/gm, "");
  await writeFile(path.join(svgDir, `${scenario.slug}.svg`), svg, "utf8");
}

await writeFile(
  path.join(outputDir, "scenario-manifest.json"),
  `${JSON.stringify(scenarios, null, 2)}\n`,
  "utf8",
);
await writeFile(path.join(outputDir, "print-floorplans.html"), renderPrintPage(), "utf8");
console.log(`Generated ${scenarios.length} floorplan scenarios in ${outputDir}`);

async function renderScenario(scenario: Scenario): Promise<string> {
  const roomSvg = await Promise.all(rooms.map((room) => renderRoom(room, scenario)));
  const routeSvg = scenario.route ? renderRoute(scenario.route, scenario.robotAt) : "";
  const statusColor = scenario.status === "AUTHORIZED PATH" ? "#047857" : scenario.status === "PLACEMENT" ? "#075985" : "#b91c1c";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="950" viewBox="0 0 1400 950" role="img" aria-labelledby="title desc">
  <title id="title">${xml(scenario.title)}</title><desc id="desc">${xml(scenario.instruction)}</desc>
  <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#0f766e"/></marker></defs>
  <rect width="1400" height="950" fill="#f8fafc"/>
  <text x="70" y="42" font-family="Arial" font-size="28" font-weight="700" fill="#0f172a">${xml(scenario.title)}</text>
  <text x="70" y="72" font-family="Arial" font-size="17" fill="#334155">${xml(scenario.instruction)}</text>
  <rect x="1040" y="25" width="290" height="48" rx="24" fill="${statusColor}"/>
  <text x="1185" y="56" text-anchor="middle" font-family="Arial" font-size="17" font-weight="700" fill="#fff">${scenario.status}</text>
  <rect x="450" y="100" width="500" height="725" fill="#dbeafe" stroke="#2563eb" stroke-width="5"/>
  <text x="700" y="135" text-anchor="middle" font-family="Arial" font-size="16" font-weight="700" fill="#1e3a8a">CENTRAL HALLWAY</text>
  ${routeSvg}
  ${roomSvg.join("\n")}
  <rect x="70" y="850" width="1260" height="68" rx="12" fill="#e2e8f0"/>
  <text x="90" y="877" font-family="Arial" font-size="16" font-weight="700" fill="${statusColor}">${xml(scenario.outcome)}</text>
  <text x="90" y="903" font-family="Arial" font-size="14" fill="#334155">${xml(scenario.note)}</text>
  <text x="1315" y="936" text-anchor="end" font-family="monospace" font-size="11" fill="#64748b">SIMULATION TESTBED · PROPOSED ROOM ASSIGNMENT · ${scenario.slug}</text>
  </svg>`;
}

async function renderRoom(room: Room, scenario: Scenario): Promise<string> {
  const x = room.side === "left" ? 70 : 950;
  const y = 100 + room.row * 145;
  const placements = scenario.placements.filter((item) => item.room === room.id);
  const doorX = room.side === "left" ? 438 : 938;
  const doorWidth = room.utility ? 48 : 64;
  const locationQr = await embeddedMarker(room.id);
  const items = await Promise.all(placements.slice(0, 3).map(async (item, index) => {
    const itemX = x + 18 + index * 113;
    const border = item.role === "mismatch" ? "#dc2626" : item.role === "expected" ? "#059669" : "#64748b";
    const image = item.face
      ? await embeddedFace(item.face)
      : await embeddedMarker(item.marker);
    return `<g><rect x="${itemX}" y="${y + 42}" width="103" height="75" rx="8" fill="#fff" stroke="${border}" stroke-width="3"/>
      <image href="${image}" x="${itemX + 5}" y="${y + 47}" width="48" height="48"/>
      <text x="${itemX + 57}" y="${y + 60}" font-family="Arial" font-size="8" font-weight="700" fill="#0f172a">${tspan(item.marker, 13, itemX + 57)}</text>
      <text x="${itemX + 57}" y="${y + 76}" font-family="Arial" font-size="7" fill="${border}">${tspan(item.label, 13, itemX + 57)}</text>
      ${item.face ? `<image href="${await embeddedMarker(item.marker)}" x="${itemX + 62}" y="${y + 83}" width="29" height="29"/>` : ""}
    </g>`;
  }));
  return `<g>
    <rect x="${x}" y="${y}" width="380" height="130" fill="#fff" stroke="#2563eb" stroke-width="5"/>
    <text x="${x + 18}" y="${y + 27}" font-family="Arial" font-size="17" font-weight="700" fill="#0f172a">${room.label}</text>
    <text x="${x + 362}" y="${y + 25}" text-anchor="end" font-family="monospace" font-size="10" fill="#64748b">${room.utility ? "12 IN DOOR" : "16 IN DOOR"}</text>
    <line x1="${doorX}" y1="${y + 45}" x2="${doorX}" y2="${y + 45 + doorWidth}" stroke="#dc2626" stroke-width="12"/>
    <image href="${locationQr}" x="${room.side === "left" ? 454 : 906}" y="${y + 2}" width="40" height="40"/>
    ${items.join("\n")}
  </g>`;
}

function renderRoute(ids: string[], robotAt?: string): string {
  const stops = ids.map((id) => {
    const room = requireRoom(id);
    const y = 165 + room.row * 145;
    return { x: room.side === "left" ? 510 : 890, y };
  });
  const points: string[] = [];
  stops.forEach((stop, index) => {
    if (index === 0) {
      points.push(`${stop.x},${stop.y}`, `700,${stop.y}`);
      return;
    }
    const previous = stops[index - 1]!;
    points.push(`700,${previous.y}`, `700,${stop.y}`, `${stop.x},${stop.y}`);
    if (index < stops.length - 1) points.push(`700,${stop.y}`);
  });
  const numbers = stops.slice(1, -1).map((stop, index) =>
    `<circle cx="${stop.x}" cy="${stop.y}" r="16" fill="#0f766e"/><text x="${stop.x}" y="${stop.y + 5}" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="#fff">${index + 1}</text>`,
  ).join("");
  const robotRoom = requireRoom(robotAt ?? ids[0]!);
  const robotX = robotRoom.side === "left" ? 510 : 890;
  const robotY = 165 + robotRoom.row * 145;
  return `<polyline points="${points.join(" ")}" fill="none" stroke="#0f766e" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrow)" opacity=".9"/>
  ${numbers}
  <circle cx="${robotX}" cy="${robotY}" r="22" fill="#0f172a" stroke="#5eead4" stroke-width="6"/><text x="${robotX}" y="${robotY + 5}" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="#fff">R</text>`;
}

function requireRoom(id: string): Room {
  const room = rooms.find((candidate) => candidate.id === id);
  if (!room) throw new Error(`Unknown room ${id}`);
  return room;
}

async function embeddedMarker(id: string): Promise<string> {
  return dataUri(await readFile(path.resolve(`demo-assets/markers/svg/${id}.svg`), "utf8"));
}

async function embeddedFace(id: string): Promise<string> {
  return dataUri(await readFile(path.resolve(`demo-assets/markers/faces/${id}.svg`), "utf8"));
}

function dataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function tspan(value: string, max: number, x: number): string {
  const words = value.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > max && current) {
      lines.push(current);
      current = word;
    } else current = `${current} ${word}`.trim();
  }
  if (current) lines.push(current);
  return lines.slice(0, 2).map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : 10}">${xml(line)}</tspan>`).join("");
}

function renderPrintPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CRAS Floorplan Scenarios</title><style>
  @page{size:letter landscape;margin:.25in}*{box-sizing:border-box}body{margin:0;background:#fff}.page{width:10.5in;height:8in;display:flex;align-items:center;justify-content:center;break-after:page}.page:last-child{break-after:auto}.page img{width:10.5in;height:auto;max-height:8in}@media screen{body{background:#334155}.page{margin:.25in auto;background:#fff}}
  </style></head><body>${scenarios.map((scenario) => `<section class="page"><img src="svg/${scenario.slug}.svg" alt="${xml(scenario.title)}"></section>`).join("")}</body></html>`;
}
