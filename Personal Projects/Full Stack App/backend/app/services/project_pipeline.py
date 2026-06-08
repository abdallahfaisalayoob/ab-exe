from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import UploadFile

from app.core.config import STORAGE_DIR
from app.models.schemas import Geometry, ProcessingStats, ProjectResponse, Toolpath
from app.services.ai_diagnostics import AIDiagnostics
from app.services.file_ingestion import ingest_sample, ingest_upload
from app.services.sample_assets import sample_image_path, sample_precomputed_path
from app.services.simulation_engine import SimulationEngine
from app.services.toolpath_generator import ToolpathGenerator
from app.services.vision_processor import VisionProcessor


class ProjectPipeline:
    def __init__(self) -> None:
        self.vision = VisionProcessor()
        self.toolpaths = ToolpathGenerator()
        self.simulation = SimulationEngine()
        self.ai = AIDiagnostics()

    async def process_upload(self, upload: UploadFile) -> ProjectResponse:
        project_id = self._new_project_id()
        project_dir = STORAGE_DIR / project_id
        ingested = await ingest_upload(upload, project_dir)
        vision = self.vision.process(ingested.image, project_dir)
        return self._assemble(
            project_id=project_id,
            file_name=ingested.file_name,
            input_asset="input.png",
            processed_asset=vision.processed_path.name,
            final_asset=vision.final_path.name,
            geometry=vision.geometry,
            stats=vision.stats,
            logs=vision.logs,
        )

    def process_demo(self, sample_id: str) -> ProjectResponse:
        project_id = self._new_project_id()
        project_dir = STORAGE_DIR / project_id
        image_path = sample_image_path(sample_id)
        metadata_path = sample_precomputed_path(sample_id)
        if not image_path.exists() or not metadata_path.exists():
            raise FileNotFoundError(f"Unknown demo sample: {sample_id}")

        ingested = ingest_sample(image_path, project_dir)
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        geometry = Geometry.model_validate(payload["geometry"])
        stats = ProcessingStats.model_validate(payload["stats"])
        precomputed_toolpath = Toolpath.model_validate(payload["toolpath"]) if payload.get("toolpath") else None

        processed_path = project_dir / "processed.png"
        final_path = project_dir / "final.png"
        self.vision.render_overlay(ingested.image, geometry, processed_path)
        self.vision.render_final(geometry, final_path)

        logs = [
            "Loaded precomputed demo geometry for instant review.",
            "Applied corrected trace grid, pad centers, and drill coordinates.",
            "Generated CNC toolpath and AI diagnostics from deterministic demo data.",
        ]
        return self._assemble(
            project_id=project_id,
            file_name=ingested.file_name,
            input_asset="input.png",
            processed_asset=processed_path.name,
            final_asset=final_path.name,
            geometry=geometry,
            stats=stats,
            logs=logs,
            precomputed_toolpath=precomputed_toolpath,
        )

    def project_asset(self, project_id: str, asset_name: str) -> Path:
        path = (STORAGE_DIR / project_id / asset_name).resolve()
        project_root = (STORAGE_DIR / project_id).resolve()
        if project_root not in path.parents and path != project_root:
            raise FileNotFoundError(asset_name)
        if not path.exists():
            raise FileNotFoundError(asset_name)
        return path

    def _assemble(
        self,
        project_id: str,
        file_name: str,
        input_asset: str,
        processed_asset: str,
        final_asset: str,
        geometry: Geometry,
        stats: ProcessingStats,
        logs: list[str],
        precomputed_toolpath: Toolpath | None = None,
    ) -> ProjectResponse:
        toolpath = precomputed_toolpath or self.toolpaths.generate(geometry)
        simulation = self.simulation.simulate(toolpath)
        diagnostics, ai_logs = self.ai.evaluate(geometry, toolpath, simulation)
        all_logs = logs + [
            f"Generated {len(toolpath.moves)} CNC moves with {toolpath.cutting_mm:.1f} mm of cutting distance.",
            f"Simulation produced {len(simulation.frames)} telemetry frames over {simulation.total_time_sec:.1f} seconds.",
        ] + ai_logs
        gcode_path = STORAGE_DIR / project_id / "toolpath.gcode"
        gcode_path.write_text("\n".join(toolpath.gcode) + "\n", encoding="utf-8")
        response = ProjectResponse(
            project_id=project_id,
            file_name=file_name,
            created_at=datetime.now(timezone.utc).isoformat(),
            input_image_url=self._asset_url(project_id, input_asset),
            processed_image_url=self._asset_url(project_id, processed_asset),
            final_image_url=self._asset_url(project_id, final_asset),
            geometry=geometry,
            toolpath=toolpath,
            simulation=simulation,
            diagnostics=diagnostics,
            logs=all_logs,
            stats=stats,
        )
        project_json_path = STORAGE_DIR / project_id / "project.json"
        project_json_path.write_text(response.model_dump_json(indent=2), encoding="utf-8")
        return response

    def _new_project_id(self) -> str:
        project_id = uuid.uuid4().hex[:12]
        project_dir = STORAGE_DIR / project_id
        if project_dir.exists():
            shutil.rmtree(project_dir)
        project_dir.mkdir(parents=True, exist_ok=True)
        return project_id

    def _asset_url(self, project_id: str, asset_name: str) -> str:
        return f"/api/projects/{project_id}/assets/{asset_name}"
