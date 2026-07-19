#!/usr/bin/env python3
"""One gated Robot HAT tone using the verified PyAudio-backed vendor path."""
import os, subprocess, sys

GATE = "I_UNDERSTAND_THIS_PLAYS_AUDIO"

def main():
    if os.environ.get("CRAS_ENABLE_ROBOT_HAT_TONE_TEST") != GATE:
        raise SystemExit("speaker gate not enabled")
    from robot_hat import Music, disable_speaker, enable_speaker
    pin_state = subprocess.run(["pinctrl", "get", "20"], capture_output=True, text=True, check=True).stdout
    try:
        enable_speaker()
        Music.__new__(Music).play_tone_for(440, 1)
    finally:
        disable_speaker()
        # The verified idle state before speaker tests is PCM_DIN (a0), pull-down.
        subprocess.run(["pinctrl", "set", "20", "a0", "pd"], check=True, timeout=2)
    print('{"status":"completed","engine":"robot-hat-music-pyaudio","cleanup_completed":true}')
    return 0

if __name__ == "__main__":
    sys.exit(main())
