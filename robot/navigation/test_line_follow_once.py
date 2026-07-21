import importlib
import unittest

line = importlib.import_module("robot.navigation.line_follow_once")


class FakeController:
    def __init__(self, readings):
        self.readings = iter(readings)
        self.calls = []

    def stop(self):
        self.calls.append(("stop",))

    def set_dir_servo_angle(self, angle):
        self.calls.append(("steer", angle))

    def get_grayscale_data(self):
        return next(self.readings)

    def forward(self, speed):
        self.calls.append(("forward", speed))


class Clock:
    def __init__(self):
        self.value = 0.0

    def monotonic(self):
        self.value += 0.25
        return self.value

    def sleep(self, _duration):
        return None


class LineFollowOnceTests(unittest.TestCase):
    def test_import_is_hardware_passive(self):
        self.assertIsNone(line.ROBOT)

    def test_steering_uses_vendor_line_priority(self):
        self.assertEqual(line.steering_for([600, 300, 800]), 0)
        self.assertEqual(line.steering_for([600, 3000, 3000]), -20)
        self.assertEqual(line.steering_for([3000, 3000, 800]), 20)
        self.assertIsNone(line.steering_for([3000, 3000, 3000]))

    def test_run_blocks_without_line_and_never_moves(self):
        controller = FakeController([[3000, 3000, 3000]])
        clock = Clock()
        result = line.run(controller, clock.monotonic, clock.sleep)
        self.assertEqual(result["status"], "blocked")
        self.assertNotIn(("forward", 1), controller.calls)

    def test_run_is_bounded_and_stops_in_cleanup(self):
        controller = FakeController([[600, 300, 800]] * 8)
        clock = Clock()
        result = line.run(controller, clock.monotonic, clock.sleep)
        self.assertEqual(result["status"], "completed")
        self.assertIn(("forward", 1), controller.calls)
        self.assertEqual(controller.calls[-2:], [("stop",), ("steer", 0)])

    def test_line_loss_stops_immediately(self):
        controller = FakeController([
            [600, 300, 800],
            [600, 300, 800],
            [3000, 3000, 3000],
        ])
        clock = Clock()
        result = line.run(controller, clock.monotonic, clock.sleep)
        self.assertEqual(result["status"], "stopped")
        self.assertEqual(result["reason"], "line_lost")
        self.assertEqual(controller.calls[-2:], [("stop",), ("steer", 0)])


if __name__ == "__main__":
    unittest.main()
