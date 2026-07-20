#!/usr/bin/env python3
"""Fixed round-trip child. Intended only for the authenticated CRAS worker."""
import signal
import time
import os
import pwd

ROBOT = None
LEFT_MOTOR = 1
RIGHT_MOTOR = 2
SPEED = 1
OUTBOUND_DURATION_SECONDS = 1.0
STOPPED_PAUSE_SECONDS = 0.5
RETURN_SPEED = -1
RETURN_DURATION_SECONDS = 1.0

def stop_and_exit(signum, frame):
    if ROBOT is not None:
        ROBOT.stop()
    raise SystemExit(128 + signum)

def main():
    global ROBOT
    try:
        os.getlogin()
    except OSError:
        service_user = pwd.getpwuid(os.getuid()).pw_name
        os.getlogin = lambda: service_user
    from picarx import Picarx
    signal.signal(signal.SIGTERM, stop_and_exit)
    signal.signal(signal.SIGINT, stop_and_exit)
    try:
        ROBOT = Picarx()
        ROBOT.set_motor_speed(LEFT_MOTOR, SPEED)
        ROBOT.set_motor_speed(RIGHT_MOTOR, SPEED)
        time.sleep(OUTBOUND_DURATION_SECONDS)
        ROBOT.stop()
        time.sleep(STOPPED_PAUSE_SECONDS)
        ROBOT.set_motor_speed(LEFT_MOTOR, RETURN_SPEED)
        ROBOT.set_motor_speed(RIGHT_MOTOR, RETURN_SPEED)
        time.sleep(RETURN_DURATION_SECONDS)
    finally:
        if ROBOT is not None:
            ROBOT.stop()
    print("CRAS_MOTION_COMPLETED")

if __name__ == "__main__":
    main()
