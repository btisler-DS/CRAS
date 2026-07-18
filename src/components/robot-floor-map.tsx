import type { RuntimeView } from "../ui/runtime-view.js";

interface RobotFloorMapProps {
  readonly robot: RuntimeView["robot"];
}

export function RobotFloorMap({ robot }: RobotFloorMapProps) {
  const arrived = robot.position === "Room 312";
  return (
    <section className="panel floor-panel" aria-labelledby="floor-heading">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Canonical simulator</span>
          <h2 id="floor-heading">Medication route</h2>
        </div>
        <span className={`pill ${arrived ? "pill--success" : ""}`}>
          {robot.movementState}
        </span>
      </div>
      <div className="floor-map" data-testid="floor-map">
        <div className="room room--pharmacy">
          <span>Start</span>
          <strong>Pharmacy</strong>
        </div>
        <div className="route-line" />
        <div
          className={`robot ${arrived ? "robot--arrived" : ""}`}
          aria-label={`Robot at ${robot.position}`}
          data-testid="robot"
        >
          <span className="robot-light" />
          CR
        </div>
        <div className="room room--destination">
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
          <span>Final position</span>
          <strong data-testid="robot-position">{robot.position}</strong>
        </div>
      </div>
    </section>
  );
}
