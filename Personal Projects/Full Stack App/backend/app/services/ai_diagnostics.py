from __future__ import annotations

from statistics import mean

from app.models.schemas import Diagnostic, Geometry, SimulationResult, Toolpath


class AIDiagnostics:
    def evaluate(self, geometry: Geometry, toolpath: Toolpath, simulation: SimulationResult) -> tuple[list[Diagnostic], list[str]]:
        diagnostics: list[Diagnostic] = []
        logs: list[str] = []

        frames = simulation.frames
        avg_load = mean([frame.motor_load_pct for frame in frames]) if frames else 0
        peak_temp = max([frame.temperature_c for frame in frames], default=32)
        peak_wear = max([frame.z_wear_score for frame in frames], default=0.18)
        peak_vibration = max([frame.vibration for frame in frames], default=0)

        wear_confidence = min(0.96, 0.62 + peak_wear * 0.24 + peak_vibration * 0.08)
        if peak_wear > 0.34 or toolpath.drilling_count >= 4:
            diagnostics.append(
                Diagnostic(
                    id="maintenance-z-axis",
                    module="maintenance",
                    severity="warning" if peak_wear < 0.64 else "critical",
                    title="Z-axis wear detected",
                    message=(
                        f"Simulated vibration and plunge load indicate elevated Z-axis guide wear. "
                        f"Peak wear score {peak_wear:.2f}; schedule inspection before precision drilling."
                    ),
                    confidence=round(wear_confidence, 2),
                    eta_hours=round(max(2.0, 13.0 - peak_wear * 14.0), 1),
                )
            )

        spindle_eta = max(3.0, 11.5 - (avg_load / 14.0) - (peak_temp - 32) / 10.0)
        diagnostics.append(
            Diagnostic(
                id="maintenance-spindle",
                module="maintenance",
                severity="info" if spindle_eta > 6 else "warning",
                title=f"Spindle degradation in {spindle_eta:.0f} hours",
                message=(
                    f"Load model predicts bearing degradation if the current cut profile repeats. "
                    f"Average motor load {avg_load:.1f}% and peak temperature {peak_temp:.1f} C."
                ),
                confidence=0.74,
                eta_hours=round(spindle_eta, 1),
            )
        )

        reduced_moves = [move for move in toolpath.moves if move.mode == "cut" and move.adaptive_feed_rate_mm_min < move.feed_rate_mm_min]
        if reduced_moves:
            slowest = min(move.adaptive_feed_rate_mm_min for move in reduced_moves)
            diagnostics.append(
                Diagnostic(
                    id="optimization-feedrate",
                    module="optimization",
                    severity="info",
                    title="Adaptive feed rate active",
                    message=(
                        f"Feed was reduced on {len(reduced_moves)} high-complexity cut moves. "
                        f"Lowest commanded feed {slowest:.0f} mm/min to protect trace edges."
                    ),
                    confidence=0.89,
                )
            )
            logs.append(f"Adaptive optimizer reduced feed on {len(reduced_moves)} path segments.")

        for fault in geometry.faults:
            diagnostics.append(
                Diagnostic(
                    id=f"fault-{fault.id}",
                    module="fault_detection",
                    severity=fault.severity,
                    title=fault.fault_type.replace("_", " ").title(),
                    message=f"{fault.message} Suggested correction: {fault.suggested_correction or 'Review geometry.'}",
                    confidence=0.81,
                )
            )

        if not geometry.faults:
            diagnostics.append(
                Diagnostic(
                    id="fault-clean-network",
                    module="fault_detection",
                    severity="info",
                    title="No disconnected traces found",
                    message="Connectivity scan found no trace endpoints with suspicious millable gaps.",
                    confidence=0.77,
                )
            )

        return diagnostics, logs
