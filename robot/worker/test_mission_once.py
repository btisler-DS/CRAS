import importlib
import unittest
from unittest.mock import patch

mission = importlib.import_module("robot.worker.mission_once")


def observed(sequence, marker, width=0.08):
    return {
        "sequence": sequence,
        "kind": "location",
        "marker_id": marker,
        "corners": [
            {"x": 0.1, "y": 0.1}, {"x": 0.1 + width, "y": 0.1},
            {"x": 0.1 + width, "y": 0.2}, {"x": 0.1, "y": 0.2},
        ],
    }


class FakeRobot:
    def __init__(self, readings=None):
        self.calls = []
        self.readings = iter(readings or [[600, 300, 800]] * 50)

    def stop(self): self.calls.append(("stop",))
    def set_dir_servo_angle(self, angle): self.calls.append(("steer", angle))
    def set_cam_pan_angle(self, angle): self.calls.append(("pan", angle))
    def set_cam_tilt_angle(self, angle): self.calls.append(("tilt", angle))
    def get_grayscale_data(self): return next(self.readings)
    def forward(self, speed): self.calls.append(("forward", speed))


class FakeVision:
    def __init__(self, batches):
        self.batches = iter(batches)
        self.started = False
    def start(self): self.started = True
    def poll(self): return next(self.batches, [])
    def frame(self): return b"test-frame"


class Clock:
    def __init__(self): self.value = 0.0
    def monotonic(self): self.value += 0.01; return self.value
    def sleep(self, value): self.value += value


class MissionOnceTests(unittest.TestCase):
    def execute(self, robot, batches):
        clock = Clock()
        with (
            patch.object(mission.uuid, "uuid4", return_value="run-1"),
            patch.object(mission, "detect_track", return_value={"offset": 0.0, "confidence": 20.0}),
        ):
            return mission.run(robot, FakeVision(batches), clock.monotonic, clock.sleep)

    def test_import_is_hardware_passive(self):
        self.assertIsNone(mission.ROBOT)

    def test_completes_only_after_destination_then_home(self):
        robot = FakeRobot()
        result = self.execute(robot, [
            [], [observed(2, "LOC-ROOM-312")], [], [observed(3, "LOC-HOME")],
        ])
        self.assertEqual(result["status"], "executed")
        self.assertEqual(result["final_position"], "home-base")
        names = [event["event"] for event in result["events"]]
        self.assertLess(names.index("mission.delivery.confirmed"), names.index("mission.home.confirmed"))

    def test_home_seen_before_delivery_does_not_complete(self):
        robot = FakeRobot(readings=[[600, 300, 800]] * 10 + [[3000, 3000, 3000]])
        result = self.execute(robot, [
            [observed(2, "LOC-HOME")], [], [],
        ])
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["reason"], "black_route_lost")

    def test_route_loss_stops_and_fails(self):
        robot = FakeRobot(readings=[[3000, 3000, 3000]])
        result = self.execute(robot, [[]])
        self.assertEqual(result["reason"], "black_route_lost")
        self.assertEqual(robot.calls[-2:], [("stop",), ("steer", 0)])

    def test_junction_hysteresis_keeps_main_route_straight(self):
        self.assertEqual(mission.steering_for([3000, 3000, 500], 0.2)[0], 0)
        self.assertEqual(mission.steering_for([3000, 3000, 500], 0.8)[0], mission.STEERING_ANGLE)
        self.assertEqual(mission.steering_for([500, 3000, 500], 2.0)[0], 0)

    def test_only_location_observations_of_minimum_size_localize(self):
        values = [observed(1, "LOC-ROOM-312", 0.08), observed(2, "LOC-HOME", 0.01)]
        values.append({**observed(3, "LOC-PHARMACY"), "kind": "patient"})
        self.assertEqual(mission.nearby_locations(values), [mission.DESTINATION])

    def test_low_confidence_camera_track_never_moves(self):
        robot = FakeRobot()
        clock = Clock()
        with patch.object(mission, "detect_track", return_value={"offset": 0.0, "confidence": 1.0}):
            result = mission.run(
                robot,
                FakeVision([[]]),
                clock.monotonic,
                clock.sleep,
            )
        self.assertEqual(result["reason"], "black_route_not_confirmed")
        self.assertNotIn(("forward", mission.SPEED), robot.calls)


if __name__ == "__main__":
    unittest.main()
