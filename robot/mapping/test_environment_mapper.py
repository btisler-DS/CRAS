import importlib
import os
import tempfile
import unittest

mapping = importlib.import_module("robot.mapping.environment_mapper")


def empty_map():
    return {
        "version": mapping.MAP_VERSION,
        "map_id": "map-test",
        "created_at": mapping.utc_now(),
        "updated_at": mapping.utc_now(),
        "required_location_marker_ids": sorted(mapping.REQUIRED_LOCATIONS),
        "origin_marker_id": None,
        "current_location_marker_id": None,
        "nodes": {},
        "edges": [],
        "events": [],
        "pending_actions": [],
        "completed_runs": 0,
        "coverage_complete": False,
        "graph_connected": False,
        "missing_location_marker_ids": sorted(mapping.REQUIRED_LOCATIONS),
    }


def location(marker_id, area=0.01, pan=0):
    return {
        "payload": f"cras:v1:location:{marker_id.lower()}",
        "area": area,
        "center_x": 0.5,
        "pan_angle": pan,
    }


class EnvironmentMapperTests(unittest.TestCase):
    def test_import_is_hardware_passive_and_gate_fails_closed(self):
        self.assertIsNone(mapping.ROBOT)
        previous = os.environ.pop("CRAS_ENABLE_ENVIRONMENT_MAPPING", None)
        try:
            with self.assertRaisesRegex(RuntimeError, "explicit ground-run confirmation"):
                mapping.run_mapping()
        finally:
            if previous is not None:
                os.environ["CRAS_ENABLE_ENVIRONMENT_MAPPING"] = previous

    def test_marker_parser_accepts_only_typed_observations(self):
        self.assertEqual(mapping.parse_marker("cras:v1:location:loc-home")["marker_id"], "LOC-HOME")
        self.assertIsNone(mapping.parse_marker("move-forward"))
        self.assertIsNone(mapping.parse_marker("cras:v1:motor:left"))

    def test_map_builds_edge_only_after_translation(self):
        mapper = mapping.TopologicalMap(empty_map())
        mapper.observe(0, [location("LOC-HOME")])
        mapper.observe(1, [location("LOC-SUPPLY")])
        self.assertEqual(mapper.value["edges"], [])

        mapper.action(1, "FORWARD_PULSE", duration_ms=200)
        mapper.observe(2, [location("LOC-HOME")])
        self.assertEqual(len(mapper.value["edges"]), 1)
        self.assertEqual(mapper.value["edges"][0]["from"], "LOC-SUPPLY")
        self.assertEqual(mapper.value["edges"][0]["to"], "LOC-HOME")

    def test_largest_location_marker_is_current_landmark(self):
        mapper = mapping.TopologicalMap(empty_map())
        mapper.observe(0, [location("LOC-HOME", 0.002), location("LOC-SUPPLY", 0.02)])
        self.assertEqual(mapper.value["current_location_marker_id"], "LOC-SUPPLY")

    def test_map_is_complete_only_with_all_required_connected_locations(self):
        mapper = mapping.TopologicalMap(empty_map())
        locations = sorted(mapping.REQUIRED_LOCATIONS)
        mapper.observe(0, [location(locations[0])])
        for step, marker_id in enumerate(locations[1:], start=1):
            mapper.action(step, "FORWARD_PULSE", duration_ms=200)
            mapper.observe(step, [location(marker_id)])
        self.assertTrue(mapper.is_complete())
        self.assertTrue(mapper.value["coverage_complete"])
        self.assertTrue(mapper.value["graph_connected"])
        self.assertEqual(mapper.value["missing_location_marker_ids"], [])

        disconnected = mapping.TopologicalMap(empty_map())
        for step, marker_id in enumerate(locations):
            disconnected.observe(step, [location(marker_id)])
        self.assertFalse(disconnected.is_complete())
        self.assertTrue(disconnected.value["coverage_complete"])
        self.assertFalse(disconnected.value["graph_connected"])

    def test_map_is_atomically_persisted_and_resumed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "map.json")
            mapper = mapping.TopologicalMap()
            mapper.observe(0, [location("LOC-HOME")])
            mapping.save_map(mapper, path)
            reopened = mapping.load_map(path)
            self.assertEqual(reopened.value["origin_marker_id"], "LOC-HOME")
            self.assertFalse(os.path.exists(f"{path}.tmp"))

    def test_motion_decision_uses_sensor_side_and_obstacle_boundary(self):
        self.assertEqual(mapping.decide_motion([700, 3000, 3000], -1), ("BOUNDARY_TURN", "left_tape", -1))
        self.assertEqual(mapping.decide_motion([3000, 3000, 700], -1), ("BOUNDARY_TURN", "right_tape", 1))
        self.assertEqual(mapping.decide_motion([700, 700, 700], -1), ("BOUNDARY_TURN", "tape", 0))
        self.assertEqual(mapping.decide_motion([3000, 3000, 3000], 10), ("OBSTACLE_TURN", "obstacle", 0))
        self.assertEqual(mapping.decide_motion([3000, 3000, 3000], -1), ("FORWARD_PULSE", "clear", 0))
        self.assertEqual(mapping.decide_motion([3000, 3000, 3000], -1, mapping.SEARCH_TURN_INTERVAL), ("SEARCH_TURN", "coverage", 0))
        with self.assertRaises(ValueError):
            mapping.decide_motion([3000], -1)


if __name__ == "__main__":
    unittest.main()
