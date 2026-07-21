#!/usr/bin/env python3
"""One bounded straight-line commissioning run; hardware-passive on import."""

import json
import os
import pwd
import signal
import time

GATE = "I_CONFIRM_ONE_SECOND_LINE_TEST"
SPEED = 1
MAX_SECONDS = 1.0
SAMPLE_INTERVAL_SECONDS = 0.02
SENSOR_SETTLE_SECONDS = 1.0
STEERING_ANGLE = 20
# Midpoints between the observed bare-floor and one-inch black-tape values.
LINE_REFERENCE = (1620, 1680, 2247)
ROBOT = None


def black_channels(values, reference=LINE_REFERENCE):
    if not isinstance(values, (list, tuple)) or len(values) != 3:
        raise ValueError("three grayscale readings are required")
    return tuple(value < reference[index] for index, value in enumerate(values))


def steering_for(values):
    """Use the vendor line-state ordering: center, left, right, or stop."""
    left, center, right = black_channels(values)
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


def run(controller, monotonic=time.monotonic, sleep=time.sleep):
    controller.stop()
    controller.set_dir_servo_angle(0)
    sleep(SENSOR_SETTLE_SECONDS)
    initial = controller.get_grayscale_data()
    if steering_for(initial) is None:
        return {
            "status": "blocked",
            "reason": "line_not_detected",
            "initial_grayscale": initial,
            "samples": 1,
            "cleanup_completed": True,
        }

    started = monotonic()
    samples = 0
    last = initial
    status = "completed"
    reason = "time_limit"
    try:
        while monotonic() - started < MAX_SECONDS:
            last = controller.get_grayscale_data()
            samples += 1
            steering = steering_for(last)
            if steering is None:
                status = "stopped"
                reason = "line_lost"
                break
            controller.set_dir_servo_angle(steering)
            controller.forward(SPEED)
            sleep(SAMPLE_INTERVAL_SECONDS)
    finally:
        controller.stop()
        controller.set_dir_servo_angle(0)
    return {
        "status": status,
        "reason": reason,
        "initial_grayscale": initial,
        "last_grayscale": last,
        "samples": samples,
        "cleanup_completed": True,
    }


def main():
    global ROBOT
    if os.environ.get("CRAS_ENABLE_LINE_FOLLOW_TEST") != GATE:
        raise RuntimeError("line-follow test requires explicit physical authorization")
    try:
        os.getlogin()
    except OSError:
        username = pwd.getpwuid(os.getuid()).pw_name
        os.getlogin = lambda: username
    from picarx import Picarx

    signal.signal(signal.SIGTERM, stop_and_exit)
    signal.signal(signal.SIGINT, stop_and_exit)
    try:
        ROBOT = Picarx()
        result = run(ROBOT)
        print(json.dumps(result, separators=(",", ":")), flush=True)
    finally:
        if ROBOT is not None:
            ROBOT.stop()
            ROBOT.set_dir_servo_angle(0)


if __name__ == "__main__":
    main()
