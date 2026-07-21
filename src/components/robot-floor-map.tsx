import type { RuntimeView } from "../ui/runtime-view.js";

interface RobotFloorMapProps {
  readonly robot: RuntimeView["robot"];
}

export function RobotFloorMap({ robot }: RobotFloorMapProps) {
  const arrived = robot.position === "Room 312";
  const physical = robot.target === "physical";
  const displayPosition = robot.position === "pharmacy" ? "Pharmacy" : robot.position;
  const plannedPathStatus = arrived
    ? "Travelled after approval"
    : robot.dispatchCount === 0
      ? "Not travelled"
      : robot.movementState === "FAILED"
        ? "Movement stopped"
        : "Protected command issued";
  const actualMovement = physical
    ? robot.dispatchCount === 0
      ? "None"
      : "Commissioned behavior dispatched"
    : arrived
      ? "Pharmacy → Room 312"
      : robot.movementState === "FAILED"
        ? "Stopped before destination"
        : "None";
  return (
    <section
      className={`panel floor-panel ${
        arrived ? "floor-panel--active" : "floor-panel--idle"
      }`}
      aria-labelledby="floor-heading"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Route evidence</span>
          <h3 id="floor-heading">
            {physical ? "Commissioning movement" : "Planned and actual movement"}
          </h3>
        </div>
        <span className={`pill movement-pill ${arrived ? "pill--success" : ""}`}>
          Vehicle at {displayPosition}
        </span>
      </div>
      <div
        className={`floor-map ${arrived ? "floor-map--arrived" : "floor-map--idle"}`}
        aria-label={
          arrived
            ? "Vehicle moved from Pharmacy to Room 312 after CRAS approval."
            : "Vehicle remains at Pharmacy. The planned path to Room 312 was not travelled."
        }
        data-testid="floor-map"
      >
        <div className={`room room--pharmacy ${arrived ? "" : "room--current"}`}>
          <span>{arrived ? "Starting location" : "Current location"}</span>
          <strong>Pharmacy</strong>
        </div>
        <div className="route-track">
          <span className="route-line" aria-hidden="true" />
          <span className="route-progress" aria-hidden="true" />
          <span className="route-status" data-testid="planned-path-status">
            <small>Planned path</small>
            <strong>{plannedPathStatus}</strong>
          </span>
        </div>
        <div
          className={`robot ${arrived ? "robot--arrived" : ""}`}
          aria-label={`Vehicle at ${displayPosition}`}
          data-testid="robot"
        >
          <span className="robot-light" />
          CR
        </div>
        <div className={`room room--destination ${arrived ? "room--current" : ""}`}>
          <span>{arrived ? "Current location" : "Intended destination"}</span>
          <strong>Room 312</strong>
        </div>
      </div>
      <div className="metric-row">
        <div>
          <span>Delivery commands sent</span>
          <strong data-testid="adapter-calls">{robot.dispatchCount}</strong>
        </div>
        <div>
          <span>Current location</span>
          <strong data-testid="robot-position">{displayPosition}</strong>
        </div>
        <div>
          <span>Actual movement</span>
          <strong data-testid="actual-movement">{actualMovement}</strong>
        </div>
      </div>
    </section>
  );
}
