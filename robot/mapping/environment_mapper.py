#!/usr/bin/env python3
"""Bounded robot-native topological mapping; no hardware access on import."""

import json
import os
import pwd
import re
import signal
import subprocess
import time
import uuid
from datetime import datetime, timezone

MAP_VERSION = "ENVIRONMENT_MAPPING_V2"
OUTPUT_PATH = os.environ.get("CRAS_ENVIRONMENT_MAP_PATH", "/var/lib/cras-robot/maps/environment-map-v2.json")
GATE = "I_CONFIRM_BOUNDED_GROUND_MAPPING"
MARKER = re.compile(r"^cras:v1:(location|bed|patient|medication|staff|order|dock):([a-z0-9]+(?:-[a-z0-9]+)*)$")
REQUIRED_LOCATIONS = frozenset({
    "LOC-PHARMACY",
    "LOC-NURSE-STATION",
    "LOC-ROOM-311",
    "LOC-ROOM-312",
    "LOC-ROOM-313",
    "LOC-ROOM-314",
    "LOC-SUPPLY",
    "LOC-LAB",
    "LOC-HOME",
    "LOC-CLEAN-UTILITY",
})
TRANSLATION_ACTIONS = frozenset({
    "FORWARD_PULSE",
    "BOUNDARY_TURN",
    "OBSTACLE_TURN",
    "SEARCH_TURN",
})
MAX_STEPS = 60
MAX_SECONDS = 300
SPEED = 1
FORWARD_SECONDS = 0.20
REVERSE_SECONDS = 0.22
TURN_SECONDS = 0.42
TURN_ANGLE = 25
TAPE_THRESHOLD = 1500
PAN_SEQUENCE = (0, -45, 0, 45)
TILT = 65
SEARCH_TURN_INTERVAL = 7
ROBOT = None


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_marker(payload):
    if not isinstance(payload, str):
        return None
    match = MARKER.fullmatch(payload)
    if match is None:
        return None
    return {"kind": match.group(1), "marker_id": match.group(2).upper(), "payload": payload}


def has_translation(actions):
    return any(item.get("action") in TRANSLATION_ACTIONS for item in actions)


class TopologicalMap:
    """Landmark graph derived only from robot observations and bounded actions."""

    def __init__(self, value=None):
        self.value = value or {
            "version": MAP_VERSION,
            "map_id": f"map-{uuid.uuid4()}",
            "created_at": utc_now(),
            "updated_at": utc_now(),
            "required_location_marker_ids": sorted(REQUIRED_LOCATIONS),
            "origin_marker_id": None,
            "current_location_marker_id": None,
            "nodes": {},
            "edges": [],
            "events": [],
            "pending_actions": [],
            "completed_runs": 0,
            "coverage_complete": False,
            "graph_connected": False,
            "missing_location_marker_ids": sorted(REQUIRED_LOCATIONS),
        }
        if self.value.get("version") != MAP_VERSION:
            raise ValueError("unsupported environment map version")
        self._refresh_completion()

    def action(self, step, action, **fields):
        item = {"step": step, "action": action, **fields}
        self.value["pending_actions"].append(item)
        self.value["events"].append({"at": utc_now(), "type": "action", **item})
        self.value["updated_at"] = utc_now()

    def observe(self, step, markers):
        normalized = []
        for raw in markers:
            marker = parse_marker(raw.get("payload"))
            if marker is None:
                continue
            marker["area"] = max(0.0, float(raw.get("area", 0.0)))
            marker["center_x"] = min(1.0, max(0.0, float(raw.get("center_x", 0.5))))
            marker["pan_angle"] = int(raw.get("pan_angle", 0))
            normalized.append(marker)

        for marker in normalized:
            marker_id = marker["marker_id"]
            node = self.value["nodes"].setdefault(marker_id, {
                "marker_id": marker_id,
                "kind": marker["kind"],
                "payload": marker["payload"],
                "first_seen_step": step,
                "last_seen_step": step,
                "observation_count": 0,
                "largest_observed_area": 0.0,
                "associated_location_marker_id": self.value["current_location_marker_id"],
            })
            node["last_seen_step"] = step
            node["observation_count"] += 1
            node["largest_observed_area"] = max(node["largest_observed_area"], marker["area"])

        locations = sorted(
            (marker for marker in normalized if marker["kind"] == "location"),
            key=lambda marker: marker["area"],
            reverse=True,
        )
        if locations:
            # The largest location code is the nearest supported landmark. Camera
            # pan alone must not manufacture a route edge.
            location = locations[0]["marker_id"]
            previous = self.value["current_location_marker_id"]
            if self.value["origin_marker_id"] is None:
                self.value["origin_marker_id"] = location
            if previous is not None and previous != location and has_translation(self.value["pending_actions"]):
                self.value["edges"].append({
                    "edge_id": f"edge-{len(self.value['edges']) + 1:04d}",
                    "from": previous,
                    "to": location,
                    "actions": list(self.value["pending_actions"]),
                    "observed_at": utc_now(),
                })
                self.value["pending_actions"] = []
            self.value["current_location_marker_id"] = location

        self.value["events"].append({
            "at": utc_now(),
            "type": "observation",
            "step": step,
            "markers": normalized,
        })
        self.value["updated_at"] = utc_now()
        self._refresh_completion()
        return normalized

    def _refresh_completion(self):
        discovered = {
            marker_id
            for marker_id, node in self.value["nodes"].items()
            if node.get("kind") == "location" and marker_id in REQUIRED_LOCATIONS
        }
        missing = REQUIRED_LOCATIONS - discovered
        adjacency = {marker_id: set() for marker_id in discovered}
        for edge in self.value["edges"]:
            source, target = edge.get("from"), edge.get("to")
            if source in adjacency and target in adjacency:
                adjacency[source].add(target)
                adjacency[target].add(source)
        reached = set()
        if discovered:
            pending = [next(iter(discovered))]
            while pending:
                marker_id = pending.pop()
                if marker_id in reached:
                    continue
                reached.add(marker_id)
                pending.extend(adjacency[marker_id] - reached)
        self.value["missing_location_marker_ids"] = sorted(missing)
        self.value["coverage_complete"] = not missing
        self.value["graph_connected"] = bool(discovered) and reached == discovered

    def is_complete(self):
        self._refresh_completion()
        return self.value["coverage_complete"] and self.value["graph_connected"]

    def finish_run(self, status):
        self.value["completed_runs"] += 1
        self.value["last_run_status"] = status
        self.value["updated_at"] = utc_now()
        self._refresh_completion()
        return self.value


def load_map(path=OUTPUT_PATH):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return TopologicalMap(json.load(handle))
    except FileNotFoundError:
        return TopologicalMap()


def save_map(mapper, path=OUTPUT_PATH):
    directory = os.path.dirname(path)
    os.makedirs(directory, mode=0o750, exist_ok=True)
    temporary = f"{path}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(mapper.value, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def capture_markers(step, pan_angle):
    import cv2
    from pyzbar import pyzbar

    path = f"/tmp/cras-map-scan-{step}.jpg"
    try:
        result = subprocess.run([
            "/usr/bin/rpicam-still", "--nopreview", "--timeout", "1200",
            "--width", "1296", "--height", "972", "--output", path,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=8, check=False)
        if result.returncode != 0:
            raise RuntimeError(f"map capture failed ({result.returncode})")
        image = cv2.imread(path)
        if image is None:
            raise RuntimeError("map capture unreadable")
        height, width = image.shape[:2]
        markers = []
        for barcode in pyzbar.decode(image):
            try:
                payload = barcode.data.decode("utf-8")
            except UnicodeDecodeError:
                continue
            if parse_marker(payload):
                x, _y, marker_width, marker_height = barcode.rect
                markers.append({
                    "payload": payload,
                    "area": (marker_width * marker_height) / (width * height),
                    "center_x": (x + marker_width / 2) / width,
                    "pan_angle": pan_angle,
                })
        return markers
    finally:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass


def stop_and_exit(signum, _frame):
    if ROBOT is not None:
        ROBOT.stop()
    raise SystemExit(128 + signum)


def tape_channels(grayscale, threshold=TAPE_THRESHOLD):
    if not isinstance(grayscale, (list, tuple)) or len(grayscale) != 3:
        raise ValueError("three grayscale readings are required")
    return tuple(index for index, value in enumerate(grayscale) if value < threshold)


def decide_motion(grayscale, distance, clear_pulses=0):
    tape = tape_channels(grayscale)
    if tape:
        if tape == (0,):
            return "BOUNDARY_TURN", "left_tape", -1
        if tape == (2,):
            return "BOUNDARY_TURN", "right_tape", 1
        return "BOUNDARY_TURN", "tape", 0
    if 0 < distance < 18:
        return "OBSTACLE_TURN", "obstacle", 0
    if clear_pulses > 0 and clear_pulses % SEARCH_TURN_INTERVAL == 0:
        return "SEARCH_TURN", "coverage", 0
    return "FORWARD_PULSE", "clear", 0


def retreat_turn(robot, direction):
    robot.stop()
    robot.set_dir_servo_angle(0)
    robot.backward(SPEED)
    time.sleep(REVERSE_SECONDS)
    robot.stop()
    robot.set_dir_servo_angle(direction * TURN_ANGLE)
    robot.forward(SPEED)
    time.sleep(TURN_SECONDS)
    robot.stop()
    robot.set_dir_servo_angle(0)


def search_turn(robot, direction):
    robot.stop()
    robot.set_dir_servo_angle(direction * TURN_ANGLE)
    robot.forward(SPEED)
    time.sleep(TURN_SECONDS)
    robot.stop()
    robot.set_dir_servo_angle(0)


def run_mapping():
    global ROBOT
    if os.environ.get("CRAS_ENABLE_ENVIRONMENT_MAPPING") != GATE:
        raise RuntimeError("environment mapping requires explicit ground-run confirmation")
    try:
        os.getlogin()
    except OSError:
        username = pwd.getpwuid(os.getuid()).pw_name
        os.getlogin = lambda: username
    from picarx import Picarx

    signal.signal(signal.SIGTERM, stop_and_exit)
    signal.signal(signal.SIGINT, stop_and_exit)
    mapper = load_map()
    started = time.monotonic()
    fallback_turn_direction = 1
    search_direction = 1
    clear_pulses = 0
    status = "incomplete_step_limit"
    try:
        ROBOT = Picarx()
        ROBOT.stop()
        ROBOT.set_cam_tilt_angle(TILT)
        for step in range(MAX_STEPS + 1):
            if time.monotonic() - started >= MAX_SECONDS:
                status = "incomplete_time_limit"
                break
            ROBOT.stop()
            pan = PAN_SEQUENCE[step % len(PAN_SEQUENCE)]
            ROBOT.set_cam_pan_angle(pan)
            time.sleep(0.5)
            observed = mapper.observe(step, capture_markers(step, pan))
            print(json.dumps({
                "event": "mapping.scan",
                "step": step,
                "pan": pan,
                "markers": observed,
                "missing_locations": mapper.value["missing_location_marker_ids"],
            }, separators=(",", ":")), flush=True)
            save_map(mapper)
            if mapper.is_complete():
                status = "complete"
                break
            if step == MAX_STEPS:
                break
            grayscale = ROBOT.get_grayscale_data()
            distance = ROBOT.get_distance()
            decision, reason, preferred_direction = decide_motion(grayscale, distance, clear_pulses)
            if decision in ("BOUNDARY_TURN", "OBSTACLE_TURN"):
                direction = preferred_direction or fallback_turn_direction
                fallback_turn_direction *= -1
                retreat_turn(ROBOT, direction)
                clear_pulses = 0
                mapper.action(
                    step, decision, reason=reason, direction=direction,
                    duration_ms=round((REVERSE_SECONDS + TURN_SECONDS) * 1000),
                    grayscale=grayscale, distance_cm=distance,
                )
            elif decision == "SEARCH_TURN":
                direction = search_direction
                search_direction *= -1
                search_turn(ROBOT, direction)
                clear_pulses = 0
                mapper.action(
                    step, decision, reason=reason, direction=direction,
                    duration_ms=round(TURN_SECONDS * 1000),
                    grayscale=grayscale, distance_cm=distance,
                )
            else:
                ROBOT.set_dir_servo_angle(0)
                ROBOT.forward(SPEED)
                time.sleep(FORWARD_SECONDS)
                ROBOT.stop()
                clear_pulses += 1
                mapper.action(
                    step, "FORWARD_PULSE", duration_ms=round(FORWARD_SECONDS * 1000),
                    grayscale=grayscale, distance_cm=distance,
                )
            save_map(mapper)
        return mapper.finish_run(status)
    finally:
        if ROBOT is not None:
            ROBOT.stop()
            ROBOT.set_dir_servo_angle(0)
            ROBOT.set_cam_pan_angle(0)
        save_map(mapper)


def main():
    value = run_mapping()
    print(json.dumps({
        "status": value.get("last_run_status"),
        "map_id": value["map_id"],
        "origin_marker_id": value["origin_marker_id"],
        "current_location_marker_id": value["current_location_marker_id"],
        "node_count": len(value["nodes"]),
        "edge_count": len(value["edges"]),
        "coverage_complete": value["coverage_complete"],
        "graph_connected": value["graph_connected"],
        "missing_location_marker_ids": value["missing_location_marker_ids"],
        "output_path": OUTPUT_PATH,
        "cleanup_completed": True,
    }, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
