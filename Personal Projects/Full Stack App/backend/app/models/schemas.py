from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


Severity = Literal["info", "warning", "critical"]
MoveMode = Literal["travel", "cut", "drill", "plunge", "retract", "engrave"]


class Point(BaseModel):
    x: float
    y: float
    z: float | None = None


class BoardBounds(BaseModel):
    width_mm: float
    height_mm: float
    scale_px_per_mm: float


class TracePolyline(BaseModel):
    id: str
    points: list[Point]
    width_mm: float = 0.42
    corrected: bool = True
    quality: float = Field(default=0.82, ge=0, le=1)


class Pad(BaseModel):
    id: str
    center: Point
    radius_mm: float
    drill_radius_mm: float


class DrillHole(BaseModel):
    id: str
    center: Point
    radius_mm: float
    depth_mm: float = 1.2


class FaultFinding(BaseModel):
    id: str
    severity: Severity
    fault_type: Literal["broken_trace", "isolated_pad", "thin_trace", "overload", "geometry_noise"]
    message: str
    location: Point | None = None
    suggested_correction: str | None = None


class Geometry(BaseModel):
    board: BoardBounds
    traces: list[TracePolyline]
    pads: list[Pad]
    drills: list[DrillHole]
    faults: list[FaultFinding] = []


class ToolMove(BaseModel):
    id: str
    mode: MoveMode
    start: Point
    end: Point
    feed_rate_mm_min: float
    adaptive_feed_rate_mm_min: float
    laser_on: bool = False
    drill_on: bool = False
    duration_ms: float
    distance_mm: float
    load_factor: float = Field(default=0.25, ge=0, le=1)
    source_id: str | None = None
    spindle_rpm: float = 0.0
    bit_diameter_mm: float = 0.8
    compensation_offset_mm: float = 0.0
    chip_load_mm: float = 0.0
    corner_slowdown: bool = False
    gcode: str


class Toolpath(BaseModel):
    moves: list[ToolMove]
    total_travel_mm: float
    cutting_mm: float
    drilling_count: int
    estimated_time_sec: float
    bit_diameter_mm: float = 0.8
    spindle_rpm: float = 12000.0
    flute_count: int = 1
    gcode: list[str]


class TelemetrySample(BaseModel):
    t_sec: float
    progress: float
    position: Point
    mode: MoveMode
    feed_rate_mm_min: float
    vibration: float
    temperature_c: float
    motor_load_pct: float
    z_wear_score: float
    spindle_rpm: float = 0.0
    chip_load_mm: float = 0.0
    feed_override_pct: float = 100.0


class SimulationResult(BaseModel):
    total_time_sec: float
    frames: list[TelemetrySample]


class Diagnostic(BaseModel):
    id: str
    module: Literal["maintenance", "optimization", "fault_detection"]
    severity: Severity
    title: str
    message: str
    confidence: float = Field(ge=0, le=1)
    eta_hours: float | None = None


class ProcessingStats(BaseModel):
    edge_pixels: int
    contour_count: int
    trace_count: int
    pad_count: int
    drill_count: int
    noise_removed_pct: float
    normalized_trace_width_mm: float


class ProjectResponse(BaseModel):
    project_id: str
    file_name: str
    created_at: str
    input_image_url: str
    processed_image_url: str
    final_image_url: str
    geometry: Geometry
    toolpath: Toolpath
    simulation: SimulationResult
    diagnostics: list[Diagnostic]
    logs: list[str]
    stats: ProcessingStats


class SampleProject(BaseModel):
    id: str
    name: str
    description: str
    image_url: str
    precomputed_toolpath: bool = True


class SamplesResponse(BaseModel):
    samples: list[SampleProject]


class ProcessingJob(BaseModel):
    job_id: str
    status: Literal["queued", "running", "complete", "failed"]
    progress: float = Field(ge=0, le=1)
    message: str
    project_id: str | None = None
    result_url: str | None = None
    error: str | None = None


class ErrorResponse(BaseModel):
    detail: str
