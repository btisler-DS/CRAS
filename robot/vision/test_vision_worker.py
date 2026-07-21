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
        self.assertIsNone(vision.SCANNER.decoder)
        self.assertFalse(vision.SCANNER.active)

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

    def test_marker_payload_parser_accepts_only_typed_cras_namespace(self):
        self.assertEqual(
            vision.parse_marker_payload("cras:v1:location:loc-room-312"),
            {"kind": "location", "marker_id": "LOC-ROOM-312"},
        )
        self.assertEqual(
            vision.parse_marker_payload("cras:v1:patient:pat-1001"),
            {"kind": "patient", "marker_id": "PAT-1001"},
        )
        for value in (
            "move-forward",
            "cras:v1:motor:left-100",
            "cras:v1:patient:../secret",
            "CRAS:v1:patient:pat-1001",
            "https://example.com",
        ):
            self.assertIsNone(vision.parse_marker_payload(value))

    def test_scanner_records_bounded_typed_observations_and_debounces(self):
        class FakeDecoder:
            def decode(self, frame):
                self.frame = frame
                return [
                    {"payload": "cras:v1:patient:pat-1001", "corners": None},
                    {"payload": "arbitrary-command", "corners": None},
                ]

        scanner = vision.MarkerScanner(object(), decoder_factory=lambda: FakeDecoder())
        scanner.decoder = FakeDecoder()
        scanner._process_frame(b"jpeg", 7, observed_monotonic=10.0)
        scanner._process_frame(b"jpeg", 8, observed_monotonic=10.5)
        scanner._process_frame(b"jpeg", 9, observed_monotonic=12.0)
        observations = scanner.list_observations()
        self.assertEqual(len(observations), 2)
        self.assertEqual(observations[0]["marker_id"], "PAT-1001")
        self.assertEqual(observations[0]["kind"], "patient")
        self.assertEqual(observations[0]["frame_sequence"], 7)
        self.assertIsNone(observations[0]["confidence"])
        self.assertEqual(observations[1]["frame_sequence"], 9)


if __name__ == "__main__":
    unittest.main()
