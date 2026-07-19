#!/usr/bin/env python3
"""Loopback-only CRAS physical worker. Import and startup do not initialize PiCar-X."""

import hashlib
import hmac
import json
import os
import signal
import sqlite3
import stat
import subprocess
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 9300
MAX_BODY = 16 * 1024
MAX_CLOCK_SKEW_MS = 30_000
BEHAVIOR_ID = "MEDICATION_DELIVERY_DEMO_V1"
DB_PATH = os.environ.get("CRAS_ROBOT_REPLAY_DB", "/var/lib/cras-robot/replay.sqlite3")
KEY_PATH = os.environ.get("CRAS_ROBOT_SIGNING_KEY_FILE", "/etc/cras-robot/dispatch.key")
ACTIVE_LOCK = threading.Lock()
ACTIVE_PROCESS = None


def load_key():
    with open(KEY_PATH, "rb") as handle:
        key = handle.read().strip()
    if len(key) < 32:
        raise RuntimeError("dispatch signing key is missing or too short")
    return key


def initialize_replay_store():
    os.makedirs(os.path.dirname(DB_PATH), mode=0o750, exist_ok=True)
    with sqlite3.connect(DB_PATH) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        db.execute("CREATE TABLE IF NOT EXISTS consumed_grants (grant_id TEXT PRIMARY KEY, nonce TEXT UNIQUE NOT NULL, consumed_at_ms INTEGER NOT NULL)")


def claim_once(grant_id, nonce, consumed_at_ms):
    try:
        with sqlite3.connect(DB_PATH) as db:
            db.execute("INSERT INTO consumed_grants(grant_id, nonce, consumed_at_ms) VALUES (?, ?, ?)", (grant_id, nonce, consumed_at_ms))
        return True
    except sqlite3.IntegrityError:
        return False


def execute_fixed_demo_action():
    # SunFounder's constructor requires os.getlogin(), so the fixed child runs
    # in a bounded pseudo-terminal. No caller-controlled command or arguments cross.
    global ACTIVE_PROCESS
    process = None
    try:
        cleanup_stale_gpio_fifo()
        process = subprocess.Popen(
            ["/usr/bin/script", "-qec", "/usr/bin/python3 /opt/cras-robot/worker/motion_once.py", "/dev/null"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            start_new_session=True,
        )
        with ACTIVE_LOCK:
            ACTIVE_PROCESS = process
        output, _ = process.communicate(timeout=5)
        if process.returncode != 0 or "CRAS_MOTION_COMPLETED" not in output:
            diagnostic = output.replace("\x00", "")[-1200:]
            raise RuntimeError(f"fixed motion child failed ({process.returncode}): {diagnostic}")
    except subprocess.TimeoutExpired:
        if process is not None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
        raise RuntimeError("fixed motion child timed out")
    finally:
        with ACTIVE_LOCK:
            ACTIVE_PROCESS = None


def cleanup_stale_gpio_fifo():
    """Remove only the orphan FIFO name used by this worker's GPIO backend."""
    path = os.path.join(os.getcwd(), ".lgd-nfy0")
    try:
        mode = os.lstat(path).st_mode
    except FileNotFoundError:
        return
    if not stat.S_ISFIFO(mode):
        raise RuntimeError("GPIO notification path exists but is not a FIFO")
    os.unlink(path)


def emergency_stop(signum=None, frame=None):
    """Best-effort immediate stop for SIGTERM/SIGINT and service shutdown."""
    with ACTIVE_LOCK:
        process = ACTIVE_PROCESS
    if process is not None and process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except BaseException as error:
            print(json.dumps({"event": "robot.worker.emergency_stop_failed", "error_type": type(error).__name__}), flush=True)
    if signum is not None:
        raise SystemExit(128 + signum)


class Handler(BaseHTTPRequestHandler):
    server_version = "cras-robot-worker/1"

    def log_message(self, format, *args):
        print(json.dumps({"event": "robot.worker.http", "message": format % args}), flush=True)

    def reply(self, status, value):
        body = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            return self.reply(404, {"error": "not_found"})
        self.reply(200, {"service": "cras-robot-worker", "status": "ready", "actuators_initialized": False})

    def do_POST(self):
        if self.path != "/dispatch":
            return self.reply(404, {"error": "not_found"})
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY:
            return self.reply(413, {"error": "invalid_body_size"})
        try:
            outer = json.loads(self.rfile.read(length))
            payload = outer["payload"]
            signature = outer["signature"]
            if not isinstance(payload, str) or not isinstance(signature, str):
                raise ValueError("invalid envelope")
            expected = hmac.new(self.server.signing_key, payload.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, signature):
                return self.reply(401, {"error": "invalid_signature"})
            envelope = json.loads(payload)
            required = ("grant_id", "evidence_record_id", "action_id", "action_digest", "issued_at_ms", "nonce")
            if envelope.get("version") != 1 or any(not envelope.get(field) for field in required):
                raise ValueError("invalid envelope")
            if abs(int(time.time() * 1000) - int(envelope["issued_at_ms"])) > MAX_CLOCK_SKEW_MS:
                return self.reply(409, {"error": "stale_dispatch"})
            if envelope.get("action") != {"kind": "MEDICATION_DELIVERY", "destination": "Room 312"}:
                return self.reply(422, {"error": "unsupported_action"})
            if envelope.get("behavior_id") != BEHAVIOR_ID:
                return self.reply(422, {"error": "unsupported_behavior"})
            if not claim_once(envelope["grant_id"], envelope["nonce"], int(time.time() * 1000)):
                return self.reply(409, {"error": "replay_rejected"})
            execute_fixed_demo_action()
            self.reply(200, {
                "status": "executed",
                "final_position": "physical-demo-complete",
                "behavior_id": BEHAVIOR_ID,
            })
        except Exception as error:
            print(json.dumps({
                "event": "robot.worker.dispatch_failed",
                "error_type": type(error).__name__,
                "error": str(error)[:300],
                "traceback": traceback.format_exc(limit=8)[-1800:],
            }), flush=True)
            self.reply(500, {"error": "dispatch_failed"})


def main():
    initialize_replay_store()
    signal.signal(signal.SIGTERM, emergency_stop)
    signal.signal(signal.SIGINT, emergency_stop)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.signing_key = load_key()
    print(json.dumps({"event": "robot.worker.ready", "bind": f"{HOST}:{PORT}"}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
