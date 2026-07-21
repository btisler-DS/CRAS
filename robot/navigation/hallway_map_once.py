#!/usr/bin/env python3
"""One bounded main-line facility mapping behavior; passive on import."""

import json
import os
import pwd
import re
import signal
import subprocess
import time
import uuid
from datetime import datetime, timezone

GATE = "I_CONFIRM_MAIN_HALLWAY_MAPPING"
OUTPUT_PATH = "/var/lib/cras-robot/maps/hallway-map-v1.json"
REQUIRED = frozenset({
    "LOC-PHARMACY", "LOC-NURSE-STATION", "LOC-ROOM-311",
    "LOC-ROOM-312", "LOC-ROOM-313", "LOC-ROOM-314",
    "LOC-SUPPLY", "LOC-LAB", "LOC-CLEAN-UTILITY", "LOC-HOME",
})
MARKER = re.compile(r"^cras:v1:location:([a-z0-9]+(?:-[a-z0-9]+)*)$")
LINE_REFERENCE = (1620, 1680, 2247)
SPEED = 1
STEERING_ANGLE = 20
SEGMENT_SECONDS = 0.60
SAMPLE_SECONDS = 0.02
MAX_SEGMENTS = 24
MAX_SECONDS = 240
PAN_ANGLES = (-60, 0, 60)
TILT_ANGLE = 65
ROBOT = None


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def marker_id(payload):
    match = MARKER.fullmatch(payload) if isinstance(payload, str) else None
    return f"LOC-{match.group(1).upper()}" if match else None


def steering_for(values):
    if not isinstance(values, (list, tuple)) or len(values) != 3:
        raise ValueError("three grayscale readings are required")
    left, center, right = (
        values[index] < LINE_REFERENCE[index] for index in range(3)
    )
    if center:
        return 0
    if left:
        return -STEERING_ANGLE
    if right:
        return STEERING_ANGLE
    return None


def stop_and_exit(signum, _frame):
    if ROBOT is not None:
        ROBOT.stop()
    raise SystemExit(128 + signum)


def atomic_save(value):
    os.makedirs(os.path.dirname(OUTPUT_PATH), mode=0o750, exist_ok=True)
    temporary = OUTPUT_PATH + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, OUTPUT_PATH)


def capture_locations(segment, pan):
    from pyzbar import pyzbar
    import cv2

    path = f"/tmp/cras-hall-map-{segment}-{pan}.jpg"
    try:
        result = subprocess.run([
            "/usr/bin/rpicam-still", "--nopreview", "--timeout", "900",
            "--width", "1296", "--height", "972", "--output", path,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=8, check=False)
        if result.returncode != 0:
            raise RuntimeError(f"camera capture failed ({result.returncode})")
        image = cv2.imread(path)
        if image is None:
            raise RuntimeError("camera frame unreadable")
        found = []
        for barcode in pyzbar.decode(image):
            try:
                payload = barcode.data.decode("utf-8")
            except UnicodeDecodeError:
                continue
            location = marker_id(payload)
            if location in REQUIRED:
                found.append(location)
        return sorted(set(found))
    finally:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass


def scan(robot, segment):
    observed = []
    for pan in PAN_ANGLES:
        robot.stop()
        robot.set_cam_pan_angle(pan)
        time.sleep(0.35)
        locations = capture_locations(segment, pan)
        observed.append({"pan": pan, "locations": locations})
    robot.set_cam_pan_angle(0)
    return observed


def follow_segment(robot):
    started = time.monotonic()
    samples = 0
    last = None
    while time.monotonic() - started < SEGMENT_SECONDS:
        last = robot.get_grayscale_data()
        samples += 1
        steering = steering_for(last)
        if steering is None:
            robot.stop()
            robot.set_dir_servo_angle(0)
            return {"status": "line_lost", "samples": samples, "last_grayscale": last}
        robot.set_dir_servo_angle(steering)
        robot.forward(SPEED)
        time.sleep(SAMPLE_SECONDS)
    robot.stop()
    robot.set_dir_servo_angle(0)
    return {"status": "segment_complete", "samples": samples, "last_grayscale": last}


def run():
    global ROBOT
    if os.environ.get("CRAS_ENABLE_HALLWAY_MAPPING") != GATE:
        raise RuntimeError("hallway mapping requires explicit physical authorization")
    try:
        os.getlogin()
    except OSError:
        username = pwd.getpwuid(os.getuid()).pw_name
        os.getlogin = lambda: username
    from picarx import Picarx

    signal.signal(signal.SIGTERM, stop_and_exit)
    signal.signal(signal.SIGINT, stop_and_exit)
    value = {
        "version": "HALLWAY_MAP_V1",
        "map_id": f"map-{uuid.uuid4()}",
        "started_at": now(),
        "completed_at": None,
        "status": "running",
        "required_locations": sorted(REQUIRED),
        "observed_locations": [],
        "missing_locations": sorted(REQUIRED),
        "junction_observations": [],
        "motion_segments": [],
        "cleanup_completed": False,
    }
    observed_set = set()
    started = time.monotonic()
    try:
        ROBOT = Picarx()
        ROBOT.stop()
        ROBOT.set_dir_servo_angle(0)
        ROBOT.set_cam_tilt_angle(TILT_ANGLE)
        time.sleep(1.0)
        if steering_for(ROBOT.get_grayscale_data()) is None:
            value["status"] = "blocked_line_not_detected"
            return value

        for segment in range(MAX_SEGMENTS + 1):
            if time.monotonic() - started >= MAX_SECONDS:
                value["status"] = "incomplete_time_limit"
                break
            ROBOT.stop()
            observations = scan(ROBOT, segment)
            newly_seen = []
            for observation in observations:
                for location in observation["locations"]:
                    if location not in observed_set:
                        newly_seen.append(location)
                    observed_set.add(location)
            value["junction_observations"].append({
                "segment": segment, "at": now(), "views": observations,
                "new_locations": newly_seen,
            })
            value["observed_locations"] = sorted(observed_set)
            value["missing_locations"] = sorted(REQUIRED - observed_set)
            atomic_save(value)
            print(json.dumps({
                "event": "hallway.scan", "segment": segment,
                "new_locations": newly_seen,
                "observed_locations": value["observed_locations"],
                "missing_locations": value["missing_locations"],
            }, separators=(",", ":")), flush=True)
            if not value["missing_locations"]:
                value["status"] = "complete"
                break
            if segment == MAX_SEGMENTS:
                value["status"] = "incomplete_segment_limit"
                break
            motion = follow_segment(ROBOT)
            motion.update({"segment": segment + 1, "at": now()})
            value["motion_segments"].append(motion)
            atomic_save(value)
            print(json.dumps({"event": "hallway.motion", **motion}, separators=(",", ":")), flush=True)
            if motion["status"] == "line_lost":
                value["status"] = "incomplete_line_end"
                break
        return value
    finally:
        if ROBOT is not None:
            ROBOT.stop()
            ROBOT.set_dir_servo_angle(0)
            ROBOT.set_cam_pan_angle(0)
        value["completed_at"] = now()
        value["cleanup_completed"] = True
        atomic_save(value)


def main():
    value = run()
    print(json.dumps({
        "status": value["status"], "map_id": value["map_id"],
        "observed_locations": value["observed_locations"],
        "missing_locations": value["missing_locations"],
        "motion_segment_count": len(value["motion_segments"]),
        "output_path": OUTPUT_PATH,
        "cleanup_completed": value["cleanup_completed"],
    }, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
