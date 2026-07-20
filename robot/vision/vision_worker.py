#!/usr/bin/env python3
"""Loopback-only observational OV5647 MJPEG worker; no actuator imports."""

import json
import signal
import subprocess
import threading
import time
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = "127.0.0.1"
PORT = 9400
WIDTH = 640
HEIGHT = 480
TARGET_FPS = 15
MAX_FRAME_BYTES = 2 * 1024 * 1024
RPICAM_VID = "/usr/bin/rpicam-vid"
RPICAM_HELLO = "/usr/bin/rpicam-hello"


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class CameraOwner:
    def __init__(self):
        self.lock = threading.RLock()
        self.condition = threading.Condition(self.lock)
        self.process = None
        self.frame = None
        self.frame_sequence = 0
        self.last_frame_at = None
        self.frame_times = deque(maxlen=30)
        self.error = None

    def status(self):
        with self.lock:
            active = self.process is not None and self.process.poll() is None
            measured = 0.0
            if len(self.frame_times) >= 2:
                elapsed = self.frame_times[-1] - self.frame_times[0]
                if elapsed > 0:
                    measured = (len(self.frame_times) - 1) / elapsed
            return active, round(measured, 1), self.last_frame_at, self.error

    def start(self):
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                return False
            self.error = None
            self.frame = None
            self.frame_sequence = 0
            self.frame_times.clear()
            command = [
                RPICAM_VID,
                "--nopreview",
                "--codec", "mjpeg",
                "--width", str(WIDTH),
                "--height", str(HEIGHT),
                "--framerate", str(TARGET_FPS),
                "--timeout", "0",
                "--output", "-",
            ]
            self.process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                shell=False,
                start_new_session=True,
            )
            process = self.process
            threading.Thread(target=self._read_frames, args=(process,), daemon=True).start()
            threading.Thread(target=self._read_errors, args=(process,), daemon=True).start()
            return True

    def stop(self):
        with self.lock:
            process = self.process
            changed = process is not None and process.poll() is None
        if changed:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=1)
        with self.lock:
            self.process = None
            self.condition.notify_all()
        return changed

    def wait_frame(self, after_sequence, timeout=5):
        deadline = time.monotonic() + timeout
        with self.condition:
            while self.frame_sequence <= after_sequence:
                active = self.process is not None and self.process.poll() is None
                remaining = deadline - time.monotonic()
                if not active or remaining <= 0:
                    return None, self.frame_sequence
                self.condition.wait(remaining)
            return self.frame, self.frame_sequence

    def _read_frames(self, process):
        buffer = bytearray()
        try:
            while True:
                chunk = process.stdout.read(64 * 1024)
                if not chunk:
                    break
                buffer.extend(chunk)
                while True:
                    start = buffer.find(b"\xff\xd8")
                    if start < 0:
                        if len(buffer) > 1:
                            del buffer[:-1]
                        break
                    end = buffer.find(b"\xff\xd9", start + 2)
                    if end < 0:
                        if start > 0:
                            del buffer[:start]
                        if len(buffer) > MAX_FRAME_BYTES:
                            raise RuntimeError("camera frame exceeded size limit")
                        break
                    frame = bytes(buffer[start:end + 2])
                    del buffer[:end + 2]
                    with self.condition:
                        self.frame = frame
                        self.frame_sequence += 1
                        self.last_frame_at = utc_now()
                        self.frame_times.append(time.monotonic())
                        self.condition.notify_all()
        except Exception as error:
            with self.lock:
                self.error = f"{type(error).__name__}: {error}"[:300]
        finally:
            with self.condition:
                if self.process is process:
                    self.process = None
                self.condition.notify_all()

    def _read_errors(self, process):
        tail = deque(maxlen=12)
        for line in iter(process.stderr.readline, b""):
            tail.append(line.decode("utf-8", errors="replace").strip())
        if process.poll() not in (None, 0) and tail:
            with self.lock:
                self.error = " | ".join(tail)[-500:]


OWNER = CameraOwner()


def camera_detected():
    try:
        result = subprocess.run(
            [RPICAM_HELLO, "--list-cameras"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
        return result.returncode == 0 and "ov5647" in (result.stdout + result.stderr).lower()
    except (OSError, subprocess.TimeoutExpired):
        return False


class Handler(BaseHTTPRequestHandler):
    server_version = "cras-vision-worker/1"

    def log_message(self, format, *args):
        print(json.dumps({"event": "vision.worker.http", "message": format % args}), flush=True)

    def reply(self, status, value):
        body = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            active, fps, last_frame_at, error = OWNER.status()
            detected = camera_detected()
            return self.reply(200, {
                "service": "cras-vision-worker",
                "status": "ok" if detected and error is None else "degraded",
                "camera_detected": detected,
                "camera_active": active,
                "sensor": "ov5647" if detected else None,
                "resolution": {"width": WIDTH, "height": HEIGHT},
                "target_fps": TARGET_FPS,
                "measured_fps": fps,
                "last_frame_at": last_frame_at,
                "error": error,
            })
        if self.path == "/stream.mjpg":
            active, _, _, _ = OWNER.status()
            if not active:
                return self.reply(409, {"error": {"code": "STREAM_INACTIVE", "message": "Camera stream is stopped.", "retryable": True}})
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            sequence = 0
            try:
                while True:
                    frame, sequence = OWNER.wait_frame(sequence)
                    if frame is None:
                        break
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(frame)).encode() + b"\r\n\r\n")
                    self.wfile.write(frame + b"\r\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        self.reply(404, {"error": {"code": "BAD_REQUEST", "message": "Not found.", "retryable": False}})

    def do_POST(self):
        if self.path == "/stream/start":
            changed = OWNER.start()
            return self.reply(200, {"camera_active": True, "changed": changed})
        if self.path == "/stream/stop":
            changed = OWNER.stop()
            return self.reply(200, {"camera_active": False, "changed": changed})
        self.reply(404, {"error": {"code": "BAD_REQUEST", "message": "Not found.", "retryable": False}})


def shutdown(signum=None, frame=None):
    OWNER.stop()
    if signum is not None:
        raise SystemExit(128 + signum)


def main():
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(json.dumps({"event": "vision.worker.ready", "bind": f"{HOST}:{PORT}", "camera_initialized": False}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
