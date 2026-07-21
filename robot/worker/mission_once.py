#!/usr/bin/env python3
"""Fixed Pharmacy -> Room 312 -> Home mission; hardware-passive on import."""

import json
import os
import pwd
import signal
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

BEHAVIOR_ID = "MEDICATION_DELIVERY_MISSION_V1"
START = "LOC-PHARMACY"
DESTINATION = "LOC-ROOM-312"
HOME = "LOC-HOME"
VISION_BASE_URL = "http://127.0.0.1:9400"
MISSION_LOG_DIRECTORY = "/var/lib/cras-robot/missions"
LINE_REFERENCE = (1620, 1680, 2247)
SPEED = 1
STEERING_ANGLE = 12
SAMPLE_SECONDS = 0.02
INTERSECTION_GRACE_SECONDS = 0.55
OBSERVATION_POLL_SECONDS = 0.20
TRACK_POLL_SECONDS = 0.12
DELIVERY_HOLD_SECONDS = 1.0
MAX_SECONDS = 150.0
MIN_MARKER_WIDTH = 0.055
TRACK_REFERENCE = 0.055
TRACK_CONFIDENCE_MINIMUM = 8.0
MAX_CAMERA_STEERING = 10
TILT_ANGLE = 65
ROBOT = None


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def stop_and_exit(signum, _frame):
    if ROBOT is not None:
        ROBOT.stop()
    raise SystemExit(128 + signum)


def black_channels(values, reference=LINE_REFERENCE):
    if not isinstance(values, (list, tuple)) or len(values) != 3:
        raise ValueError("three grayscale readings are required")
    return tuple(values[index] < reference[index] for index in range(3))


def steering_for(values, seconds_since_center):
    """Follow the main line while crossing perpendicular black branch lines.

    A side sensor appearing briefly after the center sensor is treated as a
    perpendicular junction, not a command to enter the room. Persistent
    left/right readings are small recentering corrections.
    """
    left, center, right = black_channels(values)
    if center or (left and right):
        return 0, center
    if not left and not right:
        return None, False
    if seconds_since_center <= INTERSECTION_GRACE_SECONDS:
        return 0, False
    return (-STEERING_ANGLE if left else STEERING_ANGLE), False


def marker_width(observation):
    corners = observation.get("corners")
    if not isinstance(corners, list) or len(corners) != 4:
        return 0.0
    try:
        xs = [float(point["x"]) for point in corners]
    except (KeyError, TypeError, ValueError):
        return 0.0
    return max(xs) - min(xs)


def location_from_observation(observation):
    if not isinstance(observation, dict) or observation.get("kind") != "location":
        return None
    marker_id = observation.get("marker_id")
    if not isinstance(marker_id, str) or not marker_id:
        return None
    return marker_id if marker_id.startswith("LOC-") else f"LOC-{marker_id}"


def nearby_locations(observations):
    found = set()
    for observation in observations:
        location = location_from_observation(observation)
        if location is not None and marker_width(observation) >= MIN_MARKER_WIDTH:
            found.add(location)
    return sorted(found)


def detect_track(jpeg):
    """Locate the dark, low-chroma black route in the lower camera view."""
    import cv2
    import numpy

    encoded = numpy.frombuffer(jpeg, dtype=numpy.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError("camera track frame could not be decoded")
    height, width = image.shape[:2]
    x0, x1 = int(width * 0.30), int(width * 0.70)
    y0, y1 = int(height * 0.82), int(height * 0.98)
    roi = image[y0:y1, x0:x1].astype(numpy.float32)
    luminance = roi.mean(axis=2)
    chroma = roi.max(axis=2) - roi.min(axis=2)
    score = (luminance + 0.8 * chroma).mean(axis=0)
    window = max(9, int(width * 0.024) | 1)
    smoothed = numpy.convolve(score, numpy.ones(window) / window, mode="same")
    trim = window
    usable = smoothed[trim:-trim]
    if usable.size == 0:
        raise RuntimeError("camera track frame is too small")
    column = int(numpy.argmin(usable)) + trim
    absolute_x = x0 + column
    normalized = (absolute_x - width / 2.0) / (width / 2.0)
    confidence = float(numpy.median(usable) - smoothed[column])
    return {
        "offset": round(normalized - TRACK_REFERENCE, 6),
        "confidence": round(confidence, 3),
        "column": absolute_x,
        "frame_width": width,
    }


def camera_steering(track):
    if track["confidence"] < TRACK_CONFIDENCE_MINIMUM:
        return None
    requested = int(round(track["offset"] * 100.0))
    return max(-MAX_CAMERA_STEERING, min(MAX_CAMERA_STEERING, requested))


class VisionObservationClient:
    """Fixed loopback client for the observation-only camera worker."""

    def __init__(self, base_url=VISION_BASE_URL, opener=urllib.request.urlopen):
        self.base_url = base_url.rstrip("/")
        self.opener = opener
        self.cursor = 0
        self.owns_scanner = False

    def _request(self, method, path):
        request = urllib.request.Request(self.base_url + path, method=method)
        try:
            with self.opener(request, timeout=2.0) as response:
                if response.status != 200:
                    raise RuntimeError(f"vision worker returned {response.status}")
                value = json.loads(response.read().decode("utf-8"))
        except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
            raise RuntimeError(f"vision worker unavailable: {type(error).__name__}") from error
        if not isinstance(value, dict):
            raise RuntimeError("vision worker returned an invalid response")
        return value

    def start(self):
        value = self._request("POST", "/markers/start")
        if value.get("marker_scanner_active") is not True:
            raise RuntimeError("marker scanner did not become active")
        self.owns_scanner = value.get("changed") is True
        # Establish a fresh cursor so stale observations from an earlier run
        # cannot localize or complete this mission.
        existing = self._request("GET", "/markers/observations?after=0").get("observations", [])
        for observation in existing if isinstance(existing, list) else []:
            sequence = observation.get("sequence") if isinstance(observation, dict) else None
            if isinstance(sequence, int):
                self.cursor = max(self.cursor, sequence)

    def poll(self):
        value = self._request("GET", f"/markers/observations?after={self.cursor}")
        observations = value.get("observations")
        if not isinstance(observations, list):
            raise RuntimeError("vision worker returned invalid observations")
        for observation in observations:
            sequence = observation.get("sequence") if isinstance(observation, dict) else None
            if isinstance(sequence, int):
                self.cursor = max(self.cursor, sequence)
        return observations

    def stop(self):
        if self.owns_scanner:
            self._request("POST", "/markers/stop")
            self.owns_scanner = False

    def frame(self):
        request = urllib.request.Request(self.base_url + "/frame.jpg", method="GET")
        try:
            with self.opener(request, timeout=1.0) as response:
                if response.status != 200:
                    raise RuntimeError(f"vision worker returned {response.status}")
                value = response.read(2 * 1024 * 1024 + 1)
        except (OSError, urllib.error.URLError) as error:
            raise RuntimeError(f"vision frame unavailable: {type(error).__name__}") from error
        if len(value) > 2 * 1024 * 1024 or not value.startswith(b"\xff\xd8"):
            raise RuntimeError("vision worker returned an invalid frame")
        return value


class MissionLog:
    def __init__(self, mission_run_id, directory=MISSION_LOG_DIRECTORY):
        os.makedirs(directory, mode=0o750, exist_ok=True)
        self.path = os.path.join(directory, f"{mission_run_id}.jsonl")

    def append(self, event):
        with open(self.path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, separators=(",", ":")) + "\n")
            handle.flush()
            os.fsync(handle.fileno())


def run(
    robot,
    vision,
    monotonic=time.monotonic,
    sleep=time.sleep,
    event_sink=lambda _event: None,
    mission_run_id=None,
):
    mission_run_id = mission_run_id or f"physical-mission-{uuid.uuid4()}"
    started = monotonic()
    last_center_at = started
    last_poll_at = float("-inf")
    last_track_at = float("-inf")
    delivered = False
    samples = 0
    events = []

    def record(event, **detail):
        value = {
            "sequence": len(events) + 1,
            "event": event,
            "occurred_at": utc_now(),
            **detail,
        }
        events.append(value)
        event_sink(value)

    def poll_locations():
        nonlocal last_poll_at
        last_poll_at = monotonic()
        observations = vision.poll()
        locations = nearby_locations(observations)
        if locations:
            record("mission.locations.observed", locations=locations)
        return locations

    robot.stop()
    robot.set_dir_servo_angle(0)
    robot.set_cam_pan_angle(0)
    robot.set_cam_tilt_angle(TILT_ANGLE)
    vision.start()
    record("mission.started", mission_run_id=mission_run_id, behavior_id=BEHAVIOR_ID)

    # Pharmacy is the declared, operator-staged origin of this one bounded
    # behavior. Physical QR markers independently confirm destination and
    # return; they are not organizational authorization data.
    record("mission.start.staged", location=START, source="protected-behavior-contract")
    initial_track = detect_track(vision.frame())
    initial_steering = camera_steering(initial_track)
    if initial_steering is None:
        record("mission.blocked", reason="black_route_not_confirmed", track=initial_track)
        return {
            "status": "failed",
            "reason": "black_route_not_confirmed",
            "mission_run_id": mission_run_id,
            "events": events,
        }
    record("mission.route.confirmed", track=initial_track)
    record("mission.motion.started", speed=SPEED, route="main-hallway")
    try:
        while monotonic() - started < MAX_SECONDS:
            now = monotonic()
            readings = robot.get_grayscale_data()
            samples += 1
            steering, center_seen = steering_for(readings, now - last_center_at)
            if center_seen:
                last_center_at = now
            if steering is None:
                record("mission.motion.stopped", reason="black_route_lost", grayscale=readings)
                return {
                    "status": "failed",
                    "reason": "black_route_lost",
                    "mission_run_id": mission_run_id,
                    "events": events,
                }
            if now - last_track_at >= TRACK_POLL_SECONDS:
                robot.stop()
                track = detect_track(vision.frame())
                camera_angle = camera_steering(track)
                if camera_angle is None:
                    record("mission.motion.stopped", reason="black_route_camera_lost", track=track)
                    return {
                        "status": "failed",
                        "reason": "black_route_camera_lost",
                        "mission_run_id": mission_run_id,
                        "events": events,
                    }
                steering = camera_angle
                last_track_at = monotonic()

            if now - last_poll_at >= OBSERVATION_POLL_SECONDS:
                robot.stop()
                locations = poll_locations()
                if not delivered and DESTINATION in locations:
                    robot.stop()
                    delivered = True
                    record("mission.delivery.confirmed", location=DESTINATION, samples=samples)
                    sleep(DELIVERY_HOLD_SECONDS)
                    last_center_at = monotonic()
                    record("mission.return.started", destination=HOME)
                elif delivered and HOME in locations:
                    robot.stop()
                    robot.set_dir_servo_angle(0)
                    record("mission.home.confirmed", location=HOME, samples=samples)
                    record("mission.completed", final_position="home-base")
                    return {
                        "status": "executed",
                        "reason": "mission_complete",
                        "mission_run_id": mission_run_id,
                        "final_position": "home-base",
                        "delivery_location": DESTINATION,
                        "events": events,
                    }
            robot.set_dir_servo_angle(steering)
            robot.forward(SPEED)
            sleep(SAMPLE_SECONDS)
    finally:
        robot.stop()
        robot.set_dir_servo_angle(0)

    record("mission.motion.stopped", reason="mission_timeout", samples=samples)
    return {
        "status": "failed",
        "reason": "mission_timeout",
        "mission_run_id": mission_run_id,
        "events": events,
    }


def main():
    global ROBOT
    try:
        os.getlogin()
    except OSError:
        username = pwd.getpwuid(os.getuid()).pw_name
        os.getlogin = lambda: username
    from picarx import Picarx

    signal.signal(signal.SIGTERM, stop_and_exit)
    signal.signal(signal.SIGINT, stop_and_exit)
    result = None
    vision = VisionObservationClient()
    mission_log = None
    try:
        ROBOT = Picarx()
        mission_run_id = f"physical-mission-{uuid.uuid4()}"
        mission_log = MissionLog(mission_run_id)
        result = run(
            ROBOT,
            vision,
            event_sink=mission_log.append,
            mission_run_id=mission_run_id,
        )
        result["mission_log"] = mission_log.path
    finally:
        if ROBOT is not None:
            ROBOT.stop()
            ROBOT.set_dir_servo_angle(0)
            ROBOT.set_cam_pan_angle(0)
        try:
            vision.stop()
        except Exception:
            if result is not None:
                result["vision_cleanup_failed"] = True
    if result is None:
        raise RuntimeError("mission produced no result")
    result["behavior_id"] = BEHAVIOR_ID
    result["cleanup_completed"] = not result.get("vision_cleanup_failed", False)
    print(json.dumps(result, separators=(",", ":")), flush=True)
    if result["status"] != "executed" or not result["cleanup_completed"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
