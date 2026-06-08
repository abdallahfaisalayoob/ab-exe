from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import API_PREFIX
from app.routes.projects import router as projects_router
from app.services.sample_assets import ensure_sample_assets


app = FastAPI(
    title="Virtual CNC PCB Prototyping Simulator",
    version="1.0.0",
    description="FastAPI backend for image-based PCB trace extraction, CNC toolpath generation, simulation, and AI diagnostics.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    ensure_sample_assets()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "virtual-cnc-pcb-simulator"}


app.include_router(projects_router, prefix=API_PREFIX)
