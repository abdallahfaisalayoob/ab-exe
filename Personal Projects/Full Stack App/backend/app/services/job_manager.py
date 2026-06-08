from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.models.schemas import ProcessingJob, ProjectResponse
from app.services.project_pipeline import ProjectPipeline


@dataclass(slots=True)
class JobRecord:
    job_id: str
    status: str = "queued"
    progress: float = 0.0
    message: str = "Queued"
    project_id: str | None = None
    result_url: str | None = None
    error: str | None = None
    result: ProjectResponse | None = field(default=None, repr=False)

    def to_schema(self) -> ProcessingJob:
        return ProcessingJob(
            job_id=self.job_id,
            status=self.status,  # type: ignore[arg-type]
            progress=self.progress,
            message=self.message,
            project_id=self.project_id,
            result_url=self.result_url,
            error=self.error,
        )


class JobManager:
    def __init__(self, pipeline: ProjectPipeline) -> None:
        self.pipeline = pipeline
        self.jobs: dict[str, JobRecord] = {}

    def create_demo_job(self, sample_id: str) -> ProcessingJob:
        job_id = uuid.uuid4().hex[:12]
        record = JobRecord(job_id=job_id, message=f"Queued demo processing for {sample_id}")
        self.jobs[job_id] = record
        return record.to_schema()

    def get(self, job_id: str) -> ProcessingJob | None:
        record = self.jobs.get(job_id)
        return record.to_schema() if record else None

    def result(self, job_id: str) -> ProjectResponse | None:
        return self.jobs.get(job_id).result if job_id in self.jobs else None

    def run_demo_job(self, job_id: str, sample_id: str) -> None:
        record = self.jobs[job_id]
        try:
            record.status = "running"
            record.progress = 0.25
            record.message = "Running vision, compensation, and simulation services"
            project = self.pipeline.process_demo(sample_id)
            record.result = project
            record.project_id = project.project_id
            record.result_url = f"/api/projects/{project.project_id}/assets/project.json"
            record.status = "complete"
            record.progress = 1.0
            record.message = "Processing complete"
        except Exception as exc:  # pragma: no cover - defensive surface for background worker
            record.status = "failed"
            record.error = str(exc)
            record.message = "Processing failed"
