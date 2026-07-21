import type { RuntimeView } from "../ui/runtime-view.js";

interface RobotFloorMapProps {
  readonly robot: RuntimeView["robot"];
}

export function RobotFloorMap({ robot }: RobotFloorMapProps) {
  const arrived = robot.position === "Room 312";
  const physical = robot.target === "physical";
  return (
    <section
      className={`panel floor-panel ${
        arrived ? "floor-panel--active" : "floor-panel--idle"
      }`}
      aria-labelledby="floor-heading"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            {physical ? "Protected physical adapter" : "Canonical simulator"}
          </span>
          <h2 id="floor-heading">
            {physical ? "Commissioning round trip" : "Medication route"}
          </h2>
        </div>
        <span className={`pill movement-pill ${arrived ? "pill--success" : ""}`}>
          Endpoint · {robot.movementState}
        </span>
      </div>
      <div
        className={`floor-map ${arrived ? "floor-map--arrived" : "floor-map--idle"}`}
        data-testid="floor-map"
      >
        <div className={`room room--pharmacy ${arrived ? "" : "room--current"}`}>
          <span>{arrived ? "Start" : "Current"}</span>
          <strong>Pharmacy</strong>
        </div>
        <div className="route-track" aria-hidden="true">
          <span className="route-line" />
          <span className="route-progress" />
          <span className="route-status">
            {arrived ? "Authorized route completed" : "Route locked until authorization"}
          </span>
        </div>
        <div
          className={`robot ${arrived ? "robot--arrived" : ""}`}
          aria-label={`Robot at ${robot.position}`}
          data-testid="robot"
        >
          <span className="robot-light" />
          CR
        </div>
        <div className={`room room--destination ${arrived ? "room--current" : ""}`}>
          <span>Destination</span>
          <strong>Room 312</strong>
        </div>
      </div>
      <div className="metric-row">
        <div>
          <span>Adapter calls</span>
          <strong data-testid="adapter-calls">{robot.dispatchCount}</strong>
        </div>
        <div>
          <span>{physical ? "Worker receipt" : "Final position"}</span>
          <strong data-testid="robot-position">{robot.position}</strong>
        </div>
      </div>
    </section>
  );
}
