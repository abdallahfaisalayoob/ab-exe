from __future__ import annotations

import math

from app.models.schemas import Point, SimulationResult, TelemetrySample, ToolMove, Toolpath


class SimulationEngine:
    def simulate(self, toolpath: Toolpath) -> SimulationResult:
        frames: list[TelemetrySample] = []
        elapsed = 0.0
        total_duration = max(0.001, sum(move.duration_ms for move in toolpath.moves) / 1000)
        temperature = 32.0
        wear = 0.18

        for move in toolpath.moves:
            move_duration = max(0.04, move.duration_ms / 1000)
            samples = max(2, min(22, int(move_duration * 8) + 2))
            for sample_index in range(samples):
                ratio = sample_index / max(1, samples - 1)
                position = self._interpolate(move, ratio)
                load_pct = self._load(move, ratio)
                vibration = self._vibration(move, elapsed, ratio)
                temperature += 0.012 + (load_pct / 100.0) * 0.045
                if move.mode in {"drill", "plunge"}:
                    wear += 0.0019
                elif move.mode == "cut":
                    wear += 0.0007
                frame_time = elapsed + move_duration * ratio
                frames.append(
                    TelemetrySample(
                        t_sec=round(frame_time, 3),
                        progress=round(min(1.0, frame_time / total_duration), 4),
                        position=position,
                        mode=move.mode,
                        feed_rate_mm_min=move.adaptive_feed_rate_mm_min,
                        vibration=round(vibration, 3),
                        temperature_c=round(temperature, 2),
                        motor_load_pct=round(load_pct, 2),
                        z_wear_score=round(min(0.98, wear), 4),
                        spindle_rpm=round(move.spindle_rpm, 1),
                        chip_load_mm=round(move.chip_load_mm, 5),
                        feed_override_pct=round(
                            100.0 * move.adaptive_feed_rate_mm_min / max(1.0, move.feed_rate_mm_min),
                            1,
                        ),
                    )
                )
            elapsed += move_duration

        if not frames:
            frames.append(
                TelemetrySample(
                    t_sec=0,
                    progress=0,
                    position=Point(x=0, y=0, z=5),
                    mode="travel",
                    feed_rate_mm_min=0,
                    vibration=0,
                    temperature_c=32,
                    motor_load_pct=0,
                    z_wear_score=0.18,
                    spindle_rpm=0,
                    chip_load_mm=0,
                    feed_override_pct=100,
                )
            )
        return SimulationResult(total_time_sec=round(elapsed, 3), frames=frames)

    def _interpolate(self, move: ToolMove, ratio: float) -> Point:
        start_z = move.start.z or 0.0
        end_z = move.end.z or 0.0
        return Point(
            x=round(move.start.x + (move.end.x - move.start.x) * ratio, 3),
            y=round(move.start.y + (move.end.y - move.start.y) * ratio, 3),
            z=round(start_z + (end_z - start_z) * ratio, 3),
        )

    def _load(self, move: ToolMove, ratio: float) -> float:
        base = {
            "travel": 15,
            "cut": 48,
            "drill": 74,
            "plunge": 56,
            "retract": 24,
        }[move.mode]
        engagement = math.sin(ratio * math.pi)
        return min(96.0, base + move.load_factor * 28 + engagement * 8)

    def _vibration(self, move: ToolMove, elapsed: float, ratio: float) -> float:
        base = {
            "travel": 0.12,
            "cut": 0.34,
            "drill": 0.62,
            "plunge": 0.48,
            "retract": 0.2,
        }[move.mode]
        harmonic = 0.08 * math.sin(elapsed * 3.7 + ratio * math.pi)
        return max(0.02, base + harmonic + move.load_factor * 0.12)
