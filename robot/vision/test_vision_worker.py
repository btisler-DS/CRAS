#!/usr/bin/env python3
"""Hardware-free tests for the passive vision worker."""

import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


PATH = Path(__file__).with_name("vision_worker.py")
SPEC = importlib.util.spec_from_file_location("vision_worker", PATH)
vision = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(vision)


class FakeProcess:
    stdout = None
    stderr = None

    def poll(self):
        return None


class VisionWorkerTests(unittest.TestCase):
    def test_import_and_owner_construction_are_camera_passive(self):
        self.assertIsNone(vision.OWNER.process)
        self.assertIsNone(vision.OWNER.frame)

    def test_start_uses_only_fixed_rpicam_arguments(self):
        owner = vision.CameraOwner()
        process = FakeProcess()
        with (
            patch.object(vision.subprocess, "Popen", return_value=process) as popen,
            patch.object(vision.threading.Thread, "start"),
        ):
            self.assertTrue(owner.start())
        self.assertEqual(
            popen.call_args.args[0],
            [
                "/usr/bin/rpicam-vid", "--nopreview", "--codec", "mjpeg",
                "--width", "640", "--height", "480", "--framerate", "15",
                "--timeout", "0", "--output", "-",
            ],
        )
        self.assertFalse(popen.call_args.kwargs["shell"])

    def test_module_has_no_robotics_dependency(self):
        source = PATH.read_text()
        self.assertNotIn("picarx", source.lower())
        self.assertNotIn("robot_hat", source.lower())


if __name__ == "__main__":
    unittest.main()
