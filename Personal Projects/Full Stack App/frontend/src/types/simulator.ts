export type Severity = "info" | "warning" | "critical";
export type MoveMode = "travel" | "cut" | "drill" | "plunge" | "retract" | "engrave";

export interface Point {
  x: number;
  y: number;
  z?: number | null;
}

export interface BoardBounds {
  width_mm: number;
  height_mm: number;
  scale_px_per_mm: number;
}

export interface TracePolyline {
  id: string;
  points: Point[];
  width_mm: number;
  corrected: boolean;
  quality: number;
}

export interface Pad {
  id: string;
  center: Point;
  radius_mm: number;
  drill_radius_mm: number;
}

export interface DrillHole {
  id: string;
  center: Point;
  radius_mm: number;
  depth_mm: number;
}

export interface FaultFinding {
  id: string;
  severity: Severity;
  fault_type: string;
  message: string;
  location?: Point | null;
  suggested_correction?: string | null;
}

export interface Geometry {
  board: BoardBounds;
  traces: TracePolyline[];
  pads: Pad[];
  drills: DrillHole[];
  faults: FaultFinding[];
}

export interface ToolMove {
  id: string;
  mode: MoveMode;
  start: Point;
  end: Point;
  feed_rate_mm_min: number;
  adaptive_feed_rate_mm_min: number;
  laser_on: boolean;
  drill_on: boolean;
  duration_ms: number;
  distance_mm: number;
  load_factor: number;
  source_id?: string | null;
  spindle_rpm?: number;
  bit_diameter_mm?: number;
  compensation_offset_mm?: number;
  chip_load_mm?: number;
  corner_slowdown?: boolean;
  gcode: string;
}

export interface Toolpath {
  moves: ToolMove[];
  total_travel_mm: number;
  cutting_mm: number;
  drilling_count: number;
  estimated_time_sec: number;
  bit_diameter_mm?: number;
  spindle_rpm?: number;
  flute_count?: number;
  gcode: string[];
}

export interface TelemetrySample {
  t_sec: number;
  progress: number;
  position: Point;
  mode: MoveMode;
  feed_rate_mm_min: number;
  vibration: number;
  temperature_c: number;
  motor_load_pct: number;
  z_wear_score: number;
  spindle_rpm?: number;
  chip_load_mm?: number;
  feed_override_pct?: number;
}

export interface SimulationResult {
  total_time_sec: number;
  frames: TelemetrySample[];
}

export interface Diagnostic {
  id: string;
  module: "maintenance" | "optimization" | "fault_detection";
  severity: Severity;
  title: string;
  message: string;
  confidence: number;
  eta_hours?: number | null;
}

export interface ProcessingStats {
  edge_pixels: number;
  contour_count: number;
  trace_count: number;
  pad_count: number;
  drill_count: number;
  noise_removed_pct: number;
  normalized_trace_width_mm: number;
}

export interface ProjectResponse {
  project_id: string;
  file_name: string;
  created_at: string;
  input_image_url: string;
  processed_image_url: string;
  final_image_url: string;
  geometry: Geometry;
  toolpath: Toolpath;
  simulation: SimulationResult;
  diagnostics: Diagnostic[];
  logs: string[];
  stats: ProcessingStats;
}

export interface SampleProject {
  id: string;
  name: string;
  description: string;
  image_url: string;
  precomputed_toolpath: boolean;
}
