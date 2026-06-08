from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState
from fastapi.responses import FileResponse

from app.models.schemas import ProcessingJob, ProjectResponse, SamplesResponse
from app.services.file_ingestion import FileIngestionError
from app.services.job_manager import JobManager
from app.services.project_pipeline import ProjectPipeline
from app.services.sample_assets import list_samples, sample_image_path


router = APIRouter()
pipeline = ProjectPipeline()
jobs = JobManager(pipeline)


@router.get("/samples", response_model=SamplesResponse)
def get_samples() -> SamplesResponse:
    return SamplesResponse(samples=list_samples())


@router.get("/samples/{sample_id}/image")
def get_sample_image(sample_id: str) -> FileResponse:
    path = sample_image_path(sample_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Sample image not found.")
    return FileResponse(path, media_type="image/png")


@router.post("/projects/upload", response_model=ProjectResponse)
async def upload_project(file: UploadFile = File(...)) -> ProjectResponse:
    try:
        return await pipeline.process_upload(file)
    except FileIngestionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc


@router.post("/projects/demo/{sample_id}", response_model=ProjectResponse)
def demo_project(sample_id: str) -> ProjectResponse:
    try:
        return pipeline.process_demo(sample_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Demo processing failed: {exc}") from exc


@router.get("/projects/{project_id}/assets/{asset_name}")
def project_asset(project_id: str, asset_name: str) -> FileResponse:
    try:
        path = pipeline.project_asset(project_id, asset_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project asset not found.") from exc

    media_type = "image/png"
    if path.suffix.lower() == ".gcode":
        media_type = "text/plain"
    if path.suffix.lower() == ".json":
        media_type = "application/json"
    return FileResponse(path, media_type=media_type, filename=path.name if path.suffix.lower() == ".gcode" else None)


@router.websocket("/projects/{project_id}/telemetry/ws")
async def project_telemetry(project_id: str, websocket: WebSocket, speed: float = 40.0) -> None:
    await websocket.accept()
    try:
        project_path = pipeline.project_asset(project_id, "project.json")
        payload = json.loads(project_path.read_text(encoding="utf-8"))
        frames = payload["simulation"]["frames"]
        for frame in frames:
            await websocket.send_json(frame)
            await asyncio.sleep(max(0.005, 0.05 / max(0.25, speed)))
        await websocket.send_json({"event": "complete", "project_id": project_id})
    except (FileNotFoundError, KeyError, json.JSONDecodeError):
        await websocket.send_json({"event": "error", "message": "Telemetry stream not found."})
    except WebSocketDisconnect:
        return
    finally:
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.close()


@router.post("/jobs/demo/{sample_id}", response_model=ProcessingJob)
def create_demo_job(sample_id: str, background_tasks: BackgroundTasks) -> ProcessingJob:
    job = jobs.create_demo_job(sample_id)
    background_tasks.add_task(jobs.run_demo_job, job.job_id, sample_id)
    return job


@router.get("/jobs/{job_id}", response_model=ProcessingJob)
def get_job(job_id: str) -> ProcessingJob:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


@router.get("/jobs/{job_id}/result", response_model=ProjectResponse)
def get_job_result(job_id: str) -> ProjectResponse:
    result = jobs.result(job_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Job result not ready.")
    return result
