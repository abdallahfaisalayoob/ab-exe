from __future__ import annotations

from math import sqrt

from app.core.config import CUT_Z_MM, DRILL_Z_MM, SAFE_Z_MM
from app.models.schemas import Geometry, Point, ToolMove, Toolpath, TracePolyline


def _distance(a: Point, b: Point, include_z: bool = False) -> float:
    dz = 0.0
    if include_z:
        dz = (a.z or 0.0) - (b.z or 0.0)
    return sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + dz**2)


def _move_duration_ms(distance_mm: float, feed_mm_min: float) -> float:
    if feed_mm_min <= 0:
        return 0.0
    return distance_mm / feed_mm_min * 60_000


def _adaptive_cut_feed(points: list[Point], segment_length: float) -> tuple[float, float]:
    base = 620.0
    complexity = 0.18
    if segment_length < 4:
        complexity += 0.24
    if len(points) > 2:
        complexity += min(0.24, 0.04 * (len(points) - 2))
    feed = base * (1.0 - complexity * 0.55)
    return round(max(260.0, feed), 1), round(min(1.0, 0.24 + complexity), 3)


def _offset_segment(p1: Point, p2: Point, offset_mm: float) -> tuple[Point, Point]:
    dx = p2.x - p1.x
    dy = p2.y - p1.y
    length = sqrt(dx * dx + dy * dy)
    if length < 0.001:
        return p1, p2
    nx = -dy / length
    ny = dx / length
    return (
        Point(x=round(p1.x + nx * offset_mm, 3), y=round(p1.y + ny * offset_mm, 3), z=p1.z),
        Point(x=round(p2.x + nx * offset_mm, 3), y=round(p2.y + ny * offset_mm, 3), z=p2.z),
    )


class ToolpathGenerator:
    def generate(self, geometry: Geometry, bit_diameter_mm: float = 0.8, spindle_rpm: float = 12000.0, flute_count: int = 1) -> Toolpath:
        moves: list[ToolMove] = []
        bit_radius = bit_diameter_mm / 2
        gcode = [
            "G21",
            "G90",
            f"(BIT_DIAMETER_MM={bit_diameter_mm:.3f})",
            f"(SPINDLE_RPM={spindle_rpm:.0f})",
            f"G0 Z{SAFE_Z_MM:.3f}",
            "M5",
        ]
        current = Point(x=0.0, y=0.0, z=SAFE_Z_MM)

        traces = self._order_traces(geometry.traces, current)
        for trace in traces:
            if len(trace.points) < 2:
                continue
            for p1, p2 in zip(trace.points, trace.points[1:]):
                copper_clearance = trace.width_mm / 2 + bit_radius
                for side in (-1, 1):
                    raw_start = Point(x=p1.x, y=p1.y, z=SAFE_Z_MM)
                    raw_end = Point(x=p2.x, y=p2.y, z=SAFE_Z_MM)
                    offset_start, offset_end = _offset_segment(raw_start, raw_end, copper_clearance * side)
                    start = Point(x=offset_start.x, y=offset_start.y, z=SAFE_Z_MM)
                    if _distance(current, start, include_z=True) > 0.05:
                        current = self._append_move(
                            moves,
                            gcode,
                            "travel",
                            current,
                            start,
                            feed=2400,
                            adaptive=2400,
                            source_id=trace.id,
                            bit_diameter_mm=bit_diameter_mm,
                            spindle_rpm=spindle_rpm,
                        )
                    plunge = Point(x=start.x, y=start.y, z=CUT_Z_MM)
                    current = self._append_move(
                        moves,
                        gcode,
                        "plunge",
                        current,
                        plunge,
                        feed=320,
                        adaptive=300,
                        source_id=trace.id,
                        bit_diameter_mm=bit_diameter_mm,
                        spindle_rpm=spindle_rpm,
                        compensation_offset_mm=copper_clearance,
                    )
                    gcode.append("M3 S720")
                    start_cut = Point(x=offset_start.x, y=offset_start.y, z=CUT_Z_MM)
                    end_cut = Point(x=offset_end.x, y=offset_end.y, z=CUT_Z_MM)
                    segment_length = _distance(start_cut, end_cut)
                    adaptive, load = _adaptive_cut_feed(trace.points, segment_length)
                    current = self._append_move(
                        moves,
                        gcode,
                        "cut",
                        start_cut,
                        end_cut,
                        feed=620,
                        adaptive=adaptive,
                        laser_on=True,
                        source_id=trace.id,
                        load_factor=load,
                        bit_diameter_mm=bit_diameter_mm,
                        spindle_rpm=spindle_rpm,
                        compensation_offset_mm=copper_clearance,
                        corner_slowdown=adaptive < 560,
                        flute_count=flute_count,
                    )
                    gcode.append("M5")
                    retract = Point(x=current.x, y=current.y, z=SAFE_Z_MM)
                    current = self._append_move(
                        moves,
                        gcode,
                        "retract",
                        current,
                        retract,
                        feed=900,
                        adaptive=900,
                        source_id=trace.id,
                        bit_diameter_mm=bit_diameter_mm,
                        spindle_rpm=spindle_rpm,
                    )

        for drill in geometry.drills:
            top = Point(x=drill.center.x, y=drill.center.y, z=SAFE_Z_MM)
            bottom = Point(x=drill.center.x, y=drill.center.y, z=-abs(drill.depth_mm or DRILL_Z_MM))
            current = self._append_move(moves, gcode, "travel", current, top, feed=2400, adaptive=2400, source_id=drill.id)
            gcode.append("M3 S850")
            current = self._append_move(
                moves,
                gcode,
                "drill",
                top,
                bottom,
                feed=180,
                adaptive=150,
                drill_on=True,
                source_id=drill.id,
                load_factor=0.78,
                bit_diameter_mm=max(bit_diameter_mm, drill.radius_mm * 2),
                spindle_rpm=spindle_rpm * 0.82,
                flute_count=flute_count,
            )
            gcode.append("M5")
            current = self._append_move(
                moves,
                gcode,
                "retract",
                current,
                top,
                feed=800,
                adaptive=800,
                source_id=drill.id,
            )

        gcode.append("G0 X0.000 Y0.000 Z5.000")
        total_travel = sum(move.distance_mm for move in moves if move.mode in {"travel", "plunge", "retract"})
        cutting = sum(move.distance_mm for move in moves if move.mode == "cut")
        estimated = sum(move.duration_ms for move in moves) / 1000
        return Toolpath(
            moves=moves,
            total_travel_mm=round(total_travel, 3),
            cutting_mm=round(cutting, 3),
            drilling_count=len(geometry.drills),
            estimated_time_sec=round(estimated, 3),
            bit_diameter_mm=bit_diameter_mm,
            spindle_rpm=spindle_rpm,
            flute_count=flute_count,
            gcode=gcode,
        )

    def _order_traces(self, traces: list[TracePolyline], origin: Point) -> list[TracePolyline]:
        remaining = [trace.model_copy(deep=True) for trace in traces]
        ordered: list[TracePolyline] = []
        current = origin
        while remaining:
            best_index = 0
            best_reverse = False
            best_distance = float("inf")
            for idx, trace in enumerate(remaining):
                start_distance = _distance(current, Point(x=trace.points[0].x, y=trace.points[0].y, z=current.z))
                end_distance = _distance(current, Point(x=trace.points[-1].x, y=trace.points[-1].y, z=current.z))
                if start_distance < best_distance:
                    best_index = idx
                    best_reverse = False
                    best_distance = start_distance
                if end_distance < best_distance:
                    best_index = idx
                    best_reverse = True
                    best_distance = end_distance
            trace = remaining.pop(best_index)
            if best_reverse:
                trace.points = list(reversed(trace.points))
            ordered.append(trace)
            current = Point(x=trace.points[-1].x, y=trace.points[-1].y, z=current.z)
        return ordered

    def _append_move(
        self,
        moves: list[ToolMove],
        gcode: list[str],
        mode: str,
        start: Point,
        end: Point,
        feed: float,
        adaptive: float,
        laser_on: bool = False,
        drill_on: bool = False,
        source_id: str | None = None,
        load_factor: float = 0.24,
        bit_diameter_mm: float = 0.8,
        spindle_rpm: float = 12000.0,
        compensation_offset_mm: float = 0.0,
        corner_slowdown: bool = False,
        flute_count: int = 1,
    ) -> Point:
        distance = _distance(start, end, include_z=True)
        if distance < 0.001:
            return end
        move_id = f"move-{len(moves) + 1}"
        code = "G1" if mode in {"cut", "drill", "plunge"} else "G0"
        line = f"{code} X{end.x:.3f} Y{end.y:.3f} Z{(end.z or 0):.3f} F{adaptive:.1f}"
        gcode.append(line)
        moves.append(
            ToolMove(
                id=move_id,
                mode=mode,  # type: ignore[arg-type]
                start=start,
                end=end,
                feed_rate_mm_min=feed,
                adaptive_feed_rate_mm_min=adaptive,
                laser_on=laser_on,
                drill_on=drill_on,
                duration_ms=round(_move_duration_ms(distance, adaptive), 3),
                distance_mm=round(distance, 3),
                load_factor=load_factor,
                source_id=source_id,
                spindle_rpm=spindle_rpm if mode in {"cut", "drill", "plunge"} else 0.0,
                bit_diameter_mm=bit_diameter_mm,
                compensation_offset_mm=round(compensation_offset_mm, 3),
                chip_load_mm=round(adaptive / max(1.0, spindle_rpm * max(1, flute_count)), 5) if mode in {"cut", "drill"} else 0.0,
                corner_slowdown=corner_slowdown,
                gcode=line,
            )
        )
        return end
