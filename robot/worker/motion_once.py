#!/usr/bin/env python3
"""Fixed one-action child. Intended only for the authenticated CRAS worker."""
import signal
import time
import os
import pwd

ROBOT = None

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
        ROBOT.set_motor_speed(1, 1)
        ROBOT.set_motor_speed(2, 1)
        time.sleep(1.0)
    finally:
        if ROBOT is not None:
            ROBOT.stop()
    print("CRAS_MOTION_COMPLETED")

if __name__ == "__main__":
    main()
