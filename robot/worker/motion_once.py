#!/usr/bin/env python3
"""Fixed one-action child. Intended only for the authenticated CRAS worker."""
import signal
import time
import os
import pwd

ROBOT = None
LEFT_MOTOR = 1
RIGHT_MOTOR = 2
SPEED = 1
DURATION_SECONDS = 1.0

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
        time.sleep(DURATION_SECONDS)
    finally:
        if ROBOT is not None:
            ROBOT.stop()
    print("CRAS_MOTION_COMPLETED")

if __name__ == "__main__":
    main()
