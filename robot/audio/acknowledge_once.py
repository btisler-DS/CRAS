#!/usr/bin/env python3
"""Play one fixed CRAS acknowledgment; arguments cannot select tone parameters."""

import json
import subprocess
import sys
import time


PATTERNS = {
    "ATTENTION": ((440, 0.15),),
    "INSTRUCTION_RECEIVED": ((440, 0.12), (440, 0.12)),
    "AUTHORIZED": ((660, 0.50),),
    "MISSION_COMPLETED": ((660, 0.12), (660, 0.12), (660, 0.12)),
}
INTER_TONE_SECONDS = 0.12


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in PATTERNS:
        raise SystemExit("one supported acknowledgment type is required")

    acknowledgment = sys.argv[1]
    # Hardware imports remain inside the explicitly invoked child process.
    from robot_hat import Music, disable_speaker, enable_speaker

    subprocess.run(
        ["pinctrl", "get", "20"],
        capture_output=True,
        text=True,
        check=True,
        timeout=2,
    )
    try:
        enable_speaker()
        music = Music.__new__(Music)
        pattern = PATTERNS[acknowledgment]
        for index, (frequency, duration) in enumerate(pattern):
            music.play_tone_for(frequency, duration)
            if index + 1 < len(pattern):
                time.sleep(INTER_TONE_SECONDS)
    finally:
        disable_speaker()
        # Verified Robot HAT V4 idle state: GPIO20 PCM_DIN (a0), pull-down.
        subprocess.run(
            ["pinctrl", "set", "20", "a0", "pd"],
            check=True,
            timeout=2,
        )

    print(
        json.dumps(
            {
                "status": "completed",
                "acknowledgment": acknowledgment,
                "cleanup_completed": True,
            },
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
