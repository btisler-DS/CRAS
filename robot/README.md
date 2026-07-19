# Robot-local deployment artifacts

Only this directory is deployed to the PiCar-X host. The Next.js application,
SQLite evidence repository, authorization kernel, and dispatcher remain on the
CRAS server.

- `audio/microphone_once.py`: one gated, bounded, non-retaining Vosk capture.
- `audio/tone_once.py`: one gated tone through the verified Robot HAT PyAudio path.
- `worker/cras_robot_worker.py`: loopback-only authenticated, replay-protected worker for the single canonical physical demonstration action.
- `systemd/cras-robot-worker.service`: supervised worker with a restricted filesystem view.

The worker has no generic movement endpoint. It admits only an HMAC-authenticated
dispatch envelope for medication delivery to Room 312 and maps it to one fixed,
one-second, minimum-speed wheel-off-ground maneuver. Motors are stopped in `finally`.
