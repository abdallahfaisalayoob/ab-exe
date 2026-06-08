import unittest

from app.models.schemas import BoardBounds, Geometry, Pad, Point, TracePolyline
from app.services.simulation_engine import SimulationEngine
from app.services.toolpath_generator import ToolpathGenerator


def demo_geometry() -> Geometry:
    return Geometry(
        board=BoardBounds(width_mm=60, height_mm=40, scale_px_per_mm=8),
        traces=[
            TracePolyline(
                id="trace-test",
                points=[Point(x=8, y=8), Point(x=40, y=8), Point(x=48, y=20)],
                width_mm=0.5,
            )
        ],
        pads=[Pad(id="pad-test", center=Point(x=8, y=8), radius_mm=2.0, drill_radius_mm=0.7)],
        drills=[],
        faults=[],
    )


class ServiceTests(unittest.TestCase):
    def test_toolpath_uses_isolation_compensation(self) -> None:
        toolpath = ToolpathGenerator().generate(demo_geometry(), bit_diameter_mm=0.8, spindle_rpm=12000)
        cut_moves = [move for move in toolpath.moves if move.mode == "cut"]
        self.assertGreaterEqual(len(cut_moves), 4)
        self.assertTrue(all(move.compensation_offset_mm > 0 for move in cut_moves))
        self.assertTrue(all(move.bit_diameter_mm == 0.8 for move in cut_moves))
        self.assertTrue(all(move.chip_load_mm > 0 for move in cut_moves))

    def test_simulation_emits_realistic_telemetry_fields(self) -> None:
        toolpath = ToolpathGenerator().generate(demo_geometry())
        simulation = SimulationEngine().simulate(toolpath)
        active = next(frame for frame in simulation.frames if frame.mode == "cut")
        self.assertGreater(active.spindle_rpm, 0)
        self.assertGreater(active.chip_load_mm, 0)
        self.assertLessEqual(active.feed_override_pct, 100)
        self.assertGreater(simulation.total_time_sec, 0)


if __name__ == "__main__":
    unittest.main()
