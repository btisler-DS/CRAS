#!/usr/bin/env python3
"""Hardware-free contract tests for the private CRAS robot worker."""

import importlib.util
import os
import sqlite3
import sys
import tempfile
import types
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch


WORKER_PATH = Path(__file__).with_name("cras_robot_worker.py")
SPEC = importlib.util.spec_from_file_location("cras_robot_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class CompletedProcess:
    returncode = 0
    pid = 1000

    def communicate(self, timeout):
        self.timeout = timeout
        return (
            '{"status":"completed","acknowledgment":"ATTENTION",'
            '"cleanup_completed":true}\n',
            None,
        )


class RobotWorkerTests(unittest.TestCase):
    def test_acknowledgment_replay_is_durable(self):
        with tempfile.TemporaryDirectory() as directory:
            worker.DB_PATH = os.path.join(directory, "replay.sqlite3")
            worker.initialize_replay_store()
            self.assertTrue(worker.claim_acknowledgment_once("event-1", "nonce-1", "ATTENTION", 1))
            self.assertFalse(worker.claim_acknowledgment_once("event-1", "nonce-2", "ATTENTION", 2))
            with closing(sqlite3.connect(worker.DB_PATH)) as db:
                self.assertEqual(
                    db.execute("SELECT acknowledgment FROM acknowledgments").fetchone()[0],
                    "ATTENTION",
                )

    def test_fixed_acknowledgment_crosses_only_type_argument(self):
        process = CompletedProcess()
        with patch.object(worker.subprocess, "Popen", return_value=process) as popen:
            worker.execute_fixed_acknowledgment("ATTENTION")
        command = popen.call_args.args[0]
        self.assertEqual(
            command,
            [
                "/usr/bin/python3",
                "/opt/cras-robot/audio/acknowledge_once.py",
                "ATTENTION",
            ],
        )
        self.assertFalse(popen.call_args.kwargs["shell"] if "shell" in popen.call_args.kwargs else False)
        self.assertEqual(process.timeout, 4)

    def test_audio_module_import_is_passive_and_patterns_are_fixed(self):
        audio_path = WORKER_PATH.parent.parent / "audio" / "acknowledge_once.py"
        spec = importlib.util.spec_from_file_location("acknowledge_once", audio_path)
        audio = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(audio)
        self.assertEqual(
            set(audio.PATTERNS),
            {"ATTENTION", "INSTRUCTION_RECEIVED", "AUTHORIZED", "MISSION_COMPLETED"},
        )
        self.assertNotIn("robot_hat", globals())

    def test_motion_child_has_one_fixed_outbound_stop_return_sequence(self):
        motion_path = WORKER_PATH.with_name("motion_once.py")
        spec = importlib.util.spec_from_file_location("motion_once", motion_path)
        motion = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(motion)
        calls = []

        class FakePicarx:
            def set_motor_speed(self, motor, speed):
                calls.append(("motor", motor, speed))

            def stop(self):
                calls.append(("stop",))

        fake_module = types.SimpleNamespace(Picarx=FakePicarx)
        with (
            patch.dict(sys.modules, {"picarx": fake_module}),
            patch.object(motion.os, "getlogin", return_value="edos"),
            patch.object(motion.time, "sleep", side_effect=lambda value: calls.append(("sleep", value))),
        ):
            motion.main()

        self.assertEqual(
            calls,
            [
                ("motor", 1, 1),
                ("motor", 2, 1),
                ("sleep", 1.0),
                ("stop",),
                ("sleep", 0.5),
                ("motor", 1, -1),
                ("motor", 2, -1),
                ("sleep", 1.0),
                ("stop",),
            ],
        )


if __name__ == "__main__":
    unittest.main()
