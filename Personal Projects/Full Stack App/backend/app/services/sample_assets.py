from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from app.core.config import DEFAULT_BOARD_WIDTH_MM, SAMPLES_DIR
from app.models.schemas import Geometry
from app.services.toolpath_generator import ToolpathGenerator


SAMPLE_DEFINITIONS = {
    "router-board": {
        "name": "Router control board",
        "description": "A compact controller board with one intentionally broken trace for fault detection.",
        "width_mm": 120.0,
        "height_mm": 78.0,
        "traces": [
            [[12, 16], [42, 16], [58, 30]],
            [[58, 30], [88, 30], [108, 48]],
            [[14, 52], [42, 52]],
            [[46, 52], [77, 52], [98, 64]],
            [[28, 16], [28, 38], [45, 38]],
            [[62, 14], [62, 30]],
            [[82, 30], [82, 58]],
        ],
        "pads": [[12, 16, 3.8], [108, 48, 3.4], [14, 52, 3.8], [98, 64, 3.3], [62, 14, 3.1], [82, 58, 3.1]],
        "faults": [
            {
                "id": "fault-demo-gap",
                "severity": "warning",
                "fault_type": "broken_trace",
                "message": "Open trace gap detected on the lower signal run (4.0 mm).",
                "location": {"x": 42.0, "y": 52.0},
                "suggested_correction": "Bridge the two lower trace endpoints with a snapped 0.42 mm segment.",
            }
        ],
    },
    "sensor-array": {
        "name": "Sensor array board",
        "description": "Dense pad fanout with several drills and adaptive feed-rate changes.",
        "width_mm": 120.0,
        "height_mm": 82.0,
        "traces": [
            [[10, 12], [28, 12], [42, 24], [62, 24]],
            [[10, 28], [35, 28], [46, 40], [68, 40], [92, 58]],
            [[10, 44], [32, 44], [48, 58], [76, 58]],
            [[18, 68], [48, 68], [72, 44], [102, 44]],
            [[62, 24], [84, 24], [106, 12]],
            [[76, 58], [98, 70], [112, 70]],
            [[92, 58], [108, 58]],
        ],
        "pads": [[10, 12, 3.3], [10, 28, 3.3], [10, 44, 3.3], [18, 68, 3.3], [106, 12, 3.4], [102, 44, 3.2], [112, 70, 3.4], [108, 58, 3.0]],
        "faults": [],
    },
}


def ensure_sample_assets() -> None:
    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    for sample_id, definition in SAMPLE_DEFINITIONS.items():
        image_path = SAMPLES_DIR / f"{sample_id}.png"
        precomputed_path = SAMPLES_DIR / f"{sample_id}.precomputed.json"
        if not image_path.exists():
            _render_sample(definition, image_path)
        if not precomputed_path.exists() or _precomputed_is_stale(precomputed_path):
            _write_precomputed(sample_id, definition, precomputed_path)


def sample_image_path(sample_id: str) -> Path:
    ensure_sample_assets()
    return SAMPLES_DIR / f"{sample_id}.png"


def sample_precomputed_path(sample_id: str) -> Path:
    ensure_sample_assets()
    return SAMPLES_DIR / f"{sample_id}.precomputed.json"


def list_samples() -> list[dict[str, str]]:
    ensure_sample_assets()
    return [
        {
            "id": sample_id,
            "name": definition["name"],
            "description": definition["description"],
            "image_url": f"/api/samples/{sample_id}/image",
        }
        for sample_id, definition in SAMPLE_DEFINITIONS.items()
    ]


def _render_sample(definition: dict, output_path: Path) -> None:
    scale = 7
    width = int(definition["width_mm"] * scale)
    height = int(definition["height_mm"] * scale)
    canvas = np.full((height, width, 3), (232, 238, 231), dtype=np.uint8)
    cv2.rectangle(canvas, (0, 0), (width - 1, height - 1), (85, 120, 88), 6)

    trace_color = (38, 38, 38)
    for trace in definition["traces"]:
        pts = [(int(x * scale), int(y * scale)) for x, y in trace]
        for start, end in zip(pts, pts[1:]):
            cv2.line(canvas, start, end, trace_color, 7, lineType=cv2.LINE_AA)

    for x, y, r in definition["pads"]:
        center = (int(x * scale), int(y * scale))
        cv2.circle(canvas, center, int(r * scale), trace_color, -1, lineType=cv2.LINE_AA)
        cv2.circle(canvas, center, max(3, int(r * 0.34 * scale)), (232, 238, 231), -1, lineType=cv2.LINE_AA)

    for fault in definition.get("faults", []):
        loc = fault["location"]
        center = (int(loc["x"] * scale), int(loc["y"] * scale))
        cv2.circle(canvas, center, 12, (36, 56, 220), 3, lineType=cv2.LINE_AA)

    cv2.imwrite(str(output_path), canvas)


def _precomputed_is_stale(path: Path) -> bool:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return True
    return payload.get("schema_version") != 2


def _write_precomputed(sample_id: str, definition: dict, output_path: Path) -> None:
    scale = 7.0
    pads = [
        {
            "id": f"pad-{idx + 1}",
            "center": {"x": pad[0], "y": pad[1]},
            "radius_mm": pad[2],
            "drill_radius_mm": round(max(0.38, pad[2] * 0.32), 3),
        }
        for idx, pad in enumerate(definition["pads"])
    ]
    payload = {
        "schema_version": 2,
        "sample_id": sample_id,
        "geometry": {
            "board": {
                "width_mm": DEFAULT_BOARD_WIDTH_MM,
                "height_mm": definition["height_mm"],
                "scale_px_per_mm": scale,
            },
            "traces": [
                {
                    "id": f"trace-{idx + 1}",
                    "points": [{"x": x, "y": y} for x, y in trace],
                    "width_mm": 0.42,
                    "corrected": True,
                    "quality": 0.93,
                }
                for idx, trace in enumerate(definition["traces"])
            ],
            "pads": pads,
            "drills": [
                {
                    "id": f"drill-{idx + 1}",
                    "center": pad["center"],
                    "radius_mm": pad["drill_radius_mm"],
                    "depth_mm": 1.2,
                }
                for idx, pad in enumerate(pads)
            ],
            "faults": definition.get("faults", []),
        },
        "stats": {
            "edge_pixels": 14520 if sample_id == "router-board" else 21140,
            "contour_count": 24 if sample_id == "router-board" else 31,
            "trace_count": len(definition["traces"]),
            "pad_count": len(definition["pads"]),
            "drill_count": len(definition["pads"]),
            "noise_removed_pct": 7.8 if sample_id == "router-board" else 4.9,
            "normalized_trace_width_mm": 0.42,
        },
    }
    payload["toolpath"] = ToolpathGenerator().generate(Geometry.model_validate(payload["geometry"])).model_dump(mode="json")
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
