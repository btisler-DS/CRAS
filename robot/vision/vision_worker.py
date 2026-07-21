#!/usr/bin/env python3
"""Loopback-only observational OV5647 MJPEG worker; no actuator imports."""

import json
import re
import signal
import subprocess
import threading
import time
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


HOST = "127.0.0.1"
PORT = 9400
WIDTH = 640
HEIGHT = 480
TARGET_FPS = 15
MAX_FRAME_BYTES = 2 * 1024 * 1024
RPICAM_VID = "/usr/bin/rpicam-vid"
RPICAM_HELLO = "/usr/bin/rpicam-hello"
RPICAM_STILL = "/usr/bin/rpicam-still"
MARKER_SCAN_WIDTH = 1296
MARKER_SCAN_HEIGHT = 972
MARKER_PAYLOAD = re.compile(
    r"^cras:v1:(location|bed|patient|medication|staff|order|dock):([a-z0-9]+(?:-[a-z0-9]+)*)$"
)
MAX_OBSERVATIONS = 128
MARKER_DEBOUNCE_SECONDS = 1.5


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def normalized_coordinate(value, extent):
    return round(min(1.0, max(0.0, float(value) / float(extent))), 6)


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


def parse_marker_payload(payload):
    """Parse only the bounded CRAS marker namespace; never grant authority."""
    if not isinstance(payload, str) or len(payload) > 200:
        return None
    match = MARKER_PAYLOAD.fullmatch(payload)
    if match is None:
        return None
    kind, marker_id = match.groups()
    return {"kind": kind, "marker_id": marker_id.upper()}


class OpenCvQrDecoder:
    """OpenCV detector with the installed Vilib/pyzbar recognition fallback."""

    def __init__(self):
        import cv2
        import numpy

        self.cv2 = cv2
        self.numpy = numpy
        self.detector = cv2.QRCodeDetector()
        try:
            from pyzbar import pyzbar
            self.pyzbar = pyzbar
        except ImportError:
            self.pyzbar = None

    def decode(self, jpeg):
        encoded = self.numpy.frombuffer(jpeg, dtype=self.numpy.uint8)
        image = self.cv2.imdecode(encoded, self.cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError("camera frame could not be decoded")
        found, values, points, _ = self.detector.detectAndDecodeMulti(image)
        results = []
        for index, value in enumerate(values if values is not None else ()):
            if not value:
                continue
            corners = None
            if points is not None and index < len(points):
                height, width = image.shape[:2]
                corners = [
                    {
                        "x": normalized_coordinate(point[0], width),
                        "y": normalized_coordinate(point[1], height),
                    }
                    for point in points[index]
                ]
            results.append({"payload": value, "corners": corners})
        if results or self.pyzbar is None:
            return results
        height, width = image.shape[:2]
        for barcode in self.pyzbar.decode(image):
            try:
                value = barcode.data.decode("utf-8")
            except UnicodeDecodeError:
                continue
            x, y, w, h = barcode.rect
            results.append({
                "payload": value,
                "corners": [
                    {"x": normalized_coordinate(x, width), "y": normalized_coordinate(y, height)},
                    {"x": normalized_coordinate(x + w, width), "y": normalized_coordinate(y, height)},
                    {"x": normalized_coordinate(x + w, width), "y": normalized_coordinate(y + h, height)},
                    {"x": normalized_coordinate(x, width), "y": normalized_coordinate(y + h, height)},
                ],
            })
        return results


def capture_high_resolution_still():
    """Capture one fixed observational frame; accepts no caller-controlled options."""
    result = subprocess.run(
        [
            RPICAM_STILL,
            "--nopreview",
            "--timeout", "1200",
            "--width", str(MARKER_SCAN_WIDTH),
            "--height", str(MARKER_SCAN_HEIGHT),
            "--output", "-",
        ],
        capture_output=True,
        timeout=8,
        check=False,
    )
    if result.returncode != 0 or not result.stdout.startswith(b"\xff\xd8"):
        diagnostic = result.stderr.decode("utf-8", errors="replace")[-400:]
        raise RuntimeError(f"high-resolution marker capture failed ({result.returncode}): {diagnostic}")
    return result.stdout


class MarkerScanner:
    """Bounded observational QR scanner sharing frames with the camera owner."""

    def __init__(
        self,
        camera_owner,
        decoder_factory=OpenCvQrDecoder,
        still_capture=capture_high_resolution_still,
    ):
        self.camera_owner = camera_owner
        self.decoder_factory = decoder_factory
        self.still_capture = still_capture
        self.lock = threading.RLock()
        self.scan_lock = threading.Lock()
        self.active = False
        self.thread = None
        self.decoder = None
        self.observations = deque(maxlen=MAX_OBSERVATIONS)
        self.sequence = 0
        self.last_observation_at = None
        self.last_emitted = {}
        self.error = None

    def status(self):
        with self.lock:
            return {
                "marker_scanner_active": self.active,
                "observation_count": len(self.observations),
                "last_observation_at": self.last_observation_at,
                "error": self.error,
            }

    def start(self):
        with self.lock:
            if self.active:
                return False
            self.decoder = self.decoder_factory()
            self.error = None
            self.active = True
            self.camera_owner.start()
            self.thread = threading.Thread(target=self._run, daemon=True)
            self.thread.start()
            return True

    def stop(self):
        with self.lock:
            changed = self.active
            self.active = False
            thread = self.thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=2)
        with self.lock:
            self.thread = None
            self.decoder = None
        self.camera_owner.stop()
        return changed

    def list_observations(self, after_sequence=0):
        with self.lock:
            return [dict(item) for item in self.observations if item["sequence"] > after_sequence]

    def scan_high_resolution(self):
        """Pause streaming ownership, scan one fixed still, then restore prior state."""
        if not self.scan_lock.acquire(blocking=False):
            raise RuntimeError("high-resolution marker scan is already active")
        with self.lock:
            restore_active = self.active
            before_sequence = self.sequence
        try:
            if restore_active:
                self.stop()
            else:
                self.camera_owner.stop()
            decoder = self.decoder_factory()
            frame = self.still_capture()
            self._process_with_decoder(decoder, frame, 0)
            return self.list_observations(before_sequence)
        except Exception as error:
            with self.lock:
                self.error = f"{type(error).__name__}: {error}"[:300]
            raise
        finally:
            if restore_active:
                self.start()
            self.scan_lock.release()

    def _run(self):
        frame_sequence = 0
        while True:
            with self.lock:
                if not self.active:
                    return
            frame, frame_sequence = self.camera_owner.wait_frame(frame_sequence, timeout=2)
            if frame is None:
                continue
            try:
                self._process_frame(frame, frame_sequence)
            except Exception as error:
                with self.lock:
                    self.error = f"{type(error).__name__}: {error}"[:300]

    def _process_frame(self, frame, frame_sequence, observed_monotonic=None):
        decoder = self.decoder
        if decoder is None:
            return
        self._process_with_decoder(decoder, frame, frame_sequence, observed_monotonic)

    def _process_with_decoder(self, decoder, frame, frame_sequence, observed_monotonic=None):
        now = time.monotonic() if observed_monotonic is None else observed_monotonic
        for decoded in decoder.decode(frame):
            payload = decoded.get("payload")
            parsed = parse_marker_payload(payload)
            if parsed is None:
                continue
            with self.lock:
                last = self.last_emitted.get(payload)
                if last is not None and now - last < MARKER_DEBOUNCE_SECONDS:
                    continue
                self.last_emitted[payload] = now
                self.sequence += 1
                timestamp = utc_now()
                observation = {
                    "sequence": self.sequence,
                    "observation_id": f"marker-{self.sequence:08d}",
                    "marker_id": parsed["marker_id"],
                    "kind": parsed["kind"],
                    "payload": payload,
                    "observed_at": timestamp,
                    "frame_sequence": frame_sequence,
                    "decoder": "opencv-qrcode-detector",
                    "confidence": None,
                    "corners": decoded.get("corners"),
                }
                self.observations.append(observation)
                self.last_observation_at = timestamp
                print(json.dumps({
                    "event": "vision.marker.observed",
                    "observation_id": observation["observation_id"],
                    "marker_id": observation["marker_id"],
                    "kind": observation["kind"],
                }), flush=True)


SCANNER = MarkerScanner(OWNER)


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
        parsed_url = urlparse(self.path)
        if parsed_url.path == "/health":
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
        if parsed_url.path == "/markers/status":
            return self.reply(200, SCANNER.status())
        if parsed_url.path == "/markers/observations":
            values = parse_qs(parsed_url.query).get("after", ["0"])
            try:
                after = int(values[0])
                if after < 0:
                    raise ValueError()
            except (TypeError, ValueError):
                return self.reply(400, {"error": {"code": "BAD_REQUEST", "message": "Invalid observation cursor.", "retryable": False}})
            status = SCANNER.status()
            return self.reply(200, {
                "marker_scanner_active": status["marker_scanner_active"],
                "observations": SCANNER.list_observations(after),
                "error": status["error"],
            })
        if parsed_url.path == "/frame.jpg":
            active, _, _, _ = OWNER.status()
            if not active:
                return self.reply(409, {"error": {"code": "STREAM_INACTIVE", "message": "Camera stream is stopped.", "retryable": True}})
            frame, _ = OWNER.wait_frame(-1, timeout=2)
            if frame is None:
                return self.reply(503, {"error": {"code": "FRAME_UNAVAILABLE", "message": "No camera frame is available.", "retryable": True}})
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(frame)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(frame)
            return
        if parsed_url.path == "/stream.mjpg":
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
            finally:
                # One worker owns one camera stream. Losing its sole downstream
                # viewer releases the camera unless marker observation still owns it.
                if not SCANNER.status()["marker_scanner_active"]:
                    OWNER.stop()
            return
        self.reply(404, {"error": {"code": "BAD_REQUEST", "message": "Not found.", "retryable": False}})

    def do_POST(self):
        if self.path == "/stream/start":
            changed = OWNER.start()
            return self.reply(200, {"camera_active": True, "changed": changed})
        if self.path == "/stream/stop":
            if SCANNER.status()["marker_scanner_active"]:
                return self.reply(200, {"camera_active": True, "changed": False})
            changed = OWNER.stop()
            return self.reply(200, {"camera_active": False, "changed": changed})
        if self.path == "/markers/start":
            try:
                changed = SCANNER.start()
            except Exception as error:
                return self.reply(503, {"error": {"code": "MARKER_SCANNER_UNAVAILABLE", "message": f"Marker scanner could not start: {type(error).__name__}.", "retryable": True}})
            return self.reply(200, {"marker_scanner_active": True, "changed": changed})
        if self.path == "/markers/scan":
            try:
                observations = SCANNER.scan_high_resolution()
            except Exception as error:
                return self.reply(503, {"error": {"code": "MARKER_SCAN_FAILED", "message": f"High-resolution marker scan failed: {type(error).__name__}.", "retryable": True}})
            return self.reply(200, {
                "marker_scanner_active": SCANNER.status()["marker_scanner_active"],
                "observations": observations,
                "error": SCANNER.status()["error"],
            })
        if self.path == "/markers/stop":
            changed = SCANNER.stop()
            return self.reply(200, {"marker_scanner_active": False, "changed": changed})
        self.reply(404, {"error": {"code": "BAD_REQUEST", "message": "Not found.", "retryable": False}})


def shutdown(signum=None, frame=None):
    SCANNER.stop()
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
