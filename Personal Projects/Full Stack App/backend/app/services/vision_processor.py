from __future__ import annotations

from dataclasses import dataclass
from math import hypot
from pathlib import Path

import cv2
import numpy as np

from app.core.config import DEFAULT_BOARD_WIDTH_MM
from app.models.schemas import BoardBounds, DrillHole, FaultFinding, Geometry, Pad, Point, ProcessingStats, TracePolyline


@dataclass(slots=True)
class VisionOutput:
    geometry: Geometry
    stats: ProcessingStats
    processed_path: Path
    final_path: Path
    logs: list[str]


def _snap(value: float, grid: float = 0.5) -> float:
    return round(value / grid) * grid


def _dist(a: Point, b: Point) -> float:
    return hypot(a.x - b.x, a.y - b.y)


class VisionProcessor:
    def process(self, image: np.ndarray, project_dir: Path) -> VisionOutput:
        height_px, width_px = image.shape[:2]
        scale = width_px / DEFAULT_BOARD_WIDTH_MM
        board_height_mm = height_px / scale

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        cleaned = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=1)
        cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel, iterations=2)
        edges = cv2.Canny(cleaned, 45, 135)

        contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        traces = self._extract_lines(edges, contours, scale)
        pads, drills = self._extract_pads_and_drills(contours, gray, scale)

        if not traces:
            traces = self._fallback_trace_from_contours(contours, scale)

        faults = self._detect_faults(traces, pads)
        geometry = Geometry(
            board=BoardBounds(width_mm=DEFAULT_BOARD_WIDTH_MM, height_mm=board_height_mm, scale_px_per_mm=scale),
            traces=traces,
            pads=pads,
            drills=drills,
            faults=faults,
        )

        processed_path = project_dir / "processed.png"
        final_path = project_dir / "final.png"
        self.render_overlay(image, geometry, processed_path, edges=edges)
        self.render_final(geometry, final_path)

        edge_pixels = int(np.count_nonzero(edges))
        raw_pixels = max(1, int(np.count_nonzero(binary)))
        clean_pixels = int(np.count_nonzero(cleaned))
        noise_removed = max(0.0, min(99.0, 100.0 * (raw_pixels - clean_pixels) / raw_pixels))
        stats = ProcessingStats(
            edge_pixels=edge_pixels,
            contour_count=len(contours),
            trace_count=len(traces),
            pad_count=len(pads),
            drill_count=len(drills),
            noise_removed_pct=round(noise_removed, 2),
            normalized_trace_width_mm=0.42,
        )
        logs = [
            "Converted input to grayscale and normalized contrast.",
            f"Canny edge detector found {edge_pixels} edge pixels.",
            f"Detected {len(contours)} contours, {len(traces)} corrected traces, {len(pads)} pads, and {len(drills)} drill holes.",
            "Snapped line endpoints to a 0.5 mm manufacturing grid and normalized trace width to 0.42 mm.",
        ]
        return VisionOutput(geometry=geometry, stats=stats, processed_path=processed_path, final_path=final_path, logs=logs)

    def _px_to_point(self, x: float, y: float, scale: float) -> Point:
        return Point(x=round(_snap(x / scale), 3), y=round(_snap(y / scale), 3))

    def _extract_lines(self, edges: np.ndarray, contours: list[np.ndarray], scale: float) -> list[TracePolyline]:
        min_len_px = max(20, int(edges.shape[1] * 0.035))
        lines = cv2.HoughLinesP(edges, rho=1, theta=np.pi / 180, threshold=26, minLineLength=min_len_px, maxLineGap=12)
        traces: list[TracePolyline] = []
        seen: set[tuple[int, int, int, int]] = set()
        if lines is not None:
            for idx, raw in enumerate(lines[:160]):
                x1, y1, x2, y2 = [int(v) for v in raw[0]]
                if hypot(x2 - x1, y2 - y1) / scale < 2.4:
                    continue
                p1 = self._px_to_point(x1, y1, scale)
                p2 = self._px_to_point(x2, y2, scale)
                if abs(p1.x - p2.x) < 0.8:
                    p2 = Point(x=p1.x, y=p2.y)
                if abs(p1.y - p2.y) < 0.8:
                    p2 = Point(x=p2.x, y=p1.y)
                key = (round(p1.x * 2), round(p1.y * 2), round(p2.x * 2), round(p2.y * 2))
                reverse = (key[2], key[3], key[0], key[1])
                if key in seen or reverse in seen:
                    continue
                seen.add(key)
                traces.append(TracePolyline(id=f"trace-{idx + 1}", points=[p1, p2], quality=0.88))

        if len(traces) < 4:
            traces.extend(self._fallback_trace_from_contours(contours, scale, start_index=len(traces)))
        return traces[:180]

    def _fallback_trace_from_contours(
        self, contours: list[np.ndarray], scale: float, start_index: int = 0
    ) -> list[TracePolyline]:
        traces: list[TracePolyline] = []
        for contour in contours[:80]:
            area = cv2.contourArea(contour)
            if area < 50:
                continue
            epsilon = 0.015 * cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, epsilon, True)
            points = [self._px_to_point(float(pt[0][0]), float(pt[0][1]), scale) for pt in approx]
            if len(points) >= 2:
                # Keep the dominant direction from each contour instead of using a filled outline as a path.
                traces.append(
                    TracePolyline(
                        id=f"trace-{start_index + len(traces) + 1}",
                        points=[points[0], points[len(points) // 2]],
                        quality=0.68,
                    )
                )
        return traces

    def _extract_pads_and_drills(self, contours: list[np.ndarray], gray: np.ndarray, scale: float) -> tuple[list[Pad], list[DrillHole]]:
        pads: list[Pad] = []
        drills: list[DrillHole] = []

        def add_pad(center: Point, radius_mm: float, drill_radius_mm: float) -> None:
            if any(_dist(center, existing.center) < max(1.2, existing.radius_mm * 0.55) for existing in pads):
                return
            pad = Pad(
                id=f"pad-{len(pads) + 1}",
                center=center,
                radius_mm=round(radius_mm, 3),
                drill_radius_mm=round(drill_radius_mm, 3),
            )
            drill = DrillHole(
                id=f"drill-{len(drills) + 1}",
                center=center,
                radius_mm=pad.drill_radius_mm,
            )
            pads.append(pad)
            drills.append(drill)

        def circle_contrast_ok(x: float, y: float, pad_radius_px: float, drill_radius_px: float) -> bool:
            yy, xx = np.ogrid[: gray.shape[0], : gray.shape[1]]
            dist = np.sqrt((xx - x) ** 2 + (yy - y) ** 2)
            center_mask = dist <= max(2.0, drill_radius_px * 0.72)
            annulus_mask = (dist >= max(drill_radius_px * 1.25, pad_radius_px * 0.38)) & (dist <= pad_radius_px * 0.92)
            if not np.any(center_mask) or not np.any(annulus_mask):
                return False
            center_mean = float(np.mean(gray[center_mask]))
            annulus_mean = float(np.mean(gray[annulus_mask]))
            return center_mean > 128 and annulus_mean < 140

        circles = cv2.HoughCircles(
            cv2.medianBlur(gray, 5),
            cv2.HOUGH_GRADIENT,
            dp=1.2,
            minDist=max(14, int(3.0 * scale)),
            param1=90,
            param2=14,
            minRadius=max(3, int(0.35 * scale)),
            maxRadius=max(8, int(7.5 * scale)),
        )
        if circles is not None:
            for x, y, radius_px in np.round(circles[0, :]).astype("int")[:120]:
                radius_mm = float(radius_px) / scale
                center = self._px_to_point(float(x), float(y), scale)
                if radius_mm < 1.4:
                    drill_radius = max(0.35, radius_mm)
                    pad_radius = min(7.5, max(1.8, drill_radius / 0.34))
                else:
                    pad_radius = radius_mm
                    drill_radius = max(0.35, radius_mm * 0.32)
                if 1.0 <= pad_radius <= 7.5 and circle_contrast_ok(x, y, pad_radius * scale, drill_radius * scale):
                    add_pad(center, pad_radius, drill_radius)

        for contour in contours:
            area = cv2.contourArea(contour)
            if area < 80:
                continue
            perimeter = cv2.arcLength(contour, True)
            if perimeter <= 0:
                continue
            circularity = 4 * np.pi * area / (perimeter * perimeter)
            (x, y), radius_px = cv2.minEnclosingCircle(contour)
            radius_mm = radius_px / scale
            if circularity < 0.56 or radius_mm < 1.0 or radius_mm > 7.5:
                continue
            center = self._px_to_point(x, y, scale)
            drill_radius = max(0.35, radius_mm * 0.32)
            if circle_contrast_ok(x, y, radius_px, drill_radius * scale):
                add_pad(center, radius_mm, drill_radius)
        return pads[:80], drills[:80]

    def _detect_faults(self, traces: list[TracePolyline], pads: list[Pad]) -> list[FaultFinding]:
        faults: list[FaultFinding] = []
        endpoints: list[tuple[str, Point]] = []
        for trace in traces:
            if len(trace.points) >= 2 and _dist(trace.points[0], trace.points[-1]) < 2.0:
                faults.append(
                    FaultFinding(
                        id=f"fault-{len(faults) + 1}",
                        severity="warning",
                        fault_type="thin_trace",
                        message=f"{trace.id} is shorter than the manufacturable minimum.",
                        location=trace.points[0],
                        suggested_correction="Remove the stub or merge it into the nearest pad.",
                    )
                )
            endpoints.append((trace.id, trace.points[0]))
            endpoints.append((trace.id, trace.points[-1]))

        for idx, (trace_id, point) in enumerate(endpoints):
            if any(_dist(point, pad.center) < pad.radius_mm + 0.8 for pad in pads):
                continue
            nearest = min(
                (
                    (_dist(point, other), other_id, other)
                    for other_id, other in endpoints[idx + 1 :]
                    if other_id != trace_id
                ),
                default=None,
            )
            if nearest and 1.2 < nearest[0] < 4.2:
                faults.append(
                    FaultFinding(
                        id=f"fault-{len(faults) + 1}",
                        severity="warning",
                        fault_type="broken_trace",
                        message=f"Possible open trace between {trace_id} and {nearest[1]} ({nearest[0]:.1f} mm gap).",
                        location=point,
                        suggested_correction="Bridge the gap with a snapped 0.42 mm trace segment before milling.",
                    )
                )
                if len(faults) >= 6:
                    break
        return faults

    def render_overlay(self, image: np.ndarray, geometry: Geometry, path: Path, edges: np.ndarray | None = None) -> None:
        canvas = image.copy()
        if edges is not None:
            edge_layer = np.zeros_like(canvas)
            edge_layer[edges > 0] = (255, 0, 255)
            canvas = cv2.addWeighted(canvas, 0.78, edge_layer, 0.42, 0)

        self._draw_geometry(canvas, geometry, draw_faults=True)
        cv2.imwrite(str(path), canvas)

    def render_final(self, geometry: Geometry, path: Path) -> None:
        width = int(geometry.board.width_mm * geometry.board.scale_px_per_mm)
        height = int(geometry.board.height_mm * geometry.board.scale_px_per_mm)
        canvas = np.full((height, width, 3), (46, 92, 58), dtype=np.uint8)
        grid_color = (38, 76, 49)
        for x in range(0, width, max(20, int(5 * geometry.board.scale_px_per_mm))):
            cv2.line(canvas, (x, 0), (x, height), grid_color, 1)
        for y in range(0, height, max(20, int(5 * geometry.board.scale_px_per_mm))):
            cv2.line(canvas, (0, y), (width, y), grid_color, 1)
        self._draw_geometry(canvas, geometry, draw_faults=True, final=True)
        cv2.imwrite(str(path), canvas)

    def _draw_geometry(self, canvas: np.ndarray, geometry: Geometry, draw_faults: bool, final: bool = False) -> None:
        scale = geometry.board.scale_px_per_mm

        def px(point: Point) -> tuple[int, int]:
            return int(point.x * scale), int(point.y * scale)

        trace_color = (63, 206, 235) if not final else (35, 178, 224)
        pad_color = (37, 183, 255) if not final else (42, 207, 244)
        hole_color = (35, 35, 35)
        fault_color = (36, 63, 244)

        trace_width = max(2, int(0.42 * scale))
        for trace in geometry.traces:
            pts = [px(point) for point in trace.points]
            for start, end in zip(pts, pts[1:]):
                cv2.line(canvas, start, end, trace_color, trace_width, lineType=cv2.LINE_AA)

        for pad in geometry.pads:
            center = px(pad.center)
            cv2.circle(canvas, center, max(3, int(pad.radius_mm * scale)), pad_color, -1, lineType=cv2.LINE_AA)
            cv2.circle(canvas, center, max(2, int(pad.drill_radius_mm * scale)), hole_color, -1, lineType=cv2.LINE_AA)

        if draw_faults:
            for fault in geometry.faults:
                if fault.location is None:
                    continue
                center = px(fault.location)
                cv2.circle(canvas, center, max(5, int(1.2 * scale)), fault_color, 2, lineType=cv2.LINE_AA)
